// main.go
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
ENV для продакшена (Render):

PUBLIC_BASE = https://app.world-of-photo.com
PORT = 5000

# Первичные админы (через запятую)
ADMIN_USERS = you@example.com,cofounder@site.com

# Firestore (опционально)
FIRESTORE_PROJECT_ID = your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS = /path/to/service-account.json
# или:
FIREBASE_SERVICE_ACCOUNT_JSON = { ...JSON... }
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

type APIKey struct {
	ID             int64  `json:"id"`
	Manufacturer   string `json:"manufacturerSlug"`
	Prefix         string `json:"prefix"`
	Masked         string `json:"masked"`
	CreatedBy      string `json:"createdBy"`
	CreatedAt      int64  `json:"createdAt"`
	LastUsedAt     int64  `json:"lastUsedAt,omitempty"`
	Disabled       bool   `json:"disabled"`
	LastUsedIP     string `json:"lastUsedIp,omitempty"`
	HashTruncated  string `json:"hashTruncated,omitempty"`
	PlaintextToken string `json:"apiKey,omitempty"` // только при создании
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
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User, X-Api-Key")
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

func bearerOrAPIKey(r *http.Request) string {
	key := strings.TrimSpace(r.Header.Get("X-Api-Key"))
	if key != "" {
		return key
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return ""
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

// random base32-ish tokens
func randToken(nBytes int) string {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d%s", time.Now().UnixNano(), shortID())
	}
	return base64.RawURLEncoding.EncodeToString(b)
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

-- API keys for integrations
CREATE TABLE IF NOT EXISTS api_keys (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  manufacturer_slug TEXT NOT NULL,
  key_hash          TEXT NOT NULL UNIQUE,
  prefix            TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  last_used_at      INTEGER,
  last_used_ip      TEXT,
  disabled          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_apikeys_mslug ON api_keys(manufacturer_slug);
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
	_ = tryExec(`ALTER TABLE api_keys ADD COLUMN last_used_ip TEXT;`)
}

func tryExec(sqlStmt string) error { _, err := db.Exec(sqlStmt); return err }

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
func upsertAdmin(email string) error {
	e := strings.ToLower(strings.TrimSpace(email))
	if e == "" {
		return nil
	}
	_, err := db.Exec(`INSERT OR IGNORE INTO admins(email) VALUES (?)`, e)
	return err
}
func loadAdminsFromEnv() {
	raw := strings.TrimSpace(os.Getenv("ADMIN_USERS"))
	if raw == "" {
		return
	}
	for _, a := range strings.Split(raw, ",") {
		_ = upsertAdmin(a)
	}
}

func manufacturerOwner(slug string) (owner string, ok bool, verified bool) {
	var vInt int
	err := db.QueryRow(`SELECT owner,verified FROM manufacturers WHERE slug=?`, slug).
		Scan(&owner, &vInt)
	if err != nil {
		return "", false, false
	}
	return owner, true, vInt == 1
}

// ---------- API Key helpers ----------

func createAPIKey(manSlug, createdBy string) (APIKey, error) {
	now := time.Now().UnixMilli()
	prefix := "mk_live_" + manSlug + "_"
	raw := prefix + randToken(24)
	hash := sha256Hex(raw)
	res, err := db.Exec(`INSERT INTO api_keys (manufacturer_slug,key_hash,prefix,created_by,created_at,disabled)
VALUES (?,?,?,?,?,0)`, manSlug, hash, prefix, strings.ToLower(createdBy), now)
	if err != nil {
		return APIKey{}, err
	}
	id, _ := res.LastInsertId()
	return APIKey{
		ID:             id,
		Manufacturer:   manSlug,
		Prefix:         prefix,
		Masked:         prefix + "••••••",
		CreatedBy:      createdBy,
		CreatedAt:      now,
		Disabled:       false,
		HashTruncated:  hash[:12],
		PlaintextToken: raw,
	}, nil
}

func maskKey(prefix string) string { return prefix + "••••••" }

func findAPIKey(token string) (APIKey, bool) {
	if token == "" {
		return APIKey{}, false
	}
	hash := sha256Hex(token)
	var k APIKey
	var disabled int
	err := db.QueryRow(`SELECT id,manufacturer_slug,prefix,created_by,created_at,COALESCE(last_used_at,0),COALESCE(last_used_ip,''),disabled
FROM api_keys WHERE key_hash=?`, hash).
		Scan(&k.ID, &k.Manufacturer, &k.Prefix, &k.CreatedBy, &k.CreatedAt, &k.LastUsedAt, &k.LastUsedIP, &disabled)
	if err != nil {
		return APIKey{}, false
	}
	k.Disabled = disabled == 1
	if k.Disabled {
		return APIKey{}, false
	}
	return k, true
}

func touchAPIKeyUsage(id int64, ip string) {
	_, _ = db.Exec(`UPDATE api_keys SET last_used_at=?, last_used_ip=? WHERE id=?`, time.Now().UnixMilli(), ip, id)
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

	// admins
	mux.HandleFunc("/api/admins", withCORS(adminsList))
	mux.HandleFunc("/api/admins/bootstrap", withCORS(adminBootstrap))
	mux.HandleFunc("/api/admins/grant", withCORS(adminGrant))

	// manufacturers
	mux.HandleFunc("/api/manufacturers", withCORS(manufacturerCreateOrList)) // POST create, GET list mine
	mux.HandleFunc("/api/manufacturers/", withCORS(manufacturerGetVerifyKeys)) // GET by slug, POST /verify, keys ops, integration info

	// products
	mux.HandleFunc("/api/manufacturer/products", withCORS(manufacturerCreateProduct)) // POST
	mux.HandleFunc("/api/products", withCORS(productsList))                           // GET
	mux.HandleFunc("/api/products/", withCORS(productActions))                        // POST /{id}/purchase

	// verify public detail
	mux.HandleFunc("/api/verify/", withCORS(verifyProduct)) // GET /api/verify/{id}

	// Integrations ingest
	mux.HandleFunc("/api/integrations/ingest", withCORS(integrationIngest))

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

// --- admins ---

// GET /api/admins
func adminsList(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w); return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"}); return
	}
	rows, err := db.Query(`SELECT email FROM admins ORDER BY email`)
	if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
	defer rows.Close()
	var out []string
	for rows.Next() {
		var e string; _ = rows.Scan(&e); out = append(out, e)
	}
	writeJSON(w, 200, map[string]any{"admins": out})
}

// POST /api/admins/bootstrap  — только если в БД 0 админов
func adminBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	if r.Method != http.MethodPost { writeJSON(w, 405, ErrorResp{"Method not allowed"}); return }
	u := strings.ToLower(currentUser(r))
	if u == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }
	var n int
	_ = db.QueryRow(`SELECT COUNT(*) FROM admins`).Scan(&n)
	if n > 0 { writeJSON(w, 403, ErrorResp{"already initialized"}); return }
	if _, err := db.Exec(`INSERT INTO admins(email) VALUES (?)`, u); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()}); return
	}
	fsAdd("events", map[string]any{ "type":"bootstrap_admin","byEmail":u,"at":time.Now() })
	writeJSON(w, 200, map[string]any{"ok": true, "admin": u})
}

