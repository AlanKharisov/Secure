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

/* ========================= Types ========================= */

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
	ID           int64    `json:"id"`
	Meta         Metadata `json:"meta"`
	IPFSHash     string   `json:"ipfsHash,omitempty"`
	SerialHash   string   `json:"serialHash,omitempty"`
	State        State    `json:"state"`
	CreatedAt    int64    `json:"createdAt"`
	QRPayload    any      `json:"qrPayload,omitempty"`
	PublicURL    string   `json:"publicUrl,omitempty"`
	Owner        string   `json:"owner,omitempty"`
	Seller       string   `json:"seller,omitempty"`
	Brand        string   `json:"brand,omitempty"`        // slug
	EditionTotal int      `json:"editionTotal,omitempty"` // total in batch
	EditionNo    int      `json:"editionNo,omitempty"`    // 1..EditionTotal
}

type ErrorResp struct {
	Error string `json:"error"`
}

type Manufacturer struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	Owner      string `json:"owner"`
	Verified   bool   `json:"verified"`
	VerifiedBy string `json:"verifiedBy,omitempty"`
	VerifiedAt int64  `json:"verifiedAt,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

/* ========================= Globals ========================= */

var (
	db         *sql.DB
	publicBase = strings.TrimRight(os.Getenv("PUBLIC_BASE"), "/")
)

var adminUsers = map[string]bool{}

func isAdmin(user string) bool {
	return adminUsers[strings.ToLower(strings.TrimSpace(user))]
}

/* ========================= Utils ========================= */

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func returnOK(w http.ResponseWriter) { w.WriteHeader(http.StatusOK) }

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
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
		u = strings.TrimSpace(r.URL.Query().Get("user"))
	}
	return strings.ToLower(u)
}

func slugify(s string) string {
	s = strings.ToUpper(s)
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
	base := strconv.FormatInt(time.Now().UnixNano(), 36)
	if len(base) < 6 {
		return strings.ToUpper(base)
	}
	return strings.ToUpper(base[len(base)-6:])
}

func genSerialFromName(name string, edNo, edTotal int) string {
	base := slugify(name)
	y := time.Now().Year()
	if edTotal > 1 {
		return fmt.Sprintf("%s-%d-%s-%dOF%d", base, y, shortID(), edNo, edTotal)
	}
	return fmt.Sprintf("%s-%d-%s", base, y, shortID())
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func mockSign(payload any) string {
	h := sha256.Sum256(mustJSON(payload))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func mustJSONString(v any) string {
	b, _ := json.Marshal(v)
	if b == nil {
		return "null"
	}
	return string(b)
}

func ifEmpty(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

/* ========================= DB ========================= */

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
  brand_slug      TEXT,
  edition_total   INTEGER NOT NULL DEFAULT 1,
  edition_no      INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_serial ON products(serial);
CREATE INDEX IF NOT EXISTS ix_products_state ON products(state);
CREATE INDEX IF NOT EXISTS ix_products_owner ON products(owner);
CREATE INDEX IF NOT EXISTS ix_products_brand ON products(brand_slug);

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
  verified_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_man_owner ON manufacturers(owner);

CREATE TABLE IF NOT EXISTS admins (
  email      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("init schema: %v", err)
	}

	// best-effort ALTERs
	_ = tryExec(`ALTER TABLE products ADD COLUMN owner TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN seller TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR';`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN public_url TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN brand_slug TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN edition_total INTEGER NOT NULL DEFAULT 1;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN edition_no INTEGER NOT NULL DEFAULT 1;`)
}

func tryExec(sqlStmt string) error {
	_, err := db.Exec(sqlStmt)
	return err
}

/* ========================= Admin bootstrap ========================= */

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

func loadAdminsFromDB() {
	rows, err := db.Query(`SELECT email FROM admins`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err == nil {
			adminUsers[strings.ToLower(strings.TrimSpace(e))] = true
		}
	}
}

