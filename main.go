package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type State string

const (
	StateCreated   State = "created"
	StatePurchased State = "purchased"
	StateClaimed   State = "claimed"
	StateRevoked   State = "revoked"
)

type Metadata struct {
	Name           string   `json:"name"`
	ManufacturedAt string   `json:"manufacturedAt"`
	Serial         string   `json:"serial"`
	Certificates   []string `json:"certificates"`
	Image          string   `json:"image"`
	Version        int      `json:"version"`
}

type Product struct {
	ID         int64    `json:"id"`
	Meta       Metadata `json:"meta"`
	IPFSHash   string   `json:"ipfsHash"`
	SerialHash string   `json:"serialHash"`
	State      State    `json:"state"`
	CreatedAt  int64    `json:"createdAt"`
	QRPayload  any      `json:"qrPayload"`
	PublicURL  string   `json:"publicUrl,omitempty"`
}

type ClaimTicket struct {
	TicketID string `json:"ticketId"`
	TokenID  int64  `json:"tokenId"`
	Nonce    string `json:"n"`
	Exp      int64  `json:"exp"`
	CT       string `json:"ct"`
	V        int    `json:"v"`
	Payload  any    `json:"payload"`
	Used     bool   `json:"used"`
}

type ErrorResp struct {
	Error string `json:"error"`
}

var (
	db         *sql.DB
	publicBase = strings.TrimRight(os.Getenv("PUBLIC_BASE"), "/")
)

// ===== DB bootstrap =====