// POST /api/admins/grant { "email": "..." } — вызвать может только текущий админ
func adminGrant(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	if r.Method != http.MethodPost { writeJSON(w, 405, ErrorResp{"Method not allowed"}); return }
	actor := currentUser(r)
	if !isAdmin(actor) { writeJSON(w, 403, ErrorResp{"forbidden"}); return }
	var body struct{ Email string `json:"email"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"}); return
	}
	if err := upsertAdmin(body.Email); err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()}); return
	}
	fsAdd("events", map[string]any{ "type":"grant_admin","byEmail":actor,"email":strings.ToLower(strings.TrimSpace(body.Email)),"at":time.Now() })
	writeJSON(w, 200, map[string]any{"ok": true})
}

// --- manufacturers ---
// /api/manufacturers  (POST create, GET list mine)
type manufCreateReq struct {
	Name string `json:"name"`
}
func manufacturerCreateOrList(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w); return
	case http.MethodGet:
		u := currentUser(r)
		if u == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }
		rows, err := db.Query(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
			FROM manufacturers WHERE owner=? ORDER BY id DESC`, u)
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		defer rows.Close()
		var out []Manufacturer
		for rows.Next() {
			var m Manufacturer
			var vi int
			if err := rows.Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt); err != nil {
				writeJSON(w, 500, ErrorResp{err.Error()}); return
			}
			m.Verified = vi == 1
			out = append(out, m)
		}
		writeJSON(w, 200, out); return
	case http.MethodPost:
		u := currentUser(r)
		if u == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }
		var req manufCreateReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeJSON(w, 400, ErrorResp{"invalid json"}); return }
		name := strings.TrimSpace(req.Name)
		if name == "" { writeJSON(w, 400, ErrorResp{"name is required"}); return }
		slug := slugify(name)
		now := time.Now().UnixMilli()
		_, err := db.Exec(`INSERT INTO manufacturers(name,slug,owner,verified,created_at) VALUES (?,?,?,?,?)`,
			name, slug, u, 0, now)
		if err != nil {
			// если уже есть — вернуть существующую запись
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				var m Manufacturer; var vi int
				err2 := db.QueryRow(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
					FROM manufacturers WHERE slug=?`, slug).
					Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt)
				if err2 != nil { writeJSON(w, 500, ErrorResp{fmt.Sprintf("conflict but fetch failed: %v", err2)}); return }
				m.Verified = vi == 1; writeJSON(w, 200, m); return
			}
			writeJSON(w, 500, ErrorResp{err.Error()}); return
		}
		fsWrite("brands/"+slug, map[string]any{ "name":name,"slug":slug,"ownerEmail":u,"verified":false,"createdAt":time.Now() })
		fsAdd("events", map[string]any{ "type":"create_brand","byEmail":u,"slug":slug,"at":time.Now() })
		writeJSON(w, 201, Manufacturer{ Name:name, Slug:slug, Owner:u, Verified:false, CreatedAt:now })
		return
	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

// GET /api/manufacturers/{slug}
// POST /api/manufacturers/{slug}/verify
// GET  /api/manufacturers/{slug}/keys
// POST /api/manufacturers/{slug}/keys
// DELETE /api/manufacturers/{slug}/keys/{id}
// GET  /api/manufacturers/{slug}/integration
func manufacturerGetVerifyKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	rest := strings.TrimPrefix(r.URL.Path, "/api/manufacturers/")
	if rest == "" { writeJSON(w, 404, ErrorResp{"not found"}); return }
	parts := strings.Split(rest, "/")
	slug := slugify(parts[0])

	// GET /api/manufacturers/{slug}
	if len(parts) == 1 && r.Method == http.MethodGet {
		var m Manufacturer; var vi int
		err := db.QueryRow(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
			FROM manufacturers WHERE slug=?`, slug).
			Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt)
		if err == sql.ErrNoRows { writeJSON(w, 404, ErrorResp{"manufacturer not found"}); return }
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		m.Verified = vi == 1; writeJSON(w, 200, m); return
	}

	// POST /api/manufacturers/{slug}/verify (admin only)
	if len(parts) == 2 && parts[1] == "verify" && r.Method == http.MethodPost {
		u := currentUser(r)
		if u == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }
		if !isAdmin(u) { writeJSON(w, 403, ErrorResp{"forbidden"}); return }
		now := time.Now().UnixMilli()
		res, err := db.Exec(`UPDATE manufacturers SET verified=1, verified_by=?, verified_at=? WHERE slug=?`, u, now, slug)
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		aff, _ := res.RowsAffected(); if aff == 0 { writeJSON(w, 404, ErrorResp{"manufacturer not found"}); return }
		fsWrite("brands/"+slug, map[string]any{ "verified":true,"verifiedBy":u,"verifiedAt":time.Now() })
		fsAdd("events", map[string]any{ "type":"verify_brand","byEmail":u,"slug":slug,"at":time.Now() })
		var m Manufacturer; var vi int
		_ = db.QueryRow(`SELECT id,name,slug,owner,verified,COALESCE(verified_by,''),COALESCE(verified_at,0),created_at
			FROM manufacturers WHERE slug=?`, slug).
			Scan(&m.ID, &m.Name, &m.Slug, &m.Owner, &vi, &m.VerifiedBy, &m.VerifiedAt, &m.CreatedAt)
		m.Verified = vi == 1; writeJSON(w, 200, m); return
	}

	// KEYS: GET list
	if len(parts) == 2 && parts[1] == "keys" && r.Method == http.MethodGet {
		user := currentUser(r)
		owner, ok, _ := manufacturerOwner(slug)
		if !ok { writeJSON(w, 404, ErrorResp{"manufacturer not found"}); return }
		if !strings.EqualFold(user, owner) && !isAdmin(user) { writeJSON(w, 403, ErrorResp{"forbidden"}); return }

		rows, err := db.Query(`SELECT id,prefix,created_by,created_at,COALESCE(last_used_at,0),COALESCE(last_used_ip,''),disabled,key_hash
FROM api_keys WHERE manufacturer_slug=? ORDER BY id DESC`, slug)
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		defer rows.Close()
		var out []APIKey
		for rows.Next() {
			var k APIKey; var disabled int; var hash string
			if err := rows.Scan(&k.ID, &k.Prefix, &k.CreatedBy, &k.CreatedAt, &k.LastUsedAt, &k.LastUsedIP, &disabled, &hash); err != nil {
				writeJSON(w, 500, ErrorResp{err.Error()}); return
			}
			k.Manufacturer = slug
			k.Disabled = disabled == 1
			k.Masked = maskKey(k.Prefix)
			k.HashTruncated = hash[:12]
			out = append(out, k)
		}
		writeJSON(w, 200, map[string]any{"keys": out}); return
	}

	// KEYS: POST create (returns plaintext once)
	if len(parts) == 2 && parts[1] == "keys" && r.Method == http.MethodPost {
		user := currentUser(r)
		if user == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }
		owner, ok, _ := manufacturerOwner(slug)
		if !ok { writeJSON(w, 404, ErrorResp{"manufacturer not found"}); return }
		if !strings.EqualFold(user, owner) && !isAdmin(user) { writeJSON(w, 403, ErrorResp{"forbidden"}); return }
		key, err := createAPIKey(slug, user)
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		writeJSON(w, 201, key); return
	}

	// KEYS: DELETE /api/manufacturers/{slug}/keys/{id}
	if len(parts) == 3 && parts[1] == "keys" && r.Method == http.MethodDelete {
		user := currentUser(r)
		owner, ok, _ := manufacturerOwner(slug)
		if !ok { writeJSON(w, 404, ErrorResp{"manufacturer not found"}); return }
		if !strings.EqualFold(user, owner) && !isAdmin(user) { writeJSON(w, 403, ErrorResp{"forbidden"}); return }
		id, err := strconv.ParseInt(parts[2], 10, 64)
		if err != nil { writeJSON(w, 400, ErrorResp{"bad id"}); return }
		res, err := db.Exec(`UPDATE api_keys SET disabled=1 WHERE id=? AND manufacturer_slug=?`, id, slug)
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		aff, _ := res.RowsAffected(); if aff == 0 { writeJSON(w, 404, ErrorResp{"not found"}); return }
		writeJSON(w, 200, map[string]any{"ok": true}); return
	}

	// GET /api/manufacturers/{slug}/integration — подсказки и URL
	if len(parts) == 2 && parts[1] == "integration" && r.Method == http.MethodGet {
		ingestURL := publicBase + "/api/integrations/ingest?brand=" + slug
		writeJSON(w, 200, map[string]any{
			"brand":     slug,
			"ingestUrl": ingestURL,
			"auth":      "Use X-Api-Key: <token> or Authorization: Bearer <token>",
			"example": map[string]any{
				"curl": fmt.Sprintf(`curl -X POST %s -H "X-Api-Key: <YOUR_TOKEN>" -H "Content-Type: application/json" -d '{"name":"Coke Zero 330ml","manufacturedAt":"2025-09-01","image":"https://...","editionCount":10}'`, ingestURL),
				"payloadArray": []map[string]any{
					{"name": "Coke Zero 330ml", "manufacturedAt": "2025-09-01", "image": "", "sku": "CZ-330", "certificates": []string{"factory_cert"}},
					{"name": "Coke Zero 330ml", "manufacturedAt": "2025-09-01"},
				},
			},
		})
		return
	}

	writeJSON(w, 404, ErrorResp{"not found"})
}

