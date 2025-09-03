package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

/************ РОЛИ / КОНСТАНТЫ ************/

// 5 виробників (заміни емейли на реальні)
var manufacturerEmails = map[string]bool{
	"alankharisov1@gmail.com": true,
	"brand2@example.com":      true,
	"brand3@example.com":      true,
	"brand4@example.com":      true,
	"brand5@example.com":      true,
}

// Адміни для видачі “галочки” бренду (через ENV ADMIN_USERS)
var adminUsers = map[string]bool{}

/************ МОДЕЛІ ************/

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
	ID            int64    `json:"id"`
	Meta          Metadata `json:"meta"`
	IPFSHash      string   `json:"ipfsHash,omitempty"`
	SerialHash    string   `json:"serialHash,omitempty"`
	State         State    `json:"state"`
	CreatedAt     int64    `json:"createdAt"`
	QRPayload     any      `json:"qrPayload,omitempty"`
	PublicURL     string   `json:"publicUrl,omitempty"`
	Owner         string   `json:"owner,omitempty"`
	Seller        string   `json:"seller,omitempty"`
	Brand         string   `json:"brand,omitempty"`
	BrandVerified bool     `json:"brandVerified,omitempty"`
	EditionNo     int      `json:"editionNo,omitempty"`
	EditionTotal  int      `json:"editionTotal,omitempty"`
}

type Manufacturer struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	Owner      string `json:"owner"`
	Verified   bool   `json:"verified"`
	VerifiedBy string `json:"verifiedBy,omitempty"`
	VerifiedAt int64  `json:"verifiedAt,omitempty"`
}

type ErrorResp struct {
	Error string `json:"error"`
}

/************ ГЛОБАЛИ ************/

var (
	db         *sql.DB
	publicBase = strings.TrimRight(os.Getenv("PUBLIC_BASE"), "/")
)

/************ УТИЛІТИ ************/

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func returnOK(w http.ResponseWriter) { w.WriteHeader(http.StatusOK) }

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User")
		if r.Method == http.MethodOptions {
			returnOK(w)
			return
		}
		h.ServeHTTP(w, r)
	}
}

func currentUser(r *http.Request) string {
	u := strings.TrimSpace(r.Header.Get("X-User"))
	if u == "" {
		u = strings.TrimSpace(r.URL.Query().Get("user")) // для локальних тестів
	}
	return u
}

func isManufacturer(user string) bool {
	return manufacturerEmails[strings.ToLower(strings.TrimSpace(user))]
}
func isAdmin(user string) bool {
	return adminUsers[strings.ToLower(strings.TrimSpace(user))]
}

func loadAdminsFromEnv() {
	raw := strings.TrimSpace(os.Getenv("ADMIN_USERS"))
	if raw == "" {
		return
	}
	for _, a := range strings.Split(raw, ",") {
		a = strings.ToLower(strings.TrimSpace(a))
		if a != "" {
			adminUsers[a] = true
		}
	}
}

func slugify(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
			prevDash = false
		case r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				b.WriteRune('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "ITEM"
	}
	return out
}

func shortID() string {
	s := strings.ToUpper(strconv.FormatInt(time.Now().UnixNano(), 36))
	if len(s) <= 6 {
		return s
	}
	return s[len(s)-6:]
}