func adminsRoot(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w)
		return
	case http.MethodGet:
		u := currentUser(r)
		if !isAdmin(u) {
			writeJSON(w, http.StatusForbidden, ErrorResp{"admin only"})
			return
		}
		var list []string
		rows, err := db.Query(`SELECT email FROM admins ORDER BY email`)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var e string
			_ = rows.Scan(&e)
			list = append(list, e)
		}
		writeJSON(w, http.StatusOK, map[string]any{"admins": list})
	case http.MethodPost:
		// POST /api/admins/bootstrap  — если нет админов вообще, сделать текущего (X-User) админом
		if strings.HasSuffix(r.URL.Path, "/bootstrap") {
			u := currentUser(r)
			if u == "" {
				writeJSON(w, http.StatusUnauthorized, ErrorResp{"missing user"})
				return
			}
			var cnt int
			_ = db.QueryRow(`SELECT COUNT(1) FROM admins`).Scan(&cnt)
			if cnt > 0 {
				writeJSON(w, http.StatusForbidden, ErrorResp{"already initialized"})
				return
			}
			now := time.Now().UnixMilli()
			if _, err := db.Exec(`INSERT INTO admins(email, created_at) VALUES(?,?)`, u, now); err != nil {
				writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
				return
			}
			adminUsers[u] = true
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "admin": u})
			return
		}
		writeJSON(w, http.StatusNotFound, ErrorResp{"not found"})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, ErrorResp{"Method not allowed"})
	}
}

/* ========================= HTTP ========================= */

func main() {
	mustInitDB()
	loadAdminsFromEnv() // опционально
	loadAdminsFromDB()  // основное хранение — в БД

	mux := http.NewServeMux()

	// health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"time":       time.Now().UTC(),
			"publicBase": publicBase,
			"admins":     len(adminUsers),
		})
	})

	// Admins
	mux.HandleFunc("/api/admins", withCORS(adminsRoot))                  // GET
	mux.HandleFunc("/api/admins/bootstrap", withCORS(adminsRoot))        // POST

	// Manufacturers
	mux.HandleFunc("/api/manufacturers", withCORS(manufacturersRoot))    // POST/GET
	mux.HandleFunc("/api/manufacturers/", withCORS(manufacturersItem))   // GET/{slug}, POST/{slug}/verify

	// Products
	mux.HandleFunc("/api/manufacturer/products", withCORS(manufacturerCreateProduct)) // POST
	mux.HandleFunc("/api/products", withCORS(productsList))                           // GET
	mux.HandleFunc("/api/products/", withCORS(productActions))                        // POST /purchase
	mux.HandleFunc("/api/verify/", withCORS(verifyProduct))                           // GET /api/verify/{id}

	// public redirect
	mux.HandleFunc("/p/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/p/")
		http.Redirect(w, r, "/details.html?id="+id, http.StatusFound)
	})

	// static
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

/* ========================= Manufacturers handlers ========================= */

type manufCreateReq struct {
	Name string `json:"name"`
}

func manufacturersRoot(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w)
		return
	case http.MethodPost:
		user := currentUser(r)
		if user == "" {
			writeJSON(w, http.StatusUnauthorized, ErrorResp{"missing user"})
			return
		}
		var req manufCreateReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
			writeJSON(w, http.StatusBadRequest, ErrorResp{"invalid json or name"})
			return
		}
		name := strings.TrimSpace(req.Name)
		slug := slugify(name)
		now := time.Now().UnixMilli()

		// if exists — return existing (200)
		var (
			id          int64
			exName      string
			exSlug      string
			exOwner     string
			ver         int
			verBy       sql.NullString
			verAt       sql.NullInt64
			createdAt   int64
		)
		err := db.QueryRow(`SELECT id,name,slug,owner,verified,verified_by,verified_at,created_at FROM manufacturers WHERE slug=?`, slug).
			Scan(&id, &exName, &exSlug, &exOwner, &ver, &verBy, &verAt, &createdAt)
		if err == nil {
			m := Manufacturer{
				ID:         id,
				Name:       exName,
				Slug:       exSlug,
				Owner:      exOwner,
				Verified:   ver == 1,
				VerifiedBy: ifEmpty(verBy.String, ""),
				VerifiedAt: verAt.Int64,
				CreatedAt:  createdAt,
			}
			writeJSON(w, http.StatusOK, m)
			return
		}
		if err != nil && err != sql.ErrNoRows {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}

		res, err := db.Exec(`INSERT INTO manufacturers (name,slug,owner,created_at) VALUES (?,?,?,?)`,
			name, slug, user, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{fmt.Sprintf("db insert error: %v", err)})
			return
		}
		newID, _ := res.LastInsertId()
		writeJSON(w, http.StatusCreated, Manufacturer{
			ID:        newID,
			Name:      name,
			Slug:      slug,
			Owner:     user,
			Verified:  false,
			CreatedAt: now,
		})
	case http.MethodGet:
		user := currentUser(r)
		if user == "" {
			writeJSON(w, http.StatusUnauthorized, ErrorResp{"missing user"})
			return
		}
		all := r.URL.Query().Get("all") == "1"
		ownerQ := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("owner")))

		var rows *sql.Rows
		var err error
		if all && isAdmin(user) {
			rows, err = db.Query(`SELECT id,name,slug,owner,verified,verified_by,verified_at,created_at FROM manufacturers ORDER BY id DESC`)
		} else if ownerQ != "" && (ownerQ == user || isAdmin(user)) {
			rows, err = db.Query(`SELECT id,name,slug,owner,verified,verified_by,verified_at,created_at FROM manufacturers WHERE owner=? ORDER BY id DESC`, ownerQ)
		} else {
			rows, err = db.Query(`SELECT id,name,slug,owner,verified,verified_by,verified_at,created_at FROM manufacturers WHERE owner=? ORDER BY id DESC`, user)
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}
		defer rows.Close()

		out := []Manufacturer{}
		for rows.Next() {
			var (
				id      int64
				name    string
				slug    string
				owner   string
				ver     int
				verBy   sql.NullString
				verAt   sql.NullInt64
				created int64
			)
			if err := rows.Scan(&id, &name, &slug, &owner, &ver, &verBy, &verAt, &created); err != nil {
				writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
				return
			}
			out = append(out, Manufacturer{
				ID:         id,
				Name:       name,
				Slug:       slug,
				Owner:      owner,
				Verified:   ver == 1,
				VerifiedBy: ifEmpty(verBy.String, ""),
				VerifiedAt: verAt.Int64,
				CreatedAt:  created,
			})
		}
		writeJSON(w, http.StatusOK, out)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, ErrorResp{"Method not allowed"})
	}
}