// /api/manufacturer/products  (POST) — 1..N штук (editionCount) — только владелец бренда или админ
type createReq struct {
	Name           string   `json:"name"`                     // required
	Brand          string   `json:"brand"`                    // slug, required
	ManufacturedAt string   `json:"manufacturedAt,omitempty"` // optional
	Image          string   `json:"image,omitempty"`          // optional
	EditionCount   int      `json:"editionCount,omitempty"`   // default 1
	Certificates   []string `json:"certificates,omitempty"`   // optional
}

func manufacturerCreateProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	if r.Method != http.MethodPost { writeJSON(w, 405, ErrorResp{"Method not allowed"}); return }

	user := currentUser(r)
	if user == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }

	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"}); return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" { writeJSON(w, 400, ErrorResp{"name is required"}); return }
	brandSlug := slugify(req.Brand)
	if brandSlug == "" { writeJSON(w, 400, ErrorResp{"brand is required"}); return }

	owner, ok, _ := manufacturerOwner(brandSlug)
	if !ok { writeJSON(w, 404, ErrorResp{"brand not found"}); return }
	if !strings.EqualFold(owner, user) && !isAdmin(user) {
		writeJSON(w, 403, ErrorResp{"not your brand"}); return
	}

	editionTotal := req.EditionCount
	if editionTotal <= 0 { editionTotal = 1 }

	now := time.Now().UnixMilli()
	manAt := strings.TrimSpace(req.ManufacturedAt)
	if manAt == "" { manAt = time.Now().Format("2006-01-02") }

	var outs []Product

	tx, err := db.Begin()
	if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
	defer func() { _ = tx.Rollback() }()

	for i := 1; i <= editionTotal; i++ {
		serial := genSerial(name, i, editionTotal)
		meta := Metadata{
			Name:           name,
			ManufacturedAt: manAt,
			Serial:         serial,
			Certificates:   append([]string{}, req.Certificates...),
			Image:          strings.TrimSpace(req.Image),
			Version:        1,
		}
		ipfsHash := sha256Hex(string(mustJSON(meta)))[:46]
		serialHash := sha256Hex(serial)

		certJSON := mustJSONString(meta.Certificates)
		res, err := tx.Exec(`
INSERT INTO products (brand_slug, name, manufactured_at, serial, certificates, image, ipfs_hash, serial_hash, state, created_at, owner, seller, edition_no, edition_total, public_url)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			brandSlug, meta.Name, meta.ManufacturedAt, meta.Serial, certJSON, meta.Image, ipfsHash, serialHash,
			string(StateCreated), now, user, user, i, editionTotal,
			publicURLForID(0), // обновим ниже
		)
		if err != nil { writeJSON(w, 500, ErrorResp{fmt.Sprintf("db insert error: %v", err)}); return }
		id, _ := res.LastInsertId()
		publicURL := makePublicURL(id)
		_, _ = tx.Exec(`UPDATE products SET public_url=? WHERE id=?`, publicURL, id)
		_, _ = tx.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`, id, user, now)

		payload := baseQRPayload(id, serialHash, publicURL)

		outs = append(outs, Product{
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
		})
	}

	if err := tx.Commit(); err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }

	for _, o := range outs {
		fsWrite(fmt.Sprintf("products/%d", o.ID), map[string]any{
			"name": o.Meta.Name, "brandSlug": o.BrandSlug, "tokenId": o.ID,
			"manufacturedAt": o.Meta.ManufacturedAt, "ownerEmail": o.Owner,
			"state": string(o.State), "editionNo": o.EditionNo, "editionTotal": o.EditionTotal,
			"imageUrl": o.Meta.Image, "createdAt": time.Now(),
		})
		fsAdd("events", map[string]any{ "type":"create_product","byEmail":user,"tokenId":o.ID,"brandSlug":o.BrandSlug,"at":time.Now() })
	}

	if len(outs) == 1 {
		writeJSON(w, 201, outs[0]); return
	}
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
		m := o.Meta
		arr = append(arr, simple{ ID:o.ID, SerialHash:o.SerialHash, PublicURL:o.PublicURL, EditionNo:o.EditionNo, EditionTotal:o.EditionTotal, Meta:&m })
	}
	writeJSON(w, 201, arr)
}