func genSerialFromName(name string, seq int, total int) string {
	base := slugify(name)
	y := time.Now().Year()
	if total > 1 {
		return fmt.Sprintf("%s-%d-%03d/%03d-%s", base, y, seq, total, shortID())
	}
	return fmt.Sprintf("%s-%d-%s", base, y, shortID())
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func mustJSONString(v any) string {
	b, _ := json.Marshal(v)
	if b == nil {
		return "[]"
	}
	return string(b)
}
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
func ifEmpty(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
func parseDateOrEmpty(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	return s
}
func mockSign(payload any) string {
	h := sha256.Sum256(mustJSON(payload))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

/************ БАЗА ДАНИХ ************/

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
  certificates    TEXT,
  image           TEXT,
  ipfs_hash       TEXT,
  serial_hash     TEXT    NOT NULL,
  state           TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  owner           TEXT,
  seller          TEXT,
  price_cents     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT    NOT NULL DEFAULT 'EUR',
  public_url      TEXT,
  brand           TEXT,
  brand_verified  INTEGER NOT NULL DEFAULT 0,
  edition_no      INTEGER NOT NULL DEFAULT 1,
  edition_total   INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_serial ON products(serial);
CREATE INDEX IF NOT EXISTS ix_products_state ON products(state);

CREATE TABLE IF NOT EXISTS ownership_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  owner       TEXT    NOT NULL,
  acquired_at INTEGER NOT NULL,
  released_at INTEGER,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_ownhist_prod ON ownership_history(product_id);

CREATE TABLE IF NOT EXISTS manufacturers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  owner        TEXT    NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0,
  verified_by  TEXT,
  verified_at  INTEGER
);
`
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("init schema: %v", err)
	}

	// best-effort ALTERs — не падаем, если уже есть
	_ = tryExec(`ALTER TABLE products ADD COLUMN edition_no INTEGER NOT NULL DEFAULT 1;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN edition_total INTEGER NOT NULL DEFAULT 1;`)
}

func tryExec(sqlStmt string) error { _, err := db.Exec(sqlStmt); return err }

/************ MANUFACTURERS REPO ************/

func getManufacturerBySlug(slug string) (*Manufacturer, error) {
	var m Manufacturer
	var v int
	var vb sql.NullString
	var va sql.NullInt64
	err := db.QueryRow(`SELECT id, name, slug, owner, verified, verified_by, verified_at FROM manufacturers WHERE slug=?`, slug).
		Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &v, &vb, &va)
	if err != nil {
		return nil, err
	}
	m.Verified = v == 1
	if vb.Valid {
		m.VerifiedBy = vb.String
	}
	if va.Valid {
		m.VerifiedAt = va.Int64
	}
	return &m, nil
}

/************ HTTP ************/

func main() {
	mustInitDB()
	loadAdminsFromEnv()

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"ok":             true,
			"time":           time.Now().UTC(),
			"publicBase":     publicBase,
			"admins":         adminUsers,
			"manufacturers5": manufacturerEmails,
		})
	})

	// Brand registry & verification
	mux.HandleFunc("/api/manufacturers", withCORS(manufacturersRoot))  // POST new, GET list
	mux.HandleFunc("/api/manufacturers/", withCORS(manufacturersItem)) // GET one, POST verify/unverify

	// Creation endpoints
	mux.HandleFunc("/api/manufacturer/products", withCORS(manufacturerCreateProducts)) // POST batch (role: manufacturer)
	mux.HandleFunc("/api/user/products", withCORS(userCreateProduct))                  // POST single (role: user)

	// List / actions / public verify
	mux.HandleFunc("/api/products", withCORS(productsList))    // GET
	mux.HandleFunc("/api/products/", withCORS(productActions)) // POST /{id}/purchase
	mux.HandleFunc("/api/verify/", withCORS(verifyProduct))    // GET /api/verify/{id}

	// Redirect
	mux.HandleFunc("/p/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/p/")
		http.Redirect(w, r, "/details.html?id="+id, http.StatusFound)
	})

	// Static
	root := os.Getenv("DOCS_DIR")
	if root == "" {
		wd, _ := os.Getwd()
		root = filepath.Join(wd, "docs")
	}
	mux.Handle("/", http.FileServer(http.Dir(root)))
	log.Println("Serving static from", root)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}
	addr := ":" + port
	log.Println("MARKI Secure backend running at", addr, "PUBLIC_BASE=", publicBase)
	log.Fatal(http.ListenAndServe(addr, mux))
}

/************ MANUFACTURERS HANDLERS ************/

type manCreateReq struct {
	Name string `json:"name"`
}

func manufacturersRoot(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w)
	case http.MethodPost:
		user := currentUser(r)
		if user == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		var req manCreateReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, 400, ErrorResp{"invalid json"})
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			writeJSON(w, 400, ErrorResp{"name is required"})
			return
		}
		slug := slugify(name)
		if m, err := getManufacturerBySlug(slug); err == nil {
			writeJSON(w, 200, m) // идемпотентно
			return
		}
		res, err := db.Exec(`INSERT INTO manufacturers (name, slug, owner, verified) VALUES (?,?,?,0)`, name, slug, user)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				writeJSON(w, 409, ErrorResp{"manufacturer already exists"})
				return
			}
			writeJSON(w, 500, ErrorResp{fmt.Sprintf("db insert error: %v", err)})
			return
		}
		id, _ := res.LastInsertId()
		writeJSON(w, 201, Manufacturer{ID: id, Name: name, Slug: slug, Owner: user, Verified: false})
	case http.MethodGet:
		user := currentUser(r)
		all := r.URL.Query().Get("all") == "1"
		var rows *sql.Rows
		var err error
		if all && isAdmin(user) {
			rows, err = db.Query(`SELECT id,name,slug,owner,verified,verified_by,verified_at FROM manufacturers ORDER BY id DESC`)
		} else {
			rows, err = db.Query(`SELECT id,name,slug,owner,verified,verified_by,verified_at FROM manufacturers WHERE owner=? OR verified=1 ORDER BY id DESC`, user)
		}
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		defer rows.Close()
		var out []Manufacturer
		for rows.Next() {
			var m Manufacturer
			var v int
			var vb sql.NullString
			var va sql.NullInt64
			if err := rows.Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &v, &vb, &va); err != nil {
				writeJSON(w, 500, ErrorResp{err.Error()})
				return
			}
			m.Verified = v == 1
			if vb.Valid {
				m.VerifiedBy = vb.String
			}
			if va.Valid {
				m.VerifiedAt = va.Int64
			}
			out = append(out, m)
		}
		if err := rows.Err(); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, out)
	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

func manufacturersItem(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w)
	case http.MethodGet:
		slug := strings.TrimPrefix(r.URL.Path, "/api/manufacturers/")
		if slug == "" {
			writeJSON(w, 404, ErrorResp{"not found"})
			return
		}
		m, err := getManufacturerBySlug(slug)
		if err == sql.ErrNoRows {
			writeJSON(w, 404, ErrorResp{"manufacturer not found"})
			return
		}
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, m)
	case http.MethodPost:
		path := strings.TrimPrefix(r.URL.Path, "/api/manufacturers/")
		parts := strings.Split(path, "/")
		if len(parts) != 2 {
			writeJSON(w, 404, ErrorResp{"not found"})
			return
		}
		slug, action := parts[0], parts[1]
		user := currentUser(r)
		if !isAdmin(user) {
			writeJSON(w, 403, ErrorResp{"admin only"})
			return
		}
		m, err := getManufacturerBySlug(slug)
		if err == sql.ErrNoRows {
			writeJSON(w, 404, ErrorResp{"manufacturer not found"})
			return
		}
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		now := time.Now().UnixMilli()
		switch action {
		case "verify":
			if _, err := db.Exec(`UPDATE manufacturers SET verified=1, verified_by=?, verified_at=? WHERE id=?`, user, now, m.ID); err != nil {
				writeJSON(w, 500, ErrorResp{err.Error()})
				return
			}
			m.Verified, m.VerifiedBy, m.VerifiedAt = true, user, now
			writeJSON(w, 200, m)
		case "unverify":
			if _, err := db.Exec(`UPDATE manufacturers SET verified=0, verified_by=NULL, verified_at=NULL WHERE id=?`, m.ID); err != nil {
				writeJSON(w, 500, ErrorResp{err.Error()})
				return
			}
			m.Verified, m.VerifiedBy, m.VerifiedAt = false, "", 0
			writeJSON(w, 200, m)
		default:
			writeJSON(w, 404, ErrorResp{"not found"})
		}
	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

/************ CREATE HANDLERS ************/

// Виробник: batch create (qty 1..100), можно задать свои serial/ipfs/image
type manufacturerCreateReq struct {
	Name           string `json:"name"`                     // required
	Image          string `json:"image,omitempty"`          // optional
	ManufacturedAt string `json:"manufacturedAt,omitempty"` // optional
	Brand          string `json:"brand,omitempty"`          // optional (slug)
	Serial         string `json:"serial,omitempty"`         // optional (base serial, будет -001..)
	IPFSHash       string `json:"ipfsHash,omitempty"`       // optional
	Qty            int    `json:"qty,omitempty"`            // optional, default 1, max 100
}

func manufacturerCreateProducts(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}
	user := currentUser(r)
	if user == "" {
		writeJSON(w, 401, ErrorResp{"missing user"})
		return
	}
	if !isManufacturer(user) {
		writeJSON(w, 403, ErrorResp{"manufacturer only"})
		return
	}

	var req manufacturerCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, 400, ErrorResp{"name is required"})
		return
	}
	qty := req.Qty
	if qty <= 0 {
		qty = 1
	}
	if qty > 100 {
		qty = 100
	}
	brandSlug := strings.TrimSpace(req.Brand)
	if brandSlug != "" {
		brandSlug = slugify(brandSlug)
	}
	brandVerified := false
	if brandSlug != "" {
		if m, err := getManufacturerBySlug(brandSlug); err == nil && m.Verified {
			brandVerified = true
		}
	}

	now := time.Now().UnixMilli()
	created := make([]Product, 0, qty)

	for i := 1; i <= qty; i++ {
		editionNo := i
		editionTotal := qty

		serial := strings.TrimSpace(req.Serial)
		if serial != "" {
			serial = slugify(serial)
			serial = fmt.Sprintf("%s-%03d", serial, i)
		} else {
			serial = genSerialFromName(name, i, qty)
		}
		manuf := parseDateOrEmpty(req.ManufacturedAt)
		if manuf == "" {
			manuf = time.Now().Format("2006-01-02")
		}

		meta := Metadata{
			Name:           name,
			ManufacturedAt: manuf,
			Serial:         serial,
			Certificates:   []string{},
			Image:          strings.TrimSpace(req.Image),
			Version:        1,
		}
		ipfs := strings.TrimSpace(req.IPFSHash)
		if ipfs == "" {
			ipfs = sha256Hex(string(mustJSON(meta)))[:46]
		}
		serialHash := sha256Hex(serial)

		certJSON := mustJSONString(meta.Certificates)
		res, err := db.Exec(`
INSERT INTO products (name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at, owner, seller, public_url, brand, brand_verified, edition_no, edition_total)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			meta.Name, meta.ManufacturedAt, meta.Serial, certJSON, meta.Image,
			ipfs, serialHash, string(StateCreated), now, user, user, "", brandSlug, boolToInt(brandVerified), editionNo, editionTotal,
		)
		if err != nil {
			writeJSON(w, 500, ErrorResp{fmt.Sprintf("db insert error: %v", err)})
			return
		}
		id, _ := res.LastInsertId()

		publicURL := ""
		if publicBase != "" {
			publicURL = fmt.Sprintf("%s/details.html?id=%d", publicBase, id)
			_, _ = db.Exec(`UPDATE products SET public_url=? WHERE id=?`, publicURL, id)
		}

		_, _ = db.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`, id, user, now)

		payload := map[string]any{
			"t":   "prod",
			"std": "1155",
			"id":  id,
			"s":   serialHash,
			"iss": "MARKI_SECURE",
			"v":   1,
		}
		if publicURL != "" {
			payload["url"] = publicURL
		}
		payload["sig"] = mockSign(payload)

		created = append(created, Product{
			ID:            id,
			Meta:          meta,
			IPFSHash:      ipfs,
			SerialHash:    serialHash,
			State:         StateCreated,
			CreatedAt:     now,
			QRPayload:     payload,
			PublicURL:     publicURL,
			Owner:         user,
			Seller:        user,
			Brand:         brandSlug,
			BrandVerified: brandVerified,
			EditionNo:     editionNo,
			EditionTotal:  editionTotal,
		})
	}

	writeJSON(w, 201, created) // массив продуктов
}

// Звичайний користувач: одиночне створення (вимагає manufacturedAt)
type userCreateReq struct {
	Name           string `json:"name"`            // required
	ManufacturedAt string `json:"manufacturedAt"`  // required YYYY-MM-DD
	Image          string `json:"image,omitempty"` // optional
}

func userCreateProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}
	user := currentUser(r)
	if user == "" {
		writeJSON(w, 401, ErrorResp{"missing user"})
		return
	}
	if isManufacturer(user) {
		writeJSON(w, 403, ErrorResp{"use /api/manufacturer/products"})
		return
	}

	var req userCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, 400, ErrorResp{"name is required"})
		return
	}
	manuf := strings.TrimSpace(req.ManufacturedAt)
	if manuf == "" {
		writeJSON(w, 400, ErrorResp{"manufacturedAt is required"})
		return
	}

	serial := genSerialFromName(name, 1, 1)
	meta := Metadata{
		Name:           name,
		ManufacturedAt: manuf,
		Serial:         serial,
		Certificates:   []string{},
		Image:          strings.TrimSpace(req.Image),
		Version:        1,
	}
	ipfs := sha256Hex(string(mustJSON(meta)))[:46]
	serialHash := sha256Hex(serial)
	now := time.Now().UnixMilli()

	certJSON := mustJSONString(meta.Certificates)
	res, err := db.Exec(`
INSERT INTO products (name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at, owner, seller, public_url, brand, brand_verified, edition_no, edition_total)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.Name, meta.ManufacturedAt, meta.Serial, certJSON, meta.Image,
		ipfs, serialHash, string(StateCreated), now, user, user, "", "", 0, 1, 1,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeJSON(w, 409, ErrorResp{"product with this serial already exists"})
			return
		}
		writeJSON(w, 500, ErrorResp{fmt.Sprintf("db insert error: %v", err)})
		return
	}
	id, _ := res.LastInsertId()

	publicURL := ""
	if publicBase != "" {
		publicURL = fmt.Sprintf("%s/details.html?id=%d", publicBase, id)
		_, _ = db.Exec(`UPDATE products SET public_url=? WHERE id=?`, publicURL, id)
	}
	_, _ = db.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`, id, user, now)

	payload := map[string]any{
		"t":   "prod",
		"std": "1155",
		"id":  id,
		"s":   serialHash,
		"iss": "MARKI_SECURE",
		"v":   1,
	}
	if publicURL != "" {
		payload["url"] = publicURL
	}
	payload["sig"] = mockSign(payload)

	writeJSON(w, 201, Product{
		ID:            id,
		Meta:          meta,
		IPFSHash:      ipfs,
		SerialHash:    serialHash,
		State:         StateCreated,
		CreatedAt:     now,
		QRPayload:     payload,
		PublicURL:     publicURL,
		Owner:         user,
		Seller:        user,
		Brand:         "",
		BrandVerified: false,
		EditionNo:     1,
		EditionTotal:  1,
	})
}

/************ LIST / ACTIONS ************/

func productsList(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}
	user := currentUser(r)
	if user == "" {
		writeJSON(w, 401, ErrorResp{"missing user"})
		return
	}
	// виробник бачить все; юзер — тільки свої owner/seller
	var (
		rows *sql.Rows
		err  error
	)
	baseSelect := `