func manufacturersItem(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w)
		return
	case http.MethodGet, http.MethodPost:
		rest := strings.TrimPrefix(r.URL.Path, "/api/manufacturers/")
		parts := strings.Split(strings.Trim(rest, "/"), "/")
		if len(parts) == 0 || parts[0] == "" {
			writeJSON(w, http.StatusNotFound, ErrorResp{"not found"})
			return
		}
		slug := parts[0]

		if len(parts) == 1 && r.Method == http.MethodGet {
			var (
				id      int64
				name    string
				sl      string
				owner   string
				ver     int
				verBy   sql.NullString
				verAt   sql.NullInt64
				created int64
			)
			err := db.QueryRow(`SELECT id,name,slug,owner,verified,verified_by,verified_at,created_at FROM manufacturers WHERE slug=?`, slug).
				Scan(&id, &name, &sl, &owner, &ver, &verBy, &verAt, &created)
			if err == sql.ErrNoRows {
				writeJSON(w, http.StatusNotFound, ErrorResp{"manufacturer not found"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, Manufacturer{
				ID:         id,
				Name:       name,
				Slug:       sl,
				Owner:      owner,
				Verified:   ver == 1,
				VerifiedBy: ifEmpty(verBy.String, ""),
				VerifiedAt: verAt.Int64,
				CreatedAt:  created,
			})
			return
		}

		if len(parts) == 2 && parts[1] == "verify" && r.Method == http.MethodPost {
			user := currentUser(r)
			if !isAdmin(user) {
				writeJSON(w, http.StatusForbidden, ErrorResp{"admin only"})
				return
			}
			now := time.Now().UnixMilli()
			_, err := db.Exec(`UPDATE manufacturers SET verified=1, verified_by=?, verified_at=? WHERE slug=?`, user, now, slug)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
				return
			}
			// return updated
			var (
				id      int64
				name    string
				sl      string
				owner   string
				ver     int
				verBy   sql.NullString
				verAt   sql.NullInt64
				created int64
			)
			err = db.QueryRow(`SELECT id,name,slug,owner,verified,verified_by,verified_at,created_at FROM manufacturers WHERE slug=?`, slug).
				Scan(&id, &name, &sl, &owner, &ver, &verBy, &verAt, &created)
			if err == sql.ErrNoRows {
				writeJSON(w, http.StatusNotFound, ErrorResp{"manufacturer not found"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, Manufacturer{
				ID:         id,
				Name:       name,
				Slug:       sl,
				Owner:      owner,
				Verified:   ver == 1,
				VerifiedBy: ifEmpty(verBy.String, ""),
				VerifiedAt: verAt.Int64,
				CreatedAt:  created,
			})
			return
		}

		writeJSON(w, http.StatusNotFound, ErrorResp{"not found"})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, ErrorResp{"Method not allowed"})
	}
}

