// main.go
package main

import (
	"context"
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
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/option"
	_ "modernc.org/sqlite"
)

/*
ENV, які варто встановити у проді (Render):

PUBLIC_BASE = https://app.world-of-photo.com
PORT = 5000

# опціонально: початкові адміни (через кому, нижній регістр не обов'язковий)
ADMIN_USERS = you@example.com,cofounder@site.com

# Firestore дзеркалення (опціонально; якщо не задано — просто вимкнено)
FIRESTORE_PROJECT_ID = your-gcp-project-id
# один з варіантів автентифікації:
GOOGLE_APPLICATION_CREDENTIALS = /path/to/service-account.json
# або, якщо зручніше тримати JSON у змінній:
FIREBASE_SERVICE_ACCOUNT_JSON = { ... JSON ... }
*/

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
	BrandSlug    string   `json:"brandSlug,omitempty"`
	Meta         Metadata `json:"meta"`
	IPFSHash     string   `json:"ipfsHash,omitempty"`
	SerialHash   string   `json:"serialHash,omitempty"`
	State        State    `json:"state"`
	CreatedAt    int64    `json:"createdAt"`
	QRPayload    any      `json:"qrPayload,omitempty"`
	PublicURL    string   `json:"publicUrl,omitempty"`
	Owner        string   `json:"owner,omitempty"`
	Seller       string   `json:"seller,omitempty"`
	EditionNo    int      `json:"editionNo,omitempty"`
	EditionTotal int      `json:"editionTotal,omitempty"`
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

type ErrorResp struct {
	Error string `json:"error"`
}

var (
	db         *sql.DB
	publicBase = strings.TrimRight(os.Getenv("PUBLIC_BASE"), "/")
)

// ---------- Firestore (optional) ----------
var (
	fsOnce       sync.Once
	fsClient     *firestore.Client
	fsProjectID  = strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID"))
	fsJSONInline = strings.TrimSpace(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON"))
	fsEnabled    = false
)

func initFirestore(ctx context.Context) {
	fsOnce.Do(func() {
		if fsProjectID == "" {
			log.Println("[fs] disabled: FIRESTORE_PROJECT_ID empty")
			return
		}
		var client *firestore.Client
		var err error
		if fsJSONInline != "" {
			client, err = firestore.NewClient(ctx, fsProjectID, option.WithCredentialsJSON([]byte(fsJSONInline)))
		} else {
			// relies on GOOGLE_APPLICATION_CREDENTIALS or default creds
			client, err = firestore.NewClient(ctx, fsProjectID)
		}
		if err != nil {
			log.Printf("[fs] init error: %v (disabled)\n", err)
			return
		}
		fsClient = client
		fsEnabled = true
		log.Println("[fs] enabled for project:", fsProjectID)
	})
}

func fsClose() {
	if fsClient != nil {
		_ = fsClient.Close()
	}
}

func fsWrite(path string, data map[string]any) {
	if !fsEnabled || fsClient == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_, err := fsClient.Doc(path).Set(ctx, data, firestore.MergeAll)
	if err != nil {
		log.Printf("[fs] set %s error: %v\n", path, err)
	}
}

func fsAdd(collection string, data map[string]any) {
	if !fsEnabled || fsClient == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_, _, err := fsClient.Collection(collection).Add(ctx, data)
	if err != nil {
		log.Printf("[fs] add %s error: %v\n", collection, err)
	}
}

// ---------- utils ----------

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
		u = strings.TrimSpace(r.URL.Query().Get("user")) // for local tests
	}
	return u
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
	raw := strconv.FormatInt(time.Now().UnixNano(), 36)
	up := strings.ToUpper(raw)
	if len(up) < 6 {
		return up
	}
	return up[len(up)-6:]
}