func mustInitDB() {
	if err := os.MkdirAll("./data", 0o755); err != nil {
		log.Fatalf("mkdir data: %v", err)
	}
	dsn := "file:" + filepath.ToSlash("./data/marki.db") + "?_pragma=journal_mode(WAL)"
	var err error
	db, err = sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=ON;`); err != nil {
		log.Fatalf("pragma fk: %v", err)
	}
	schema := `
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  manufactured_at TEXT,
  serial          TEXT    NOT NULL,
  certificates    TEXT,           -- JSON array
  image           TEXT,
  ipfs_hash       TEXT,
  serial_hash     TEXT    NOT NULL,
  state           TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_serial ON products(serial);
CREATE INDEX IF NOT EXISTS ix_products_state ON products(state);

CREATE TABLE IF NOT EXISTS claim_tickets (
  ticket_id  TEXT PRIMARY KEY,
  token_id   INTEGER NOT NULL,
  nonce      TEXT    NOT NULL,
  exp        INTEGER NOT NULL,
  ct         TEXT,
  v          INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  payload    TEXT,
  FOREIGN KEY(token_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_claim_token ON claim_tickets(token_id);
`
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("init schema: %v", err)
	}
}

// ===== main =====

func main() {
	mustInitDB()

	mux := http.NewServeMux()

	// health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"time":       time.Now().UTC(),
			"publicBase": publicBase,
		})
	})

	// API
	mux.HandleFunc("/api/manufacturer/products", withCORS(manufacturerCreateProduct)) // POST
	mux.HandleFunc("/api/products", withCORS(productsList))                           // GET
	mux.HandleFunc("/api/products/", withCORS(productActions))                        // POST /purchase
	mux.HandleFunc("/api/labels/qrcode", withCORS(generateLabelPayload))              // POST
	mux.HandleFunc("/api/claim/issue", withCORS(issueClaimTicket))                    // POST
	mux.HandleFunc("/api/claim/redeem", withCORS(redeemClaimTicket))                  // POST
	mux.HandleFunc("/api/verify/", withCORS(verifyProduct))                           // GET /api/verify/{id}

	// короткий редірект
	mux.HandleFunc("/p/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/p/")
		http.Redirect(w, r, "/details.html?id="+id, http.StatusFound)
	})

	// статика
	exe, _ := os.Executable()
	root := filepath.Join(filepath.Dir(exe), "docs")
	fs := http.FileServer(http.Dir(root))
	mux.Handle("/", fs)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	addr := ":" + port

	log.Println("MARKI Secure backend running at", addr, "PUBLIC_BASE=", publicBase)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// ===== Handlers =====

type createReq struct {
	Serial       string `json:"serial"`
	Name         string `json:"name"`
	Date         string `json:"date"`
	Certificates string `json:"certificates"` // comma separated
	Image        string `json:"image"`        // optional
}

func manufacturerCreateProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	if strings.TrimSpace(req.Serial) == "" || strings.TrimSpace(req.Name) == "" {
		writeJSON(w, 400, ErrorResp{"serial and name are required"})
		return
	}

	meta := Metadata{
		Name:           req.Name,
		ManufacturedAt: ifEmpty(req.Date, time.Now().Format("2006-01-02")),
		Serial:         req.Serial,
		Certificates:   splitCSV(req.Certificates),
		Image:          strings.TrimSpace(req.Image),
		Version:        1,
	}
	ipfsHash := sha256HexJSON(meta)[:46]
	serialHash := sha256Hex(req.Serial)
	now := time.Now().UnixMilli()

	// Вставка у БД
	certJSON := mustJSONString(meta.Certificates)
	res, err := db.Exec(`
  INSERT INTO products (name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.Name, meta.ManufacturedAt, meta.Serial, certJSON, meta.Image,
		ipfsHash, serialHash, string(StateCreated), now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed: products.serial") {
			writeJSON(w, 409, ErrorResp{"product with this serial already exists"})
			return
		}
		writeJSON(w, 500, ErrorResp{fmt.Sprintf("db insert error: %v", err)})
		return
	}
	id, _ := res.LastInsertId()
	if id == 0 {
		var pid int64
		_ = db.QueryRow(`SELECT id FROM products WHERE serial = ?`, meta.Serial).Scan(&pid)
		id = pid
	}

	// QR payload (тільки JSON)
	payload := map[string]any{
		"t":   "prod",
		"std": "1155",
		"id":  id,
		"s":   serialHash,
		"iss": "MID_DEMO",
		"v":   1,
	}
	payload["sig"] = mockSign(payload)

	p := Product{
		ID:         id,
		Meta:       meta,
		IPFSHash:   ipfsHash,
		SerialHash: serialHash,
		State:      StateCreated,
		CreatedAt:  now,
		QRPayload:  payload,
	}
	if publicBase != "" {
		p.PublicURL = fmt.Sprintf("%s/details.html?id=%d", publicBase, id)
	}
	writeJSON(w, http.StatusCreated, p)
}

func productsList(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	rows, err := db.Query(`SELECT id, name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at FROM products ORDER BY id DESC`)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	defer rows.Close()

	var list []Product
	for rows.Next() {
		var (
			id                                                            int64
			name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
			created                                                       int64
		)
		if err := rows.Scan(&id, &name, &mfgAt, &serial, &certJSON, &image, &ipfs, &serialHash, &state, &created); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		var certs []string
		_ = json.Unmarshal([]byte(ifEmpty(certJSON, "[]")), &certs)
		meta := Metadata{
			Name: name, ManufacturedAt: mfgAt, Serial: serial,
			Certificates: certs, Image: image, Version: 1,
		}
		list = append(list, Product{
			ID: id, Meta: meta, IPFSHash: ipfs, SerialHash: serialHash,
			State: State(state), CreatedAt: created,
		})
	}
	writeJSON(w, 200, list)
}

// /api/products/{id}/purchase  (POST)
func productActions(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/products/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, 404, ErrorResp{"not found"})
		return
	}
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		writeJSON(w, 400, ErrorResp{"bad id"})
		return
	}

	if len(parts) == 2 && parts[1] == "purchase" && r.Method == http.MethodPost {
		res, err := db.Exec(`UPDATE products SET state=? WHERE id=?`, string(StatePurchased), id)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		aff, _ := res.RowsAffected()
		if aff == 0 {
			writeJSON(w, 404, ErrorResp{"product not found"})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "state": StatePurchased})
		return
	}
	writeJSON(w, 404, ErrorResp{"not found"})
}