SELECT id,name,manufactured_at,serial,certificates,image,
       ipfs_hash,serial_hash,state,created_at,owner,seller,public_url,
       brand,brand_verified,edition_no,edition_total
FROM products
`
	if isManufacturer(user) {
		rows, err = db.Query(baseSelect + " ORDER BY id DESC")
	} else {
		rows, err = db.Query(baseSelect+`
WHERE owner=? OR seller=?
ORDER BY id DESC`, user, user)
	}
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
			owner, seller, publicURL, brand                               sql.NullString
			brandVerified, editionNo, editionTotal                        int
		)
		if err := rows.Scan(
			&id, &name, &mfgAt, &serial, &certJSON, &image,
			&ipfs, &serialHash, &state, &created,
			&owner, &seller, &publicURL, &brand, &brandVerified, &editionNo, &editionTotal,
		); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		var certs []string
		_ = json.Unmarshal([]byte(ifEmpty(certJSON, "[]")), &certs)
		meta := Metadata{
			Name:           name,
			ManufacturedAt: mfgAt,
			Serial:         serial,
			Certificates:   certs,
			Image:          image,
			Version:        1,
		}
		list = append(list, Product{
			ID:            id,
			Meta:          meta,
			IPFSHash:      ipfs,
			SerialHash:    serialHash,
			State:         State(state),
			CreatedAt:     created,
			Owner:         owner.String,
			Seller:        seller.String,
			PublicURL:     publicURL.String,
			Brand:         brand.String,
			BrandVerified: brandVerified == 1,
			EditionNo:     editionNo,
			EditionTotal:  editionTotal,
		})
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, list)
}

// POST /api/products/{id}/purchase
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
		buyer := currentUser(r)
		if buyer == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		var curOwner, state string
		err := db.QueryRow(`SELECT owner, state FROM products WHERE id=?`, id).Scan(&curOwner, &state)
		if err == sql.ErrNoRows {
			writeJSON(w, 404, ErrorResp{"product not found"})
			return
		}
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		if buyer == curOwner {
			writeJSON(w, 409, ErrorResp{"already owned by you"})
			return
		}

		tx, err := db.Begin()
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		defer func() { _ = tx.Rollback() }()

		now := time.Now().UnixMilli()
		_, _ = tx.Exec(`UPDATE ownership_history SET released_at=? WHERE product_id=? AND released_at IS NULL`, now, id)
		if _, err = tx.Exec(`UPDATE products SET state=?, owner=? WHERE id=?`, string(StatePurchased), buyer, id); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		_, _ = tx.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`, id, buyer, now)

		if err := tx.Commit(); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "state": StatePurchased})
		return
	}

	writeJSON(w, 404, ErrorResp{"not found"})
}

