package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	fb "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

// ================== МОДЕЛІ ==================

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
	TokenID      int64    `json:"tokenId"` // числовий id для /api/verify/{id}
	BrandSlug    string   `json:"brandSlug,omitempty"`
	Meta         Metadata `json:"meta"`
	IPFSHash     string   `json:"ipfsHash,omitempty"`
	SerialHash   string   `json:"serialHash,omitempty"`
	State        State    `json:"state"`
	CreatedAt    int64    `json:"createdAt"`
	PublicURL    string   `json:"publicUrl,omitempty"`
	Owner        string   `json:"owner,omitempty"`  // email
	Seller       string   `json:"seller,omitempty"` // email (для консистентності)
	EditionNo    int      `json:"editionNo,omitempty"`
	EditionTotal int      `json:"editionTotal,omitempty"`
}

type Manufacturer struct {
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	Owner      string `json:"owner"` // email
	Verified   bool   `json:"verified"`
	VerifiedBy string `json:"verifiedBy,omitempty"`
	VerifiedAt int64  `json:"verifiedAt,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

type APIKey struct {
	// залишено для сумісності інтерфейсу; у цій версії ключі не реалізовані
}

type ErrorResp struct {
	Error string `json:"error"`
}

// Firestore DTOs
type FSBrand struct {
	Name       string    `firestore:"name"`
	Slug       string    `firestore:"slug"`
	OwnerEmail string    `firestore:"ownerEmail"`
	Verified   bool      `firestore:"verified"`
	VerifiedBy string    `firestore:"verifiedBy,omitempty"`
	VerifiedAt time.Time `firestore:"verifiedAt,omitempty"`
	CreatedAt  time.Time `firestore:"createdAt"`
}

type FSProduct struct {
	TokenID      int64     `firestore:"tokenId"`
	BrandSlug    string    `firestore:"brandSlug,omitempty"`
	Name         string    `firestore:"name"`
	Manufactured string    `firestore:"manufacturedAt"`
	Serial       string    `firestore:"serial"`
	Certificates []string  `firestore:"certificates"`
	Image        string    `firestore:"image"`
	Version      int       `firestore:"version"`
	IPFSHash     string    `firestore:"ipfsHash"`
	SerialHash   string    `firestore:"serialHash"`
	State        string    `firestore:"state"`
	CreatedAt    time.Time `firestore:"createdAt"`
	PublicURL    string    `firestore:"publicUrl"`
	Owner        string    `firestore:"owner"`
	Seller       string    `firestore:"seller"`
	EditionNo    int       `firestore:"editionNo"`
	EditionTotal int       `firestore:"editionTotal"`
}

// ================== ГЛОБАЛЬНІ ==================

var (
	publicBase = strings.TrimRight(os.Getenv("PUBLIC_BASE"), "/")

	fsClient   *firestore.Client
	authClient *auth.Client
	fsEnabled  = false

	// твій адміністратор за замовчуванням
	defaultAdmin = "alankharisov1@gmail.com"
)

// ================== ІНІЦІАЛІЗАЦІЯ ==================

func initFirebase(ctx context.Context) {
	var app *fb.App
	var err error

	// Якщо є inline JSON — використай його
	if sa := strings.TrimSpace(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON")); sa != "" {
		projectID := strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID"))
		app, err = fb.NewApp(ctx, &fb.Config{ProjectID: projectID}, option.WithCredentialsJSON([]byte(sa)))
	} else if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" {
		// або стандартний шлях до ключа
		projectID := strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID"))
		app, err = fb.NewApp(ctx, &fb.Config{ProjectID: projectID})
	} else {
		log.Println("[auth] no credentials — token verification OFF")
	}

	if err != nil {
		log.Printf("[init] firebase app error: %v\n", err)
	} else {
		ac, err := app.Auth(ctx)
		if err != nil {
			log.Printf("[auth] client error: %v (disabled)\n", err)
		} else {
			authClient = ac
			log.Println("[auth] Firebase Auth enabled")
		}
	}

	// Firestore
	var fsc *firestore.Client
	if sa := strings.TrimSpace(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON")); sa != "" {
		projectID := strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID"))
		fsc, err = firestore.NewClient(ctx, projectID, option.WithCredentialsJSON([]byte(sa)))
	} else if pid := strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID")); pid != "" {
		fsc, err = firestore.NewClient(ctx, pid)
	} else if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" {
		// спробуємо без явного ProjectID
		fsc, err = firestore.NewClient(ctx, "")
	} else {
		err = fmt.Errorf("no Firestore credentials/project")
	}

	if err != nil {
		log.Printf("[fs] init error: %v (disabled)\n", err)
	} else {
		fsClient = fsc
		fsEnabled = true
		log.Println("[fs] Firestore enabled")
	}
}

func fsClose() {
	if fsClient != nil {
		_ = fsClient.Close()
	}
}

// ================== УТИЛІТИ ==================

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

func emailFromIDToken(r *http.Request) string {
	ah := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(strings.ToLower(ah), "bearer ") {
		return ""
	}
	tok := strings.TrimSpace(ah[7:])
	if tok == "" || authClient == nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	t, err := authClient.VerifyIDToken(ctx, tok)
	if err != nil {
		return ""
	}
	if e, ok := t.Claims["email"].(string); ok {
		return strings.ToLower(strings.TrimSpace(e))
	}
	return ""
}
func currentUser(r *http.Request) string {
	if e := emailFromIDToken(r); e != "" {
		return e
	}
	// dev fallbacks:
	u := strings.TrimSpace(r.Header.Get("X-User"))
	if u == "" {
		u = strings.TrimSpace(r.URL.Query().Get("user"))
	}
	return strings.ToLower(u)
}

func slugify(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
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
func sha256Hex(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func randToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d%s", time.Now().UnixNano(), shortID())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func makePublicURL(id int64) string {
	if publicBase == "" {
		return fmt.Sprintf("/details.html?id=%d", id)
	}
	return fmt.Sprintf("%s/details.html?id=%d", publicBase, id)
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, _ := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if host == "" {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// ================== Firestore helpers ==================

func fsDoc(path string) *firestore.DocumentRef   { return fsClient.Doc(path) }
func fsCol(path string) *firestore.CollectionRef { return fsClient.Collection(path) }

func ensureDefaultAdmin(ctx context.Context) {
	if !fsEnabled {
		return
	}
	doc := fsDoc("admins/" + strings.ToLower(defaultAdmin))
	_, err := doc.Get(ctx)
	if err == nil {
		return
	}
	if strings.Contains(strings.ToLower(err.Error()), "not found") {
		_, _ = doc.Create(ctx, map[string]any{
			"email":     strings.ToLower(defaultAdmin),
			"createdAt": time.Now(),
		})
	}
}

func isAdmin(email string) bool {
	if email == "" || !fsEnabled {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_, err := fsDoc("admins/" + strings.ToLower(email)).Get(ctx)
	return err == nil
}

func fsCreateBrand(ctx context.Context, name, owner string) (Manufacturer, error) {
	if !fsEnabled {
		return Manufacturer{}, fmt.Errorf("firestore disabled")
	}
	owner = strings.ToLower(owner)
	slug := slugify(name)
	b := FSBrand{
		Name:       name,
		Slug:       slug,
		OwnerEmail: owner,
		Verified:   false,
		CreatedAt:  time.Now(),
	}
	_, err := fsDoc("brands/"+slug).Create(ctx, b)
	if err != nil {
		// якщо вже існує — віддамо існуючий
		if strings.Contains(strings.ToLower(err.Error()), "already exists") {
			return fsGetBrand(ctx, slug)
		}
		return Manufacturer{}, err
	}
	return Manufacturer{
		Name: name, Slug: slug, Owner: owner, Verified: false, CreatedAt: time.Now().UnixMilli(),
	}, nil
}

func fsGetBrand(ctx context.Context, slug string) (Manufacturer, error) {
	dsnap, err := fsDoc("brands/" + slug).Get(ctx)
	if err != nil {
		return Manufacturer{}, err
	}
	var b FSBrand
	if err := dsnap.DataTo(&b); err != nil {
		return Manufacturer{}, err
	}
	var verAt int64
	if !b.VerifiedAt.IsZero() {
		verAt = b.VerifiedAt.UnixMilli()
	}
	return Manufacturer{
		Name: b.Name, Slug: b.Slug, Owner: b.OwnerEmail,
		Verified: b.Verified, VerifiedBy: b.VerifiedBy, VerifiedAt: verAt,
		CreatedAt: dsnap.CreateTime.UnixMilli(),
	}, nil
}

func fsListBrandsByOwner(ctx context.Context, owner string) ([]Manufacturer, error) {
	iter := fsCol("brands").Where("ownerEmail", "==", strings.ToLower(owner)).Documents(ctx)
	defer iter.Stop()
	var out []Manufacturer
	for {
		d, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var b FSBrand
		if err := d.DataTo(&b); err != nil {
			return nil, err
		}
		var verAt int64
		if !b.VerifiedAt.IsZero() {
			verAt = b.VerifiedAt.UnixMilli()
		}
		out = append(out, Manufacturer{
			Name: b.Name, Slug: b.Slug, Owner: b.OwnerEmail,
			Verified: b.Verified, VerifiedBy: b.VerifiedBy, VerifiedAt: verAt,
			CreatedAt: d.CreateTime.UnixMilli(),
		})
	}
	return out, nil
}

func fsVerifyBrand(ctx context.Context, slug, by string) (Manufacturer, error) {
	by = strings.ToLower(by)
	_, err := fsDoc("brands/"+slug).Set(ctx, map[string]any{
		"verified":   true,
		"verifiedBy": by,
		"verifiedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		return Manufacturer{}, err
	}
	return fsGetBrand(ctx, slug)
}

func fsFirstBrandSlugByOwner(ctx context.Context, owner string) (string, bool, error) {
	q := fsCol("brands").Where("ownerEmail", "==", strings.ToLower(owner)).Limit(1)
	iter := q.Documents(ctx)
	defer iter.Stop()
	d, err := iter.Next()
	if err != nil {
		if err == iterator.Done {
			return "", false, nil
		}
		return "", false, err
	}
	var b FSBrand
	if err := d.DataTo(&b); err != nil {
		return "", false, err
	}
	return b.Slug, true, nil
}

// ——— послідовність tokenId
func nextProductID(ctx context.Context) (int64, error) {
	doc := fsDoc("meta/counters")
	var id int64
	err := fsClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(doc)
		if err != nil && strings.Contains(strings.ToLower(err.Error()), "not found") {
			id = 1
			return tx.Set(doc, map[string]any{"productSeq": id})
		}
		if err != nil {
			return err
		}
		cur, _ := snap.DataAt("productSeq")
		switch v := cur.(type) {
		case int64:
			id = v + 1
		case int:
			id = int64(v) + 1
		case float64:
			id = int64(v) + 1
		default:
			id = 1
		}
		return tx.Update(doc, []firestore.Update{{Path: "productSeq", Value: id}})
	})
	return id, err
}

// створення продукту у Firestore за готовими полями
func fsCreateProduct(ctx context.Context, p Product) (Product, error) {
	if p.TokenID == 0 {
		n, err := nextProductID(ctx)
		if err != nil {
			return Product{}, err
		}
		p.TokenID = n
	}
	docID := strconv.FormatInt(p.TokenID, 10)
	fsP := FSProduct{
		TokenID:      p.TokenID,
		BrandSlug:    p.BrandSlug,
		Name:         p.Meta.Name,
		Manufactured: p.Meta.ManufacturedAt,
		Serial:       p.Meta.Serial,
		Certificates: p.Meta.Certificates,
		Image:        p.Meta.Image,
		Version:      p.Meta.Version,
		IPFSHash:     p.IPFSHash,
		SerialHash:   p.SerialHash,
		State:        string(p.State),
		CreatedAt:    time.Now(),
		PublicURL:    p.PublicURL,
		Owner:        strings.ToLower(p.Owner),
		Seller:       strings.ToLower(p.Seller),
		EditionNo:    p.EditionNo,
		EditionTotal: p.EditionTotal,
	}
	_, err := fsDoc("products/"+docID).Create(ctx, fsP)
	if err != nil {
		// якщо вже існує — перезапишемо (в нашому патерні не повинно статись, але ок)
		if strings.Contains(strings.ToLower(err.Error()), "already exists") {
			_, err = fsDoc("products/"+docID).Set(ctx, fsP)
		}
	}
	return p, err
}

func fsGetProduct(ctx context.Context, id int64) (Product, bool, error) {
	doc := fsDoc("products/" + strconv.FormatInt(id, 10))
	s, err := doc.Get(ctx)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return Product{}, false, nil
		}
		return Product{}, false, err
	}
	var fp FSProduct
	if err := s.DataTo(&fp); err != nil {
		return Product{}, false, err
	}
	meta := Metadata{
		Name:           fp.Name,
		ManufacturedAt: fp.Manufactured,
		Serial:         fp.Serial,
		Certificates:   append([]string{}, fp.Certificates...),
		Image:          fp.Image,
		Version:        fp.Version,
	}
	return Product{
		TokenID:      fp.TokenID,
		BrandSlug:    fp.BrandSlug,
		Meta:         meta,
		IPFSHash:     fp.IPFSHash,
		SerialHash:   fp.SerialHash,
		State:        State(fp.State),
		CreatedAt:    s.CreateTime.UnixMilli(),
		PublicURL:    fp.PublicURL,
		Owner:        fp.Owner,
		Seller:       fp.Seller,
		EditionNo:    fp.EditionNo,
		EditionTotal: fp.EditionTotal,
	}, true, nil
}

func fsListProductsByOwner(ctx context.Context, owner string) ([]Product, error) {
	iter := fsCol("products").
		Where("owner", "==", strings.ToLower(owner)).
		Documents(ctx) // ⬅️ без OrderBy, щоб не вимагався індекс
	defer iter.Stop()

	var out []Product
	for {
		d, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var fp FSProduct
		if err := d.DataTo(&fp); err != nil {
			return nil, err
		}
		meta := Metadata{
			Name:           fp.Name,
			ManufacturedAt: fp.Manufactured,
			Serial:         fp.Serial,
			Certificates:   append([]string{}, fp.Certificates...),
			Image:          fp.Image,
			Version:        fp.Version,
		}
		out = append(out, Product{
			TokenID:      fp.TokenID,
			BrandSlug:    fp.BrandSlug,
			Meta:         meta,
			IPFSHash:     fp.IPFSHash,
			SerialHash:   fp.SerialHash,
			State:        State(fp.State),
			CreatedAt:    d.CreateTime.UnixMilli(),
			PublicURL:    fp.PublicURL,
			Owner:        fp.Owner,
			Seller:       fp.Seller,
			EditionNo:    fp.EditionNo,
			EditionTotal: fp.EditionTotal,
		})
	}
	return out, nil
}

func fsTransferProductOwner(ctx context.Context, tokenID int64, newOwner string) error {
	doc := fsDoc("products/" + strconv.FormatInt(tokenID, 10))
	return fsClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		s, err := tx.Get(doc)
		if err != nil {
			return err
		}
		var fp FSProduct
		if err := s.DataTo(&fp); err != nil {
			return err
		}
		if strings.EqualFold(fp.Owner, newOwner) {
			return fmt.Errorf("already owned by you")
		}
		return tx.Update(doc, []firestore.Update{
			{Path: "owner", Value: strings.ToLower(newOwner)},
			{Path: "state", Value: string(StatePurchased)},
		})
	})
}

// ================== HTTP ==================

func main() {
	ctx := context.Background()
	initFirebase(ctx)
	defer fsClose()

	if !fsEnabled {
		log.Fatal("Firestore не ініціалізовано — встанови FIRESTORE_PROJECT_ID і ключ сервіс-аккаунта")
	}

	ensureDefaultAdmin(ctx)

	mux := http.NewServeMux()

	// health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"ok":           true,
			"time":         time.Now().UTC(),
			"publicBase":   publicBase,
			"firestore":    fsEnabled,
			"auth":         authClient != nil,
			"defaultAdmin": defaultAdmin,
		})
	})

	// me
	mux.HandleFunc("/api/me", withCORS(handleMe))

	// admins
	mux.HandleFunc("/api/admins", withCORS(adminsList))
	mux.HandleFunc("/api/admins/bootstrap", withCORS(adminBootstrap))
	mux.HandleFunc("/api/admins/grant", withCORS(adminGrant))
	mux.HandleFunc("/api/admins/create-manufacturer", withCORS(adminCreateManufacturerForUser))

	// manufacturers
	mux.HandleFunc("/api/manufacturers", withCORS(manufacturerCreateOrList)) // POST create mine, GET list mine
	mux.HandleFunc("/api/manufacturers/", withCORS(manufacturerGetOrVerify)) // GET {slug}, POST {slug}/verify

	// user/company products
	mux.HandleFunc("/api/user/products", withCORS(userCreateProduct))            // POST (без бренду)
	mux.HandleFunc("/api/manufacturer/products", withCORS(companyCreateProduct)) // POST (бренд авто з власника)

	// products
	mux.HandleFunc("/api/products", withCORS(productsList))    // GET мої
	mux.HandleFunc("/api/products/", withCORS(productActions)) // POST /{id}/purchase

	// verify
	mux.HandleFunc("/api/verify/", withCORS(verifyProduct))

	// static
	root := "./docs"
	if v := os.Getenv("DOCS_DIR"); v != "" {
		root = v
	}
	// Гарантуємо коректні MIME для статичних файлів (Windows loves text/plain)
	_ = mime.AddExtensionType(".css", "text/css; charset=utf-8")
	_ = mime.AddExtensionType(".js", "application/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".mjs", "application/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".map", "application/json; charset=utf-8")

	mux.Handle("/", http.FileServer(http.Dir(root)))
	log.Println("Serving static from", root)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}
	addr := ":" + port
	log.Println("MARKI Secure (Firestore-only) running at", addr, "PUBLIC_BASE=", publicBase)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// ====== handlers ======

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

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	brands, err := fsListBrandsByOwner(ctx, u)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}

	writeJSON(w, 200, map[string]any{
		"email":          u,
		"isAdmin":        isAdmin(u),
		"isManufacturer": len(brands) > 0,
		"brands":         brands,
	})
}

// GET /api/admins
func adminsList(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}
	if !fsEnabled {
		writeJSON(w, 500, ErrorResp{"firestore disabled"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	iter := fsCol("admins").Documents(ctx)
	defer iter.Stop()

	var out []string
	for {
		d, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		if e, ok := d.Data()["email"].(string); ok && e != "" {
			out = append(out, e)
		}
	}
	writeJSON(w, 200, map[string]any{"admins": out})
}

// POST /api/admins/bootstrap — перший адмін (якщо колекція порожня)
func adminBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	u := currentUser(r)
	if u == "" {
		writeJSON(w, 401, ErrorResp{"missing user"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	// перевіримо чи є хоч один адмін
	it := fsCol("admins").Limit(1).Documents(ctx)
	_, err := it.Next()
	if err == nil {
		writeJSON(w, 403, ErrorResp{"already initialized"})
		return
	}
	if err != iterator.Done && err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	// створимо
	_, err = fsDoc("admins/"+strings.ToLower(u)).Create(ctx, map[string]any{
		"email":     strings.ToLower(u),
		"createdAt": time.Now(),
	})
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "admin": strings.ToLower(u)})
}

// POST /api/admins/grant { "email": "..." }
func adminGrant(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	actor := currentUser(r)
	if !isAdmin(actor) {
		writeJSON(w, 403, ErrorResp{"forbidden"})
		return
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" {
		writeJSON(w, 400, ErrorResp{"email required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	_, err := fsDoc("admins/"+email).Set(ctx, map[string]any{
		"email":     email,
		"updatedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// POST /api/admins/create-manufacturer { name, email } — СТВОРЮЄ БРЕНД НА EMAIL
func adminCreateManufacturerForUser(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	actor := currentUser(r)
	if !isAdmin(actor) {
		writeJSON(w, 403, ErrorResp{"forbidden"})
		return
	}

	var body struct{ Name, Email string }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	name := strings.TrimSpace(body.Name)
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if name == "" || email == "" {
		writeJSON(w, 400, ErrorResp{"name and email required"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	m, err := fsCreateBrand(ctx, name, email)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 201, m)
}

// /api/manufacturers (GET my list; POST create mine)
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
		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		defer cancel()
		list, err := fsListBrandsByOwner(ctx, u)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, list)
		return
	case http.MethodPost:
		// користувач сам собі може створити бренд (за потреби)
		u := currentUser(r)
		if u == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, ErrorResp{"invalid json"})
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			writeJSON(w, 400, ErrorResp{"name is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		defer cancel()
		m, err := fsCreateBrand(ctx, name, u)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 201, m)
		return
	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

// GET /api/manufacturers/{slug}  |  POST /api/manufacturers/{slug}/verify (admin)
func manufacturerGetOrVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/manufacturers/")
	if rest == "" {
		writeJSON(w, 404, ErrorResp{"not found"})
		return
	}
	parts := strings.Split(rest, "/")
	slug := slugify(parts[0])

	switch {
	case len(parts) == 1 && r.Method == http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		m, err := fsGetBrand(ctx, slug)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				writeJSON(w, 404, ErrorResp{"manufacturer not found"})
				return
			}
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, m)
		return

	case len(parts) == 2 && parts[1] == "verify" && r.Method == http.MethodPost:
		u := currentUser(r)
		if !isAdmin(u) {
			writeJSON(w, 403, ErrorResp{"forbidden"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		m, err := fsVerifyBrand(ctx, slug, u)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, m)
		return

	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

// ==== USER create products (no brand) ====
type userCreateReq struct {
	Name           string   `json:"name"`
	ManufacturedAt string   `json:"manufacturedAt,omitempty"`
	Image          string   `json:"image,omitempty"`
	EditionCount   int      `json:"editionCount,omitempty"`
	Certificates   []string `json:"certificates,omitempty"`
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

	var req userCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, 400, ErrorResp{"name required"})
		return
	}

	manAt := strings.TrimSpace(req.ManufacturedAt)
	if manAt == "" {
		manAt = time.Now().Format("2006-01-02")
	}
	total := req.EditionCount
	if total <= 0 {
		total = 1
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var created []Product
	for i := 1; i <= total; i++ {
		serial := genSerial(name, i, total)
		meta := Metadata{
			Name:           name,
			ManufacturedAt: manAt,
			Serial:         serial,
			Certificates:   append([]string{}, req.Certificates...),
			Image:          strings.TrimSpace(req.Image),
			Version:        1,
		}
		ipfs := sha256Hex(string(mustJSON(meta)))[:46]
		serH := sha256Hex(serial)

		p := Product{
			TokenID:      0,  // згенеруємо
			BrandSlug:    "", // юзерський продукт без бренду
			Meta:         meta,
			IPFSHash:     ipfs,
			SerialHash:   serH,
			State:        StateCreated,
			CreatedAt:    time.Now().UnixMilli(),
			PublicURL:    "", // поставимо після id
			Owner:        user,
			Seller:       user,
			EditionNo:    i,
			EditionTotal: total,
		}
		// присвоїмо id, public URL і створимо в FS
		id, err := nextProductID(ctx)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		p.TokenID = id
		p.PublicURL = makePublicURL(id)
		if _, err := fsCreateProduct(ctx, p); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		created = append(created, p)
	}

	if len(created) == 1 {
		writeJSON(w, 201, created[0])
		return
	}
	writeJSON(w, 201, created)
}

// ==== COMPANY create products (brand auto by owner) ====
type companyCreateReq struct {
	Name           string   `json:"name"`
	ManufacturedAt string   `json:"manufacturedAt,omitempty"`
	Image          string   `json:"image,omitempty"`
	EditionCount   int      `json:"editionCount,omitempty"`
	Certificates   []string `json:"certificates,omitempty"`
}

func companyCreateProduct(w http.ResponseWriter, r *http.Request) {
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

	var req companyCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, 400, ErrorResp{"name required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	brandSlug, ok, err := fsFirstBrandSlugByOwner(ctx, user)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	if !ok {
		writeJSON(w, 403, ErrorResp{"no brand for this account"})
		return
	}

	manAt := strings.TrimSpace(req.ManufacturedAt)
	if manAt == "" {
		manAt = time.Now().Format("2006-01-02")
	}
	total := req.EditionCount
	if total <= 0 {
		total = 1
	}

	var created []Product
	for i := 1; i <= total; i++ {
		serial := genSerial(name, i, total)
		meta := Metadata{
			Name:           name,
			ManufacturedAt: manAt,
			Serial:         serial,
			Certificates:   append([]string{}, req.Certificates...),
			Image:          strings.TrimSpace(req.Image),
			Version:        1,
		}
		ipfs := sha256Hex(string(mustJSON(meta)))[:46]
		serH := sha256Hex(serial)

		p := Product{
			TokenID:      0,
			BrandSlug:    brandSlug,
			Meta:         meta,
			IPFSHash:     ipfs,
			SerialHash:   serH,
			State:        StateCreated,
			CreatedAt:    time.Now().UnixMilli(),
			PublicURL:    "",
			Owner:        user,
			Seller:       user,
			EditionNo:    i,
			EditionTotal: total,
		}
		id, err := nextProductID(ctx)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		p.TokenID = id
		p.PublicURL = makePublicURL(id)
		if _, err := fsCreateProduct(ctx, p); err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		created = append(created, p)
	}
	if len(created) == 1 {
		writeJSON(w, 201, created[0])
		return
	}
	writeJSON(w, 201, created)
}

// GET /api/products — лише мої (owner=я)
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

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	list, err := fsListProductsByOwner(ctx, user)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, list)
}

// POST /api/products/{id}/purchase — простий трансфер власника на поточного користувача
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

		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		// перевіримо чи існує і не мій
		p, ok, err := fsGetProduct(ctx, id)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		if !ok {
			writeJSON(w, 404, ErrorResp{"product not found"})
			return
		}
		if strings.EqualFold(p.Owner, buyer) {
			writeJSON(w, 409, ErrorResp{"already owned by you"})
			return
		}
		if err := fsTransferProductOwner(ctx, id, buyer); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "already owned") {
				writeJSON(w, 409, ErrorResp{"already owned by you"})
				return
			}
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "state": StatePurchased})
		return
	}

	writeJSON(w, 405, ErrorResp{"Method not allowed"})
}

// GET /api/verify/{id}
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
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeJSON(w, 400, ErrorResp{"bad id"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	p, ok, err := fsGetProduct(ctx, id)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	if !ok {
		writeJSON(w, 404, ErrorResp{"product not found"})
		return
	}

	requester := currentUser(r)
	canAcquire := requester != "" && !strings.EqualFold(requester, p.Owner)

	// приховаємо серійник якщо запитувач не власник/адмін
	meta := p.Meta
	if requester == "" || (!strings.EqualFold(requester, p.Owner) && !isAdmin(requester)) {
		meta.Serial = ""
	}
	scope := "public"
	if requester != "" && (strings.EqualFold(requester, p.Owner) || isAdmin(requester)) {
		scope = "full"
	}

	writeJSON(w, 200, map[string]any{
		"state":        p.State,
		"tokenId":      p.TokenID,
		"brandSlug":    p.BrandSlug,
		"metadata":     meta,
		"publicUrl":    p.PublicURL,
		"editionNo":    p.EditionNo,
		"editionTotal": p.EditionTotal,
		"scope":        scope,
		"canAcquire":   canAcquire,
	})
}