func genSerial(baseName string, editionNo, editionTotal int) string {
	base := slugify(baseName)
	y := time.Now().Year()
	if editionTotal > 1 && editionNo > 0 {
		return fmt.Sprintf("%s-%d-%d/%d-%s", base, y, editionNo, editionTotal, shortID())
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
func mustJSONString(v any) string {
	b, _ := json.Marshal(v)
	if b == nil {
		return "null"
	}
	return string(b)
}
func mockSign(payload any) string {
	h := sha256.Sum256(mustJSON(payload))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func ifEmpty(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// ---------- DB ----------

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
  brand_slug      TEXT,
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
  edition_no      INTEGER NOT NULL DEFAULT 1,
  edition_total   INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_serial ON products(serial);
CREATE INDEX IF NOT EXISTS ix_products_state ON products(state);
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
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  owner        TEXT NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0,
  verified_by  TEXT,
  verified_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_manuf_owner ON manufacturers(owner);

CREATE TABLE IF NOT EXISTS admins (
  email TEXT PRIMARY KEY
);
`
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("init schema: %v", err)
	}

	// best-effort ALTERs
	_ = tryExec(`ALTER TABLE products ADD COLUMN brand_slug TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN edition_no INTEGER NOT NULL DEFAULT 1;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN edition_total INTEGER NOT NULL DEFAULT 1;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN public_url TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN owner TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN seller TEXT;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;`)
	_ = tryExec(`ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR';`)
}

func tryExec(sqlStmt string) error {
	_, err := db.Exec(sqlStmt)
	return err
}

func adminsCount() int {
	var n int
	_ = db.QueryRow(`SELECT COUNT(*) FROM admins`).Scan(&n)
	return n
}

func isAdmin(user string) bool {
	u := strings.ToLower(strings.TrimSpace(user))
	if u == "" {
		return false
	}
	var exists int
	_ = db.QueryRow(`SELECT COUNT(*) FROM admins WHERE email=?`, u).Scan(&exists)
	return exists > 0
}

func loadAdminsFromEnv() {
	raw := strings.TrimSpace(os.Getenv("ADMIN_USERS"))
	if raw == "" {
		return
	}
	for _, a := range strings.Split(raw, ",") {
		a = strings.ToLower(strings.TrimSpace(a))
		if a == "" {
			continue
		}
		if _, err := db.Exec(`INSERT OR IGNORE INTO admins(email) VALUES (?)`, a); err != nil {
			log.Printf("admin insert failed for %s: %v\n", a, err)
		}
	}
}

// ---------- HTTP ----------

func main() {
	mustInitDB()
	defer fsClose()
	initFirestore(context.Background())
	loadAdminsFromEnv()

	mux := http.NewServeMux()

	// health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"ok":         true,
			"time":       time.Now().UTC(),
			"publicBase": publicBase,
			"admins":     adminsCount(),
		})
	})

	// me (roles + my brands)
	mux.HandleFunc("/api/me", withCORS(handleMe))

	// admins bootstrap
	mux.HandleFunc("/api/admins/bootstrap", withCORS(adminBootstrap))

	// manufacturers
	mux.HandleFunc("/api/manufacturers", withCORS(manufacturerCreateOrList)) // POST create, GET list mine
	mux.HandleFunc("/api/manufacturers/", withCORS(manufacturerGetOrVerify)) // GET by slug, POST /verify

	// products
	mux.HandleFunc("/api/manufacturer/products", withCORS(manufacturerCreateProduct)) // POST
	mux.HandleFunc("/api/products", withCORS(productsList))                           // GET
	mux.HandleFunc("/api/products/", withCORS(productActions))                        // POST /{id}/purchase

	// verify public detail
	mux.HandleFunc("/api/verify/", withCORS(verifyProduct)) // GET /api/verify/{id}

	// short redirect to public
	mux.HandleFunc("/p/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/p/")
		http.Redirect(w, r, "/details.html?id="+id, http.StatusFound)
	})

	// static from ./docs
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

// ---------- handlers ----------