/* ========================= Products handlers ========================= */

type createReq struct {
	Name           string `json:"name"`                     // required
	Image          string `json:"image,omitempty"`          // optional
	ManufacturedAt string `json:"manufacturedAt,omitempty"` // optional (YYYY-MM-DD)
	Brand          string `json:"brand,omitempty"`          // optional (slug)
	EditionCount   int    `json:"editionCount,omitempty"`   // optional, default 1
}

func manufacturerCreateProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, ErrorResp{"Method not allowed"})
		return
	}

	user := currentUser(r)
	if user == "" {
		writeJSON(w, http.StatusUnauthorized, ErrorResp{"missing user"})
		return
	}

	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResp{"invalid json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, ErrorResp{"name is required"})
		return
	}

	brandSlug := strings.TrimSpace(req.Brand)
	if brandSlug != "" {
		var owner string
		err := db.QueryRow(`SELECT owner FROM manufacturers WHERE slug=?`, brandSlug).Scan(&owner)
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusBadRequest, ErrorResp{"brand not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}
		if owner != user && !isAdmin(user) {
			writeJSON(w, http.StatusForbidden, ErrorResp{"not an owner of the brand"})
			return
		}
	}

	edTotal := req.EditionCount
	if edTotal <= 0 {
		edTotal = 1
	}

	img := strings.TrimSpace(req.Image)
	mfgAt := strings.TrimSpace(req.ManufacturedAt)
	if mfgAt == "" {
		mfgAt = time.Now().Format("2006-01-02")
	}
	now := time.Now().UnixMilli()

	created := []Product{}
	for i := 1; i <= edTotal; i++ {
		serial := genSerialFromName(name, i, edTotal)
		meta := Metadata{
			Name:           name,
			ManufacturedAt: mfgAt,
			Serial:         serial,
			Certificates:   []string{},
			Image:          img,
			Version:        1,
		}
		ipfsHash := sha256Hex(string(mustJSON(meta)))[:46]
		serialHash := sha256Hex(serial)

		certJSON := mustJSONString(meta.Certificates)
		res, err := db.Exec(`
INSERT INTO products (name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at, owner, seller, brand_slug, edition_total, edition_no)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			meta.Name, meta.ManufacturedAt, meta.Serial, certJSON, meta.Image,
			ipfsHash, serialHash, string(StateCreated), now, user, user, brandSlug, edTotal, i,
		)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				writeJSON(w, http.StatusConflict, ErrorResp{"product with this serial already exists"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, ErrorResp{fmt.Sprintf("db insert error: %v", err)})
			return
		}
		id, _ := res.LastInsertId()

		publicURL := ""
		if publicBase != "" {
			publicURL = fmt.Sprintf("%s/details.html?id=%d", publicBase, id)
		}
		_, _ = db.Exec(`UPDATE products SET public_url=? WHERE id=?`, publicURL, id)

		_, _ = db.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`,
			id, user, now)

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
			ID:           id,
			Meta:         meta,
			IPFSHash:     ipfsHash,
			SerialHash:   serialHash,
			State:        StateCreated,
			CreatedAt:    now,
			QRPayload:    payload,
			PublicURL:    publicURL,
			Owner:        user,
			Seller:       user,
			Brand:        brandSlug,
			EditionTotal: edTotal,
			EditionNo:    i,
		})
	}

	if len(created) == 1 {
		writeJSON(w, http.StatusCreated, created[0])
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"ok":      true,
		"created": created,
	})
}