func makePublicURL(id int64) string {
	if publicBase == "" { return fmt.Sprintf("/details.html?id=%d", id) }
	return fmt.Sprintf("%s/details.html?id=%d", publicBase, id)
}
func publicURLForID(id int64) string { return "" } // placeholder при INSERT
func baseQRPayload(id int64, serialHash, publicURL string) map[string]any {
	pl := map[string]any{ "t":"prod","std":"1155","id":id,"s":serialHash,"iss":"MARKI_SECURE","v":1 }
	if publicURL != "" { pl["url"] = publicURL }
	pl["sig"] = mockSign(pl)
	return pl
}

// /api/products (GET) — мои (owner/seller); ?all=1 только админ
func productsList(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	if r.Method != http.MethodGet { writeJSON(w, 405, ErrorResp{"Method not allowed"}); return }

	user := currentUser(r)
	if user == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }

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
	if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
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
			writeJSON(w, 500, ErrorResp{err.Error()}); return
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
	if err := rows.Err(); err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }

	writeJSON(w, 200, list)
}

// /api/products/{id}/purchase  (POST)
func productActions(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/products/"), "/")
	if len(parts) == 0 || parts[0] == "" { writeJSON(w, 404, ErrorResp{"not found"}); return }
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil { writeJSON(w, 400, ErrorResp{"bad id"}); return }

	if len(parts) == 2 && parts[1] == "purchase" && r.Method == http.MethodPost {
		buyer := currentUser(r)
		if buyer == "" { writeJSON(w, 401, ErrorResp{"missing user"}); return }

		var curOwner, state string
		err := db.QueryRow(`SELECT owner, state FROM products WHERE id=?`, id).Scan(&curOwner, &state)
		if err == sql.ErrNoRows { writeJSON(w, 404, ErrorResp{"product not found"}); return }
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		if buyer == curOwner { writeJSON(w, 409, ErrorResp{"already owned by you"}); return }

		tx, err := db.Begin()
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		defer func() { _ = tx.Rollback() }()
		now := time.Now().UnixMilli()
		_, _ = tx.Exec(`UPDATE ownership_history SET released_at=? WHERE product_id=? AND released_at IS NULL`, now, id)
		_, err = tx.Exec(`UPDATE products SET state=?, owner=? WHERE id=?`, string(StatePurchased), buyer, id)
		if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		_, _ = tx.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?, ?, ?)`, id, buyer, now)
		if err := tx.Commit(); err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }
		fsWrite(fmt.Sprintf("products/%d", id), map[string]any{"ownerEmail": buyer, "state": string(StatePurchased)})
		fsAdd("events", map[string]any{"type":"purchase","byEmail":buyer,"tokenId":id,"at":time.Now()})
		writeJSON(w, 200, map[string]any{"ok": true, "state": StatePurchased})
		return
	}

	writeJSON(w, 404, ErrorResp{"not found"})
}

// /api/verify/{id}  (GET) — публичный просмотр
func verifyProduct(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	if r.Method != http.MethodGet { writeJSON(w, 405, ErrorResp{"Method not allowed"}); return }
	requester := currentUser(r)
	idStr := strings.TrimPrefix(r.URL.Path, "/api/verify/")
	tokenID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil { writeJSON(w, 400, ErrorResp{"bad id"}); return }

	var (
		brandSlug, name, mfgAt, serial, certJSON, image, ipfs, serialHash, state string
		created                                                                  int64
		owner, seller, publicURL                                                 string
		editionNo, editionTotal                                                  int
	)
	err = db.QueryRow(`SELECT brand_slug,name,manufactured_at,serial,certificates,image,ipfs_hash,serial_hash,state,created_at,owner,seller,public_url,edition_no,edition_total
		FROM products WHERE id=?`, tokenID).
		Scan(&brandSlug, &name, &mfgAt, &serial, &certJSON, &image, &ipfs, &serialHash, &state, &created, &owner, &seller, &publicURL, &editionNo, &editionTotal)
	if err == sql.ErrNoRows { writeJSON(w, 404, ErrorResp{"product not found"}); return }
	if err != nil { writeJSON(w, 500, ErrorResp{err.Error()}); return }

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
		Serial:         serial,
		Certificates:   certs,
		Image:          image,
		Version:        1,
	}

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
		pm := meta; pm.Serial = "" // скрыть серийник
		resp["metadata"] = pm
	}
	writeJSON(w, 200, resp)
}

// ---------- Integrations ----------

// Входные данные: либо один объект, либо массив объектов.
// Будем поддерживать мягкую схему, чтобы CRM могло прислать разные поля.
type ingestItem struct {
	Name           string   `json:"name"`
	ManufacturedAt string   `json:"manufacturedAt,omitempty"`
	Image          string   `json:"image,omitempty"`
	SKU            string   `json:"sku,omitempty"`
	Certificates   []string `json:"certificates,omitempty"`
	EditionCount   int      `json:"editionCount,omitempty"`
	Serial         string   `json:"serial,omitempty"`      // если пришлют готовый серийник — используем
	EditionNo      int      `json:"editionNo,omitempty"`   // если прислали Serial — можно указать номер
	EditionTotal   int      `json:"editionTotal,omitempty"`// общее число копий
}

type ingestResult struct {
	Success      bool              `json:"success"`
	Error        string            `json:"error,omitempty"`
	Created      *Product          `json:"created,omitempty"`
	InputIndex   int               `json:"inputIndex,omitempty"`
	Validation   map[string]string `json:"validation,omitempty"`
	Duplicate    bool              `json:"duplicate,omitempty"`
	AlreadyExist bool              `json:"alreadyExist,omitempty"`
}

func integrationIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions { returnOK(w); return }
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"}); return
	}

	apiToken := bearerOrAPIKey(r)
	key, ok := findAPIKey(apiToken)
	if !ok {
		writeJSON(w, 401, ErrorResp{"invalid or missing API key"}); return
	}
	// бренд из query ?brand=SLUG должен совпадать с ключом
	brandSlug := slugify(r.URL.Query().Get("brand"))
	if brandSlug == "" || !strings.EqualFold(brandSlug, key.Manufacturer) {
		writeJSON(w, 403, ErrorResp{"brand mismatch"}); return
	}
	// владелец бренда должен существовать
	owner, exists, _ := manufacturerOwner(brandSlug)
	if !exists {
		writeJSON(w, 404, ErrorResp{"brand not found"}); return
	}

	body, _ := io.ReadAll(r.Body)
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.UseNumber()

	// Пытаемся прочитать как массив
	var arr []ingestItem
	if err := json.Unmarshal(body, &arr); err != nil || len(arr) == 0 {
		// Пытаемся как один объект
		var one ingestItem
		if err2 := json.Unmarshal(body, &one); err2 != nil || strings.TrimSpace(one.Name) == "" {
			writeJSON(w, 400, ErrorResp{"invalid payload"}); return
		}
		arr = []ingestItem{one}
	}

	results := make([]ingestResult, 0, len(arr))
	now := time.Now().UnixMilli()

	for idx, it := range arr {
		res := ingestResult{InputIndex: idx}
		name := strings.TrimSpace(it.Name)
		if name == "" {
			res.Success = false
			res.Validation = map[string]string{"name": "required"}
			results = append(results, res); continue
		}
		editionTotal := it.EditionTotal
		if editionTotal <= 0 {
			if it.EditionCount > 0 { editionTotal = it.EditionCount } else { editionTotal = 1 }
		}
		editionNo := it.EditionNo
		if editionNo <= 0 || editionNo > editionTotal { editionNo = 1 }

		manAt := strings.TrimSpace(it.ManufacturedAt)
		if manAt == "" { manAt = time.Now().Format("2006-01-02") }

		serial := strings.TrimSpace(it.Serial)
		if serial == "" {
			serial = genSerial(name, editionNo, editionTotal)
		}
		serialHash := sha256Hex(serial)
		certJSON := mustJSONString(it.Certificates)
		ipfsHash := sha256Hex(string(mustJSON(Metadata{
			Name: name, ManufacturedAt: manAt, Serial: serial, Certificates: it.Certificates, Image: it.Image, Version: 1,
		})))[:46]

		// INSERT
		result := Product{}
		tx, err := db.Begin()
		if err != nil {
			res.Success = false; res.Error = err.Error(); results = append(results, res); continue
		}
		defer func() { _ = tx.Rollback() }()

		insertRes, err := tx.Exec(`
INSERT INTO products (brand_slug,name,manufactured_at,serial,certificates,image,ipfs_hash,serial_hash,state,created_at,owner,seller,edition_no,edition_total,public_url)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			brandSlug, name, manAt, serial, certJSON, strings.TrimSpace(it.Image), ipfsHash, serialHash,
			string(StateCreated), now, owner, owner, editionNo, editionTotal, publicURLForID(0),
		)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				res.Success = false; res.Duplicate = true; res.Error = "duplicate serial"; results = append(results, res); continue
			}
			res.Success = false; res.Error = err.Error(); results = append(results, res); continue
		}
		id, _ := insertRes.LastInsertId()
		publicURL := makePublicURL(id)
		_, _ = tx.Exec(`UPDATE products SET public_url=? WHERE id=?`, publicURL, id)
		_, _ = tx.Exec(`INSERT INTO ownership_history (product_id, owner, acquired_at) VALUES (?,?,?)`, id, owner, now)
		if err := tx.Commit(); err != nil {
			res.Success = false; res.Error = err.Error(); results = append(results, res); continue
		}

		payload := baseQRPayload(id, serialHash, publicURL)
		result = Product{
			ID: id, BrandSlug: brandSlug,
			Meta: Metadata{
				Name: name, ManufacturedAt: manAt, Serial: serial, Certificates: it.Certificates, Image: it.Image, Version: 1,
			},
			IPFSHash: ipfsHash, SerialHash: serialHash, State: StateCreated, CreatedAt: now,
			QRPayload: payload, PublicURL: publicURL, Owner: owner, Seller: owner,
			EditionNo: editionNo, EditionTotal: editionTotal,
		}

		fsWrite(fmt.Sprintf("products/%d", id), map[string]any{
			"name": name, "brandSlug": brandSlug, "tokenId": id, "manufacturedAt": manAt,
			"ownerEmail": owner, "state": string(StateCreated),
			"editionNo": editionNo, "editionTotal": editionTotal, "imageUrl": it.Image, "createdAt": time.Now(),
		})
		fsAdd("events", map[string]any{ "type":"ingest_create","byApiKey":key.ID,"brandSlug":brandSlug,"tokenId":id,"at":time.Now() })

		res.Success = true; res.Created = &result
		results = append(results, res)
	}

	touchAPIKeyUsage(key.ID, clientIP(r))
	writeJSON(w, 200, map[string]any{
		"ok":      true,
		"brand":   brandSlug,
		"count":   len(results),
		"results": results,
	})
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	return strings.TrimSpace(r.RemoteAddr)
}