func generateLabelPayload(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	var body struct {
		TokenID int64 `json:"tokenId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	var serialHash string
	err := db.QueryRow(`SELECT serial_hash FROM products WHERE id = ?`, body.TokenID).Scan(&serialHash)
	if err == sql.ErrNoRows {
		writeJSON(w, 404, ErrorResp{"product not found"})
		return
	}
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}

	payload := map[string]any{
		"t":   "prod",
		"std": "1155",
		"id":  body.TokenID,
		"s":   serialHash,
		"iss": "MID_DEMO",
		"v":   1,
	}
	payload["sig"] = mockSign(payload)
	writeJSON(w, 200, payload)
}

func issueClaimTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	var body struct {
		TokenID int64  `json:"tokenId"`
		To      string `json:"to"`
		TTL     int64  `json:"ttlSeconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	if body.TokenID == 0 || strings.TrimSpace(body.To) == "" {
		writeJSON(w, 400, ErrorResp{"tokenId and to are required"})
		return
	}

	// існує продукт?
	var exists int
	if err := db.QueryRow(`SELECT 1 FROM products WHERE id=?`, body.TokenID).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, 404, ErrorResp{"product not found"})
			return
		}
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}

	if body.TTL <= 0 {
		body.TTL = 24 * 60 * 60
	}
	t := &ClaimTicket{
		TicketID: randID(),
		TokenID:  body.TokenID,
		Nonce:    randID(),
		Exp:      time.Now().Unix() + body.TTL,
		CT:       body.To,
		V:        1,
		Used:     false,
	}
	payload := map[string]any{
		"t":   "claim",
		"id":  fmt.Sprintf("%d", t.TokenID),
		"n":   t.Nonce,
		"exp": t.Exp,
		"ct":  t.CT,
		"v":   t.V,
	}
	payload["sig"] = mockSign(payload)
	t.Payload = payload

	_, err := db.Exec(`INSERT INTO claim_tickets (ticket_id, token_id, nonce, exp, ct, v, used, payload)
		VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
		t.TicketID, t.TokenID, t.Nonce, t.Exp, t.CT, t.V, mustJSONString(payload),
	)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 201, t)
}

func redeemClaimTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	var body struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	var pay map[string]any
	if err := json.Unmarshal(body.Payload, &pay); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid payload"})
		return
	}
	if pay["t"] != "claim" {
		writeJSON(w, 400, ErrorResp{"wrong payload type"})
		return
	}

	idStr, _ := pay["id"].(string)
	tokenID, _ := strconv.ParseInt(idStr, 10, 64)
	expF, _ := pay["exp"].(float64)
	sig, _ := pay["sig"].(string)
	if sig == "" {
		writeJSON(w, 400, ErrorResp{"missing signature"})
		return
	}
	if int64(expF) < time.Now().Unix() {
		writeJSON(w, 410, ErrorResp{"ticket expired"})
		return
	}

	// мін. перевірка, що квиток існує і не використаний
	var used int
	err := db.QueryRow(`SELECT used FROM claim_tickets WHERE token_id=? AND exp=?`, tokenID, int64(expF)).Scan(&used)
	if err == sql.ErrNoRows {
		writeJSON(w, 404, ErrorResp{"ticket not found"})
		return
	}
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	if used != 0 {
		writeJSON(w, 409, ErrorResp{"already used"})
		return
	}

	tx, err := db.Begin()
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`UPDATE products SET state=? WHERE id=?`, string(StateClaimed), tokenID); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	if _, err := tx.Exec(`UPDATE claim_tickets SET used=1 WHERE token_id=? AND exp=?`, tokenID, int64(expF)); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}

	writeJSON(w, 200, map[string]any{"ok": true, "state": StateClaimed})
}

func verifyProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/verify/")
	tokenID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeJSON(w, 400, ErrorResp{"bad id"})
		return
	}

	var (
		name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
		created                                                       int64
	)
	err = db.QueryRow(`SELECT name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at
		FROM products WHERE id=?`, tokenID).
		Scan(&name, &mfgAt, &serial, &certJSON, &image, &ipfs, &serialHash, &state, &created)
	if err == sql.ErrNoRows {
		writeJSON(w, 404, ErrorResp{"product not found"})
		return
	}
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}

	var certs []string
	_ = json.Unmarshal([]byte(ifEmpty(certJSON, "[]")), &certs)
	meta := Metadata{
		Name: name, ManufacturedAt: mfgAt, Serial: serial,
		Certificates: certs, Image: image, Version: 1,
	}
	resp := map[string]any{
		"state":      state,
		"tokenId":    tokenID,
		"metadata":   meta,
		"ipfsHash":   ipfs,
		"serialHash": serialHash,
	}
	writeJSON(w, 200, resp)
}

// ===== helpers =====

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			returnOK(w)
			return
		}
		h.ServeHTTP(w, r)
	}
}
func returnOK(w http.ResponseWriter) { w.WriteHeader(http.StatusOK) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func ifEmpty(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
func sha256HexJSON(v any) string {
	b, _ := json.Marshal(v)
	return sha256Hex(string(b))
}
func mockSign(payload any) string {
	h := sha256.Sum256(mustJSON(payload))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func randID() string { return fmt.Sprintf("%x%x", rand.Uint64(), time.Now().UnixNano()) }
func mustJSONString(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}