// /api/me  (GET)
func handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}
	u := currentUser(r)
	if u == "" {
		writeJSON(w, 401, ErrorResp{"missing user"})
		return
	}
	// my brands
	rows, err := db.Query(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
		FROM manufacturers WHERE owner=? ORDER BY id DESC`, u)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	defer rows.Close()
	var brands []Manufacturer
	for rows.Next() {
		var m Manufacturer
		var verInt int
		if err := rows.Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &verInt, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		m.Verified = verInt == 1
		brands = append(brands, m)
	}
	resp := map[string]any{
		"email":          u,
		"isAdmin":        isAdmin(u),
		"isManufacturer": len(brands) > 0,
		"brands":         brands,
	}
	writeJSON(w, 200, resp)
}

// /api/admins/bootstrap  (POST) — тільки якщо адмінів у БД 0
func adminBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}
	u := strings.ToLower(currentUser(r))
	if u == "" {
		writeJSON(w, 401, ErrorResp{"missing user"})
		return
	}
	var n int
	_ = db.QueryRow(`SELECT COUNT(*) FROM admins`).Scan(&n)
	if n > 0 {
		writeJSON(w, 403, ErrorResp{"already initialized"})
		return
	}
	if _, err := db.Exec(`INSERT INTO admins(email) VALUES (?)`, u); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	// mirror
	fsAdd("events", map[string]any{
		"type": "bootstrap_admin", "byEmail": u, "at": time.Now(),
	})
	writeJSON(w, 200, map[string]any{"ok": true, "admin": u})
}

// /api/manufacturers  (POST create, GET list mine)
type manufCreateReq struct {
	Name string `json:"name"`
}

func manufacturerCreateOrList(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w)
		return
	case http.MethodGet:
		u := currentUser(r)
		if u == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		rows, err := db.Query(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
			FROM manufacturers WHERE owner=? ORDER BY id DESC`, u)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		defer rows.Close()
		var out []Manufacturer
		for rows.Next() {
			var m Manufacturer
			var vi int
			if err := rows.Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt); err != nil {
				writeJSON(w, 500, ErrorResp{err.Error()})
				return
			}
			m.Verified = vi == 1
			out = append(out, m)
		}
		writeJSON(w, 200, out)
		return
	case http.MethodPost:
		u := currentUser(r)
		if u == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		var req manufCreateReq
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
		now := time.Now().UnixMilli()
		res, err := db.Exec(`INSERT INTO manufacturers(name,slug,owner,verified,created_at) VALUES (?,?,?,?,?)`,
			name, slug, u, 0, now)
		if err != nil {
			// if exists — віддамо поточний стан
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				var m Manufacturer
				var vi int
				err2 := db.QueryRow(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
					FROM manufacturers WHERE slug=?`, slug).
					Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt)
				if err2 != nil {
					writeJSON(w, 500, ErrorResp{fmt.Sprintf("conflict but fetch failed: %v", err2)})
					return
				}
				m.Verified = vi == 1
				writeJSON(w, 200, m)
				return
			}
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		id, _ := res.LastInsertId()
		m := Manufacturer{
			ID:        id,
			Name:      name,
			Slug:      slug,
			Owner:     u,
			Verified:  false,
			CreatedAt: now,
		}
		// mirror brand + user link
		fsWrite("brands/"+slug, map[string]any{
			"name": name, "slug": slug, "ownerEmail": u, "verified": false, "createdAt": time.Now(),
		})
		fsAdd("events", map[string]any{
			"type": "create_brand", "byEmail": u, "slug": slug, "at": time.Now(),
		})
		writeJSON(w, 201, m)
		return
	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

// /api/manufacturers/{slug}  (GET)  і  /api/manufacturers/{slug}/verify (POST admin)
func manufacturerGetOrVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/manufacturers/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, 404, ErrorResp{"not found"})
		return
	}
	slug := slugify(parts[0])

	if len(parts) == 1 && r.Method == http.MethodGet {
		var m Manufacturer
		var vi int
		err := db.QueryRow(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
			FROM manufacturers WHERE slug=?`, slug).
			Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt)
		if err == sql.ErrNoRows {
			writeJSON(w, 404, ErrorResp{"manufacturer not found"})
			return
		}
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		m.Verified = vi == 1
		writeJSON(w, 200, m)
		return
	}

	if len(parts) == 2 && parts[1] == "verify" && r.Method == http.MethodPost {
		u := currentUser(r)
		if u == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		if !isAdmin(u) {
			writeJSON(w, 403, ErrorResp{"forbidden"})
			return
		}
		now := time.Now().UnixMilli()
		res, err := db.Exec(`UPDATE manufacturers SET verified=1, verified_by=?, verified_at=? WHERE slug=?`,
			u, now, slug)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		aff, _ := res.RowsAffected()
		if aff == 0 {
			writeJSON(w, 404, ErrorResp{"manufacturer not found"})
			return
		}
		var m Manufacturer
		var vi int
		_ = db.QueryRow(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
			FROM manufacturers WHERE slug=?`, slug).
			Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt)
		m.Verified = vi == 1
		// mirror
		fsWrite("brands/"+slug, map[string]any{
			"verified": true, "verifiedBy": u, "verifiedAt": time.Now(),
		})
		fsAdd("events", map[string]any{
			"type": "verify_brand", "byEmail": u, "slug": slug, "at": time.Now(),
		})
		writeJSON(w, 200, m)
		return
	}

	writeJSON(w, 404, ErrorResp{"not found"})
}

// /api/manufacturer/products  (POST) — створення 1..N штук (editionCount)
type createReq struct {
	Name           string `json:"name"`                     // required
	Brand          string `json:"brand"`                    // slug, required for manufacturer
	ManufacturedAt string `json:"manufacturedAt,omitempty"` // optional for manufacturer; required in user flow (але юзерів ми тут не обробляємо)
	Image          string `json:"image,omitempty"`          // optional
	EditionCount   int    `json:"editionCount,omitempty"`   // default 1
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

	user := currentUser(r)
	if user == "" {
		writeJSON(w, 401, ErrorResp{"missing user"})
		return
	}

	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, 400, ErrorResp{"name is required"})
		return
	}
	brandSlug := slugify(req.Brand)
	if brandSlug == "" {
		writeJSON(w, 400, ErrorResp{"brand is required"})
		return
	}
	// перевірка, що user — власник цього бренду
	var owner string
	err := db.QueryRow(`SELECT owner FROM manufacturers WHERE slug=?`, brandSlug).
		Scan(&owner)
	if err == sql.ErrNoRows {
		writeJSON(w, 404, ErrorResp{"brand not found"})
		return
	}
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	if strings.ToLower(owner) != strings.ToLower(user) && !isAdmin(user) {
		writeJSON(w, 403, ErrorResp{"not your brand"})
		return
	}

	editionTotal := req.EditionCount
	if editionTotal <= 0 {
		editionTotal = 1
	}

	// авто-поля
	now := time.Now().UnixMilli()
	manAt := strings.TrimSpace(req.ManufacturedAt)
	if manAt == "" {
		manAt = time.Now().Format("2006-01-02")
	}

	// batch create
	type createdOut struct {
		Product
	}
	var outs []createdOut

	tx, err := db.Begin()
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	defer func() { _ = tx.Rollback() }()

	for i := 1; i <= editionTotal; i++ {
		serial := genSerial(name, i, editionTotal)
		meta := Metadata{
			Name:           name,
			ManufacturedAt: manAt,
			Serial:         serial,
			Certificates:   []string{},
			Image:          strings.TrimSpace(req.Image),
			Version:        1,
		}
		ipfsHash := sha256Hex(string(mustJSON(meta)))[:46]
		serialHash := sha256Hex(serial)

		certJSON := mustJSONString(meta.Certificates)
		res, err := tx.Exec(`
INSERT INTO products (brand_slug, name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at, owner, seller, edition_no, edition_total)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			brandSlug, meta.Name, meta.ManufacturedAt, meta.Serial, certJSON, meta.Image, ipfsHash, serialHash,
			string(StateCreated), now, user, user, i, editionTotal,
		)
		if err != nil {
			writeJSON(w, 500, ErrorResp{fmt.Sprintf("db insert error: %v", err)})
			return
		}
		id, _ := res.LastInsertId()
		publicURL := ""
		if publicBase != "" {
			publicURL = fmt.Sprintf("%s/details.html?id=%d", publicBase, id)
		}
		_, _ = tx.Exec(`UPDATE products SET public_url=? WHERE id=?`, publicURL, id)
		_, _ = tx.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`,
			id, user, now)

		payload := map[string]any{"t": "prod", "std": "1155", "id": id, "s": serialHash, "iss": "MARKI_SECURE", "v": 1}
		if publicURL != "" {
			payload["url"] = publicURL
		}
		payload["sig"] = mockSign(payload)

		out := createdOut{Product{
			ID:           id,
			BrandSlug:    brandSlug,
			Meta:         meta,
			IPFSHash:     ipfsHash,
			SerialHash:   serialHash,
			State:        StateCreated,
			CreatedAt:    now,
			QRPayload:    payload,
			PublicURL:    publicURL,
			Owner:        user,
			Seller:       user,
			EditionNo:    i,
			EditionTotal: editionTotal,
		}}
		outs = append(outs, out)
	}

	if err := tx.Commit(); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}

	// mirror FS (в тіні)
	for _, o := range outs {
		fsWrite(fmt.Sprintf("products/%d", o.ID), map[string]any{
			"name":           o.Meta.Name,
			"brandSlug":      o.BrandSlug,
			"tokenId":        o.ID,
			"manufacturedAt": o.Meta.ManufacturedAt,
			"ownerEmail":     o.Owner,
			"state":          string(o.State),
			"editionNo":      o.EditionNo,
			"editionTotal":   o.EditionTotal,
			"imageUrl":       o.Meta.Image,
			"createdAt":      time.Now(),
		})
		fsAdd("events", map[string]any{
			"type": "create_product", "byEmail": user, "tokenId": o.ID, "brandSlug": o.BrandSlug, "at": time.Now(),
		})
	}

	// якщо один — повернемо як об'єкт; якщо партія — масив
	if len(outs) == 1 {
		writeJSON(w, 201, outs[0].Product)
		return
	}
	// масив
	type simple struct {
		ID           int64     `json:"id"`
		SerialHash   string    `json:"serialHash"`
		PublicURL    string    `json:"publicUrl"`
		EditionNo    int       `json:"editionNo"`
		EditionTotal int       `json:"editionTotal"`
		Meta         *Metadata `json:"meta,omitempty"`
	}
	arr := make([]simple, 0, len(outs))
	for _, o := range outs {
		m := o.Meta // small copy pointer
		arr = append(arr, simple{
			ID: o.ID, SerialHash: o.SerialHash, PublicURL: o.PublicURL,
			EditionNo: o.EditionNo, EditionTotal: o.EditionTotal,
			Meta: &m,
		})
	}
	writeJSON(w, 201, arr)
}

// /api/products (GET) — мої (owner/seller); ?all=1 тільки адмін
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

	wantAll := r.URL.Query().Get("all") == "1" && isAdmin(user)

	var (
		rows *sql.Rows
		err  error
	)
	baseSelect := `
SELECT id, brand_slug, name, manufactured_at, serial, certificates, image,
  ipfs_hash, serial_hash, state, created_at, owner, seller, public_url,
  edition_no, edition_total
FROM products
`
	if wantAll {
		rows, err = db.Query(baseSelect + ` ORDER BY id DESC`)
	} else {
		rows, err = db.Query(baseSelect+`
WHERE owner = ? OR seller = ?
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
			id                                                                       int64
			brandSlug, name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
			created                                                                  int64
			owner, seller, publicURL                                                 string
			editionNo, editionTotal                                                  int
		)
		if err := rows.Scan(
			&id, &brandSlug, &name, &mfgAt, &serial, &certJSON, &image,
			&ipfs, &serialHash, &state, &created, &owner, &seller, &publicURL,
			&editionNo, &editionTotal,
		); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		var certs []string
		_ = json.Unmarshal([]byte(ifEmpty(certJSON, "[]")), &certs)
		meta := Metadata{Name: name, ManufacturedAt: mfgAt, Serial: serial, Certificates: certs, Image: image, Version: 1}
		list = append(list, Product{
			ID:           id,
			BrandSlug:    brandSlug,
			Meta:         meta,
			IPFSHash:     ipfs,
			SerialHash:   serialHash,
			State:        State(state),
			CreatedAt:    created,
			Owner:        owner,
			Seller:       seller,
			PublicURL:    publicURL,
			EditionNo:    editionNo,
			EditionTotal: editionTotal,
		})
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
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
		_, err = tx.Exec(`UPDATE products SET state=?, owner=? WHERE id=?`, string(StatePurchased), buyer, id)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		_, _ = tx.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`, id, buyer, now)

		if err := tx.Commit(); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		// mirror
		fsWrite(fmt.Sprintf("products/%d", id), map[string]any{
			"ownerEmail": buyer, "state": string(StatePurchased),
		})
		fsAdd("events", map[string]any{
			"type": "purchase", "byEmail": buyer, "tokenId": id, "at": time.Now(),
		})
		writeJSON(w, 200, map[string]any{"ok": true, "state": StatePurchased})
		return
	}

	writeJSON(w, 404, ErrorResp{"not found"})
}

// /api/verify/{id}  (GET) — публічний перегляд
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
		brandSlug, name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
		created                                                                  int64
		owner, seller, publicURL                                                 string
		editionNo, editionTotal                                                  int
	)
	err = db.QueryRow(`SELECT brand_slug,name,manufactured_at,serial,certificates,image,ipfs_hash,serial_hash,state,created_at,owner,seller,public_url,edition_no,edition_total
		FROM products WHERE id=?`, tokenID).
		Scan(&brandSlug, &name, &mfgAt, &serial, &certJSON, &image, &ipfs, &serialHash, &state, &created, &owner, &seller, &publicURL, &editionNo, &editionTotal)
	if err == sql.ErrNoRows {
		writeJSON(w, 404, ErrorResp{"product not found"})
		return
	}
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}

	// brand verified?
	var verifiedInt int
	_ = db.QueryRow(`SELECT verified FROM manufacturers WHERE slug=?`, brandSlug).Scan(&verifiedInt)
	brandVerified := verifiedInt == 1

	var certs []string
	_ = json.Unmarshal([]byte(ifEmpty(certJSON, "[]")), &certs)
	if brandVerified && state != string(StateRevoked) {
		certs = append(certs, "brand_verified")
	}
	if state == string(StateRevoked) {
		certs = append(certs, "revoked")
	}

	meta := Metadata{
		Name:           name,
		ManufacturedAt: mfgAt,
		Serial:         serial, // may hide below
		Certificates:   certs,
		Image:          image,
		Version:        1,
	}

	// повний доступ — тільки власник або продавець (або адмін)
	full := requester != "" && (strings.EqualFold(requester, owner) || strings.EqualFold(requester, seller) || isAdmin(requester))
	scope := "public"
	resp := map[string]any{
		"state":        state,
		"tokenId":      tokenID,
		"brandSlug":    brandSlug,
		"metadata":     meta,
		"publicUrl":    publicURL,
		"editionNo":    editionNo,
		"editionTotal": editionTotal,
		"scope":        scope,
	}
	if full {
		scope = "full"
		resp["scope"] = scope
		resp["ipfsHash"] = ipfs
		resp["serialHash"] = serialHash
		resp["owner"] = owner
		resp["seller"] = seller
	} else {
		// приховати чутливе
		pm := meta
		pm.Serial = ""
		resp["metadata"] = pm
	}
	writeJSON(w, 200, resp)
}