/************ PUBLIC VERIFY ************/

func verifyProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}
	requester := currentUser(r)
	idStr := strings.TrimPrefix(r.URL.Path, "/api/verify/")
	tokenID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeJSON(w, 400, ErrorResp{"bad id"})
		return
	}

	var (
		name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
		created                                                       int64
		owner, seller, publicURL                                      string
	)
	err = db.QueryRow(`SELECT name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at, owner, seller, public_url
		FROM products WHERE id=?`, tokenID).
		Scan(&name, &mfgAt, &serial, &certJSON, &image, &ipfs, &serialHash, &state, &created, &owner, &seller, &publicURL)
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
		Name:           name,
		ManufacturedAt: mfgAt,
		Serial:         serial,
		Certificates:   certs,
		Image:          image,
		Version:        1,
	}

	if requester != "" && (requester == owner || requester == seller) {
		writeJSON(w, 200, map[string]any{
			"state":      state,
			"tokenId":    tokenID,
			"metadata":   meta,
			"ipfsHash":   ipfs,
			"serialHash": serialHash,
			"owner":      owner,
			"seller":     seller,
			"publicUrl":  publicURL,
			"scope":      "full",
		})
		return
	}

	publicMeta := Metadata{
		Name:           meta.Name,
		ManufacturedAt: meta.ManufacturedAt,
		Serial:         "",
		Certificates:   meta.Certificates,
		Image:          meta.Image,
		Version:        meta.Version,
	}
	writeJSON(w, 200, map[string]any{
		"state":     state,
		"tokenId":   tokenID,
		"metadata":  publicMeta,
		"publicUrl": publicURL,
		"scope":     "public",
	})
}