// GET /api/products  (?owner=...)  / ?all=1 for admins
func productsList(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, ErrorResp{"Method not allowed"})
		return
	}

	user := currentUser(r)
	if user == "" {
		writeJSON(w, http.StatusUnauthorized, ErrorResp{"missing user"})
		return
	}

	wantAll := r.URL.Query().Get("all") == "1"
	ownerQ := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("owner")))

	var (
		rows *sql.Rows
		err  error
	)

	baseSelect := `
SELECT
  id, name, manufactured_at, serial, certificates, image,
  ipfs_hash, serial_hash, state, created_at,
  owner, seller, public_url,
  brand_slug, edition_total, edition_no
FROM products
`
	if wantAll && isAdmin(user) {
		rows, err = db.Query(baseSelect + ` ORDER BY id DESC`)
	} else if ownerQ != "" && (ownerQ == user || isAdmin(user)) {
		rows, err = db.Query(baseSelect+`
WHERE owner = ?
ORDER BY id DESC`, ownerQ)
	} else {
		rows, err = db.Query(baseSelect+`
WHERE owner = ? OR seller = ?
ORDER BY id DESC`, user, user)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
		return
	}
	defer rows.Close()

	var list []Product
	for rows.Next() {
		var (
			id                                                            int64
			name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
			created                                                       int64
			owner, seller, publicURL                                      string
			brandSlug                                                     sql.NullString
			edTotal, edNo                                                 int
		)
		if err := rows.Scan(
			&id, &name, &mfgAt, &serial, &certJSON, &image,
			&ipfs, &serialHash, &state, &created,
			&owner, &seller, &publicURL,
			&brandSlug, &edTotal, &edNo,
		); err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
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
			ID:           id,
			Meta:         meta,
			IPFSHash:     ipfs,
			SerialHash:   serialHash,
			State:        State(state),
			CreatedAt:    created,
			Owner:        owner,
			Seller:       seller,
			PublicURL:    publicURL,
			Brand:        brandSlug.String,
			EditionTotal: edTotal,
			EditionNo:    edNo,
		})
	}

	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// /api/products/{id}/purchase  (POST)
func productActions(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/products/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, ErrorResp{"not found"})
		return
	}
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResp{"bad id"})
		return
	}

	// purchase
	if len(parts) == 2 && parts[1] == "purchase" && r.Method == http.MethodPost {
		buyer := currentUser(r)
		if buyer == "" {
			writeJSON(w, http.StatusUnauthorized, ErrorResp{"missing user"})
			return
		}

		var curOwner, state string
		err := db.QueryRow(`SELECT owner, state FROM products WHERE id=?`, id).Scan(&curOwner, &state)
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, ErrorResp{"product not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}
		if buyer == curOwner {
			writeJSON(w, http.StatusConflict, ErrorResp{"already owned by you"})
			return
		}

		tx, err := db.Begin()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}
		defer func() { _ = tx.Rollback() }()

		now := time.Now().UnixMilli()
		_, _ = tx.Exec(`UPDATE ownership_history SET released_at=? WHERE product_id=? AND released_at IS NULL`, now, id)

		_, err = tx.Exec(`UPDATE products SET state=?, owner=? WHERE id=?`, string(StatePurchased), buyer, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}
		_, _ = tx.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`, id, buyer, now)

		if err := tx.Commit(); err != nil {
			writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": StatePurchased})
		return
	}

	writeJSON(w, http.StatusNotFound, ErrorResp{"not found"})
}

// GET /api/verify/{id} — public/limited view
func verifyProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, ErrorResp{"Method not allowed"})
		return
	}

	requester := currentUser(r)
	idStr := strings.TrimPrefix(r.URL.Path, "/api/verify/")
	tokenID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResp{"bad id"})
		return
	}

	var (
		name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
		created                                                       int64
		owner, seller, publicURL                                      string
		brandSlug                                                     sql.NullString
		edTotal, edNo                                                 int
	)
	err = db.QueryRow(`SELECT name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at, owner, seller, public_url, brand_slug, edition_total, edition_no
		FROM products WHERE id=?`, tokenID).
		Scan(&name, &mfgAt, &serial, &certJSON, &image, &ipfs, &serialHash, &state, &created, &owner, &seller, &publicURL, &brandSlug, &edTotal, &edNo)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, ErrorResp{"product not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, ErrorResp{err.Error()})
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
		resp := map[string]any{
			"state":        state,
			"tokenId":      tokenID,
			"metadata":     meta,
			"ipfsHash":     ipfs,
			"serialHash":   serialHash,
			"owner":        owner,
			"seller":       seller,
			"publicUrl":    publicURL,
			"brand":        brandSlug.String,
			"editionTotal": edTotal,
			"editionNo":    edNo,
			"scope":        "full",
		}
		writeJSON(w, http.StatusOK, resp)
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
	resp := map[string]any{
		"state":        state,
		"tokenId":      tokenID,
		"metadata":     publicMeta,
		"publicUrl":    publicURL,
		"brand":        brandSlug.String,
		"editionTotal": edTotal,
		"editionNo":    edNo,
		"scope":        "public",
	}
	writeJSON(w, http.StatusOK, resp)
}
