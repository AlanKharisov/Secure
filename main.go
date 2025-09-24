// main.go — MARKI Secure backend (Firestore + Firebase Auth verify)
// Covers: /api/me (with companyApplicationStatus), applications create/moderate,
// brand create/verify, manufacturer batches, products (user/company) with SKU/batch,
// product listing & purchase, verify endpoint, admins, CORS & security headers.

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

// ================== DOMAIN MODELS ==================

type State string

const (
	StateCreated   State = "created"
	StatePurchased State = "purchased"
	StateClaimed   State = "claimed"
	StateRevoked   State = "revoked"
)

type AppStatus string

const (
	AppPending  AppStatus = "pending"
	AppApproved AppStatus = "approved"
	AppRejected AppStatus = "rejected"
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
	TokenID      int64    `json:"tokenId"`
	BrandSlug    string   `json:"brandSlug,omitempty"`
	Meta         Metadata `json:"meta"`
	SKU          string   `json:"sku,omitempty"`
	BatchID      string   `json:"batchId,omitempty"`
	IPFSHash     string   `json:"ipfsHash,omitempty"`
	SerialHash   string   `json:"serialHash,omitempty"`
	State        State    `json:"state"`
	CreatedAt    int64    `json:"createdAt"`
	PublicURL    string   `json:"publicUrl,omitempty"`
	Owner        string   `json:"owner,omitempty"`
	Seller       string   `json:"seller,omitempty"`
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

type CompanyApplication struct {
	ID             string    `json:"id"`
	User           string    `json:"user"`
	FullName       string    `json:"fullName"`
	ContactEmail   string    `json:"contactEmail"`
	LegalName      string    `json:"legalName"`
	BrandName      string    `json:"brandName"`
	Country        string    `json:"country"`
	VAT            string    `json:"vat"`
	RegNumber      string    `json:"regNumber"`
	Site           string    `json:"site"`
	Phone          string    `json:"phone"`
	Address        string    `json:"address"`
	ProofURL       string    `json:"proofUrl"`
	ProofPath      string    `json:"proofPath"`
	Status         AppStatus `json:"status"`
	RejectedReason string    `json:"rejectedReason,omitempty"`
	CreatedAt      int64     `json:"createdAt"`
	ReviewedBy     string    `json:"reviewedBy,omitempty"`
	ReviewedAt     int64     `json:"reviewedAt,omitempty"`
}

type Batch struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Owner     string `json:"owner"`
	CreatedAt int64  `json:"createdAt"`
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
	SKU          string    `firestore:"sku"`
	BatchID      string    `firestore:"batchId"`
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

type FSCompanyApplication struct {
	ID             string    `firestore:"id"`
	User           string    `firestore:"user"`
	FullName       string    `firestore:"fullName"`
	ContactEmail   string    `firestore:"contactEmail"`
	LegalName      string    `firestore:"legalName"`
	BrandName      string    `firestore:"brandName"`
	Country        string    `firestore:"country"`
	VAT            string    `firestore:"vat"`
	RegNumber      string    `firestore:"regNumber"`
	Site           string    `firestore:"site"`
	Phone          string    `firestore:"phone"`
	Address        string    `firestore:"address"`
	ProofURL       string    `firestore:"proofUrl"`
	ProofPath      string    `firestore:"proofPath"`
	Status         string    `firestore:"status"`
	RejectedReason string    `firestore:"rejectedReason,omitempty"`
	CreatedAt      time.Time `firestore:"createdAt"`
	ReviewedBy     string    `firestore:"reviewedBy,omitempty"`
	ReviewedAt     time.Time `firestore:"reviewedAt,omitempty"`
}

type FSBatch struct {
	ID        string    `firestore:"id"`
	Title     string    `firestore:"title"`
	Owner     string    `firestore:"owner"`
	CreatedAt time.Time `firestore:"createdAt"`
}

// ================== GLOBALS ==================

var (
	publicBase = strings.TrimRight(os.Getenv("PUBLIC_BASE"), "/")

	fsClient   *firestore.Client
	authClient *auth.Client
	fsEnabled  = false

	defaultAdmin = "alankharisov1@gmail.com"

	// Дозволити дев-фолбек X-User (тільки якщо явно ALLOW_XUSER_DEV=true)
	allowXUser = strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_XUSER_DEV")), "true")

	// Білий список CORS-оріджинів: ALLOWED_ORIGINS="https://a.com,https://b.com"
	allowedOrigins = func() map[string]struct{} {
		raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
		m := map[string]struct{}{}
		if raw == "" {
			return m // порожній = дозвіл "*" (див. withCORS)
		}
		for _, o := range strings.Split(raw, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				m[o] = struct{}{}
			}
		}
		return m
	}()
)

// ================== INIT FIREBASE ==================

func initFirebase(ctx context.Context) {
	var app *fb.App
	var err error

	if sa := strings.TrimSpace(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON")); sa != "" {
		projectID := strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID"))
		app, err = fb.NewApp(ctx, &fb.Config{ProjectID: projectID}, option.WithCredentialsJSON([]byte(sa)))
	} else if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" {
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

	var fsc *firestore.Client
	if sa := strings.TrimSpace(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON")); sa != "" {
		projectID := strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID"))
		fsc, err = firestore.NewClient(ctx, projectID, option.WithCredentialsJSON([]byte(sa)))
	} else if pid := strings.TrimSpace(os.Getenv("FIRESTORE_PROJECT_ID")); pid != "" {
		fsc, err = firestore.NewClient(ctx, pid)
	} else if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" {
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

// ================== UTILS ==================

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func returnOK(w http.ResponseWriter) { w.WriteHeader(http.StatusOK) }

// CORS з підтримкою ALLOWED_ORIGINS, інакше "*"
func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if len(allowedOrigins) == 0 {
			// за замовчуванням — відкрито
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			if _, ok := allowedOrigins[origin]; ok && origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User, X-Api-Key")
		if r.Method == http.MethodOptions {
			returnOK(w)
			return
		}
		h.ServeHTTP(w, r)
	}
}

func withSecurityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Дозволяє Firebase popup закриватися
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
		// COEP off, щоб не ламати gstatic/google
		w.Header().Set("Cross-Origin-Embedder-Policy", "unsafe-none")
		h.ServeHTTP(w, r)
	})
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

// дев-фолбек X-User допускається лише якщо ALLOW_XUSER_DEV=true
func currentUser(r *http.Request) string {
	if e := emailFromIDToken(r); e != "" {
		return e
	}
	if !allowXUser {
		return ""
	}
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
func randToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d%s", time.Now().UnixNano(), shortID())
	}
	return base64.RawURLEncoding.EncodeToString(b)
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

// ================== FIRESTORE HELPERS ==================

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

// --- Brands ---
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

// --- Product ID sequence ---
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

// --- Products ---
func fsCreateProduct(ctx context.Context, p Product) (Product, error) {
	if p.TokenID == 0 {
		n, err := nextProductID(ctx)
		if err != nil {
			return Product{}, err
		}
		p.TokenID = n
	}
	docID := strconv.FormatInt(p.TokenID, 10)
	fp := FSProduct{
		TokenID:      p.TokenID,
		BrandSlug:    p.BrandSlug,
		Name:         p.Meta.Name,
		Manufactured: p.Meta.ManufacturedAt,
		Serial:       p.Meta.Serial,
		Certificates: p.Meta.Certificates,
		Image:        p.Meta.Image,
		Version:      p.Meta.Version,
		SKU:          p.SKU,
		BatchID:      p.BatchID,
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
	_, err := fsDoc("products/"+docID).Create(ctx, fp)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "already exists") {
			_, err = fsDoc("products/"+docID).Set(ctx, fp)
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
		SKU:          fp.SKU,
		BatchID:      fp.BatchID,
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
func fsListProductsByOwner(ctx context.Context, owner string, sku string) ([]Product, error) {
	q := fsCol("products").Where("owner", "==", strings.ToLower(owner))
	if strings.TrimSpace(sku) != "" {
		q = q.Where("sku", "==", strings.ToUpper(strings.TrimSpace(sku)))
	}
	iter := q.Documents(ctx)
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
			SKU:          fp.SKU,
			BatchID:      fp.BatchID,
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

// --- Applications ---
func fsCreateCompanyApplication(ctx context.Context, app CompanyApplication) (CompanyApplication, error) {
	if !fsEnabled {
		return CompanyApplication{}, fmt.Errorf("firestore disabled")
	}
	if app.ID == "" {
		app.ID = strings.ToLower(shortID() + "_" + randToken(4))
	}
	fsa := FSCompanyApplication{
		ID:           app.ID,
		User:         strings.ToLower(app.User),
		FullName:     app.FullName,
		ContactEmail: strings.ToLower(app.ContactEmail),
		LegalName:    app.LegalName,
		BrandName:    app.BrandName,
		Country:      app.Country,
		VAT:          app.VAT,
		RegNumber:    app.RegNumber,
		Site:         app.Site,
		Phone:        app.Phone,
		Address:      app.Address,
		ProofURL:     app.ProofURL,
		ProofPath:    app.ProofPath,
		Status:       string(AppPending),
		CreatedAt:    time.Now(),
	}
	_, err := fsDoc("companyApplications/"+fsa.ID).Create(ctx, fsa)
	if err != nil {
		return CompanyApplication{}, err
	}
	app.Status = AppPending
	app.CreatedAt = fsa.CreatedAt.UnixMilli()
	return app, nil
}
func fsGetApplication(ctx context.Context, id string) (CompanyApplication, bool, error) {
	d, err := fsDoc("companyApplications/" + id).Get(ctx)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return CompanyApplication{}, false, nil
		}
		return CompanyApplication{}, false, err
	}
	var x FSCompanyApplication
	if err := d.DataTo(&x); err != nil {
		return CompanyApplication{}, false, err
	}
	var reviewedAt, createdAt int64
	if !x.ReviewedAt.IsZero() {
		reviewedAt = x.ReviewedAt.UnixMilli()
	}
	if !x.CreatedAt.IsZero() {
		createdAt = x.CreatedAt.UnixMilli()
	}
	return CompanyApplication{
		ID:             x.ID,
		User:           x.User,
		FullName:       x.FullName,
		ContactEmail:   x.ContactEmail,
		LegalName:      x.LegalName,
		BrandName:      x.BrandName,
		Country:        x.Country,
		VAT:            x.VAT,
		RegNumber:      x.RegNumber,
		Site:           x.Site,
		Phone:          x.Phone,
		Address:        x.Address,
		ProofURL:       x.ProofURL,
		ProofPath:      x.ProofPath,
		Status:         AppStatus(x.Status),
		RejectedReason: x.RejectedReason,
		CreatedAt:      createdAt,
		ReviewedBy:     x.ReviewedBy,
		ReviewedAt:     reviewedAt,
	}, true, nil
}
func fsLatestApplicationForUser(ctx context.Context, user string) (CompanyApplication, bool, error) {
	q := fsCol("companyApplications").
		Where("user", "==", strings.ToLower(user)).
		OrderBy("createdAt", firestore.Desc).
		Limit(1)
	it := q.Documents(ctx)
	defer it.Stop()
	d, err := it.Next()
	if err == iterator.Done {
		return CompanyApplication{}, false, nil
	}
	if err != nil {
		return CompanyApplication{}, false, err
	}
	var x FSCompanyApplication
	if err := d.DataTo(&x); err != nil {
		return CompanyApplication{}, false, err
	}
	var reviewedAt, createdAt int64
	if !x.ReviewedAt.IsZero() {
		reviewedAt = x.ReviewedAt.UnixMilli()
	}
	if !x.CreatedAt.IsZero() {
		createdAt = x.CreatedAt.UnixMilli()
	}
	return CompanyApplication{
		ID:             x.ID,
		User:           x.User,
		FullName:       x.FullName,
		ContactEmail:   x.ContactEmail,
		LegalName:      x.LegalName,
		BrandName:      x.BrandName,
		Country:        x.Country,
		VAT:            x.VAT,
		RegNumber:      x.RegNumber,
		Site:           x.Site,
		Phone:          x.Phone,
		Address:        x.Address,
		ProofURL:       x.ProofURL,
		ProofPath:      x.ProofPath,
		Status:         AppStatus(x.Status),
		RejectedReason: x.RejectedReason,
		CreatedAt:      createdAt,
		ReviewedBy:     x.ReviewedBy,
		ReviewedAt:     reviewedAt,
	}, true, nil
}
func fsListApplicationsByStatus(ctx context.Context, status AppStatus) ([]CompanyApplication, error) {
	q := fsCol("companyApplications").Where("status", "==", string(status)).OrderBy("createdAt", firestore.Desc)
	it := q.Documents(ctx)
	defer it.Stop()
	var out []CompanyApplication
	for {
		d, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var x FSCompanyApplication
		if err := d.DataTo(&x); err != nil {
			return nil, err
		}
		var reviewedAt, createdAt int64
		if !x.ReviewedAt.IsZero() {
			reviewedAt = x.ReviewedAt.UnixMilli()
		}
		if !x.CreatedAt.IsZero() {
			createdAt = x.CreatedAt.UnixMilli()
		}
		out = append(out, CompanyApplication{
			ID:             x.ID,
			User:           x.User,
			FullName:       x.FullName,
			ContactEmail:   x.ContactEmail,
			LegalName:      x.LegalName,
			BrandName:      x.BrandName,
			Country:        x.Country,
			VAT:            x.VAT,
			RegNumber:      x.RegNumber,
			Site:           x.Site,
			Phone:          x.Phone,
			Address:        x.Address,
			ProofURL:       x.ProofURL,
			ProofPath:      x.ProofPath,
			Status:         AppStatus(x.Status),
			RejectedReason: x.RejectedReason,
			CreatedAt:      createdAt,
			ReviewedBy:     x.ReviewedBy,
			ReviewedAt:     reviewedAt,
		})
	}
	return out, nil
}

func fsApproveApplication(ctx context.Context, id, reviewedBy string) (CompanyApplication, error) {
	ref := fsDoc("companyApplications/" + id)
	err := fsClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		s, err := tx.Get(ref)
		if err != nil {
			return err
		}
		var x FSCompanyApplication
		if err := s.DataTo(&x); err != nil {
			return err
		}
		if strings.EqualFold(x.Status, string(AppApproved)) {
			return fmt.Errorf("already approved")
		}
		return tx.Update(ref, []firestore.Update{
			{Path: "status", Value: string(AppApproved)},
			{Path: "reviewedBy", Value: strings.ToLower(reviewedBy)},
			{Path: "reviewedAt", Value: time.Now()},
		})
	})
	if err != nil {
		return CompanyApplication{}, err
	}
	// повертаємо свіжий знімок
	app, _, err := fsGetApplication(ctx, id)
	if err != nil {
		return CompanyApplication{}, err
	}
	return app, nil
}

func fsRejectApplication(ctx context.Context, id, reviewedBy, reason string) (CompanyApplication, error) {
	ref := fsDoc("companyApplications/" + id)
	err := fsClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		s, err := tx.Get(ref)
		if err != nil {
			return err
		}
		var x FSCompanyApplication
		if err := s.DataTo(&x); err != nil {
			return err
		}
		if strings.EqualFold(x.Status, string(AppRejected)) {
			return fmt.Errorf("already rejected")
		}
		return tx.Update(ref, []firestore.Update{
			{Path: "status", Value: string(AppRejected)},
			{Path: "rejectedReason", Value: reason},
			{Path: "reviewedBy", Value: strings.ToLower(reviewedBy)},
			{Path: "reviewedAt", Value: time.Now()},
		})
	})
	if err != nil {
		return CompanyApplication{}, err
	}
	app, _, err := fsGetApplication(ctx, id)
	if err != nil {
		return CompanyApplication{}, err
	}
	return app, nil
}

// --- Batches ---
func fsCreateBatch(ctx context.Context, title, owner string) (Batch, error) {
	if !fsEnabled {
		return Batch{}, fmt.Errorf("firestore disabled")
	}
	b := FSBatch{
		ID:        strings.ToLower(shortID() + "_" + randToken(3)),
		Title:     strings.TrimSpace(title),
		Owner:     strings.ToLower(owner),
		CreatedAt: time.Now(),
	}
	_, err := fsDoc("batches/"+b.ID).Create(ctx, b)
	if err != nil {
		return Batch{}, err
	}
	return Batch{ID: b.ID, Title: b.Title, Owner: b.Owner, CreatedAt: b.CreatedAt.UnixMilli()}, nil
}
func fsListBatchesByOwner(ctx context.Context, owner string) ([]Batch, error) {
	q := fsCol("batches").Where("owner", "==", strings.ToLower(owner)).OrderBy("createdAt", firestore.Desc)
	it := q.Documents(ctx)
	defer it.Stop()
	var out []Batch
	for {
		d, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var x FSBatch
		if err := d.DataTo(&x); err != nil {
			return nil, err
		}
		out = append(out, Batch{
			ID: x.ID, Title: x.Title, Owner: x.Owner, CreatedAt: x.CreatedAt.UnixMilli(),
		})
	}
	return out, nil
}

// ================== HTTP HANDLERS ==================

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
			"allowXUser":   allowXUser,
		})
	})

	// ===== API (with CORS) =====
	mux.HandleFunc("/api/me", withCORS(handleMe))

	// admins
	mux.HandleFunc("/api/admins", withCORS(adminsList))
	mux.HandleFunc("/api/admins/bootstrap", withCORS(adminBootstrap))
	mux.HandleFunc("/api/admins/grant", withCORS(adminGrant))
	mux.HandleFunc("/api/admins/create-manufacturer", withCORS(adminCreateManufacturerForUser))

	// applications moderation
	mux.HandleFunc("/api/admins/company-applications", withCORS(adminListApplications))
	mux.HandleFunc("/api/admins/company-applications/", withCORS(adminModerateApplication)) // /{id}/approve|reject

	// company application create
	mux.HandleFunc("/api/company/apply", withCORS(companyApply))

	// manufacturers (list/create mine, get/verify)
	mux.HandleFunc("/api/manufacturers", withCORS(manufacturerCreateOrList))
	mux.HandleFunc("/api/manufacturers/", withCORS(manufacturerGetOrVerify))

	// batches
	mux.HandleFunc("/api/manufacturer/batches", withCORS(manufacturerBatches))

	// products (user/company create + my list + actions)
	mux.HandleFunc("/api/user/products", withCORS(userCreateProduct))
	mux.HandleFunc("/api/manufacturer/products", withCORS(companyProducts)) // GET (my by SKU), POST (create)
	mux.HandleFunc("/api/products", withCORS(productsList))                 // GET my list (optional sku)
	mux.HandleFunc("/api/products/", withCORS(productActions))              // /{id}/purchase

	// verification
	mux.HandleFunc("/api/verify/", withCORS(verifyProduct))

	// ===== Static =====
	root := os.Getenv("DOCS_DIR")
	if root == "" {
		root = "./docs"
	}
	_ = mime.AddExtensionType(".css", "text/css; charset=utf-8")
	_ = mime.AddExtensionType(".js", "application/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".mjs", "application/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".map", "application/json; charset=utf-8")

	mux.Handle("/", withSecurityHeaders(http.FileServer(http.Dir(root))))

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}
	addr := ":" + port

	log.Println("Serving static from", root)
	log.Println("MARKI Secure running at", addr, "PUBLIC_BASE=", publicBase)

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

	app, ok, err := fsLatestApplicationForUser(ctx, u)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	var status any = nil
	if ok {
		status = app.Status
	}

	writeJSON(w, 200, map[string]any{
		"email":                    u,
		"isAdmin":                  isAdmin(u),
		"isManufacturer":           len(brands) > 0,
		"brands":                   brands,
		"companyApplicationStatus": status, // "pending"/"approved"/"rejected" or null
	})
}

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
	_, err = fsDoc("admins/"+strings.ToLower(u)).Create(ctx, map[string]any{
		"email": strings.ToLower(u), "createdAt": time.Now(),
	})
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "admin": strings.ToLower(u)})
}

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
	var body struct{ Email string }
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
		"email": email, "updatedAt": time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

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

func adminListApplications(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
		return
	}

	actor := currentUser(r)
	if !isAdmin(actor) {
		writeJSON(w, 403, ErrorResp{"forbidden"})
		return
	}
	statusStr := strings.TrimSpace(r.URL.Query().Get("status"))
	if statusStr == "" {
		statusStr = string(AppPending)
	}
	var st AppStatus
	switch strings.ToLower(statusStr) {
	case "pending":
		st = AppPending
	case "approved":
		st = AppApproved
	case "rejected":
		st = AppRejected
	default:
		writeJSON(w, 400, ErrorResp{"bad status"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	list, err := fsListApplicationsByStatus(ctx, st)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, list)
}

func adminModerateApplication(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		returnOK(w)
		return
	}

	actor := currentUser(r)
	if !isAdmin(actor) {
		writeJSON(w, 403, ErrorResp{"forbidden"})
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/admins/company-applications/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 {
		writeJSON(w, 404, ErrorResp{"not found"})
		return
	}
	id := parts[0]
	action := parts[1]

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	switch action {
	case "approve":
		if r.Method != http.MethodPost {
			writeJSON(w, 405, ErrorResp{"Method not allowed"})
			return
		}
		app, err := fsApproveApplication(ctx, id, actor)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "already") {
				writeJSON(w, 409, ErrorResp{err.Error()})
				return
			}
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		// авто-створюємо бренд і одразу його верифікуємо
		ownerEmail := app.ContactEmail
		if ownerEmail == "" {
			ownerEmail = app.User
		}
		if strings.TrimSpace(app.BrandName) == "" {
			app.BrandName = app.LegalName
		}
		if strings.TrimSpace(app.BrandName) != "" && ownerEmail != "" {
			b, err := fsCreateBrand(ctx, app.BrandName, ownerEmail)
			if err == nil {
				_, _ = fsVerifyBrand(ctx, b.Slug, actor)
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "app": app})
		return

	case "reject":
		if r.Method != http.MethodPost {
			writeJSON(w, 405, ErrorResp{"Method not allowed"})
			return
		}
		var body struct{ Reason string `json:"reason"` }
		_ = json.NewDecoder(r.Body).Decode(&body)
		app, err := fsRejectApplication(ctx, id, actor, strings.TrimSpace(body.Reason))
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "app": app})
		return
	default:
		writeJSON(w, 404, ErrorResp{"not found"})
	}
}

func companyApply(w http.ResponseWriter, r *http.Request) {
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
	var body struct {
		FullName, ContactEmail, LegalName, BrandName, Country, VAT, RegNumber, Site, Phone, Address string
		ProofURL, ProofPath                                                                          string
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, ErrorResp{"invalid json"})
		return
	}
	app := CompanyApplication{
		User:         user,
		FullName:     strings.TrimSpace(body.FullName),
		ContactEmail: strings.ToLower(strings.TrimSpace(body.ContactEmail)),
		LegalName:    strings.TrimSpace(body.LegalName),
		BrandName:    strings.TrimSpace(body.BrandName),
		Country:      strings.TrimSpace(body.Country),
		VAT:          strings.TrimSpace(body.VAT),
		RegNumber:    strings.TrimSpace(body.RegNumber),
		Site:         strings.TrimSpace(body.Site),
		Phone:        strings.TrimSpace(body.Phone),
		Address:      strings.TrimSpace(body.Address),
		ProofURL:     strings.TrimSpace(body.ProofURL),
		ProofPath:    strings.TrimSpace(body.ProofPath),
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	created, err := fsCreateCompanyApplication(ctx, app)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 201, created)
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
		u := currentUser(r)
		if u == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		var body struct{ Name string `json:"name"` }
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

// ===== Batches =====
func manufacturerBatches(w http.ResponseWriter, r *http.Request) {
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
		list, err := fsListBatchesByOwner(ctx, u)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, list)
		return
	case http.MethodPost:
		u := currentUser(r)
		if u == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		var body struct{ Title string `json:"title"` }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, ErrorResp{"invalid json"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		defer cancel()
		b, err := fsCreateBatch(ctx, body.Title, u)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 201, b)
		return
	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

// ==== USER create products ====
type userCreateReq struct {
	Name           string   `json:"name"`
	SKU            string   `json:"sku,omitempty"`
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
	sku := strings.ToUpper(strings.TrimSpace(req.SKU))
	manAt := strings.TrimSpace(req.ManufacturedAt)
	if manAt == "" {
		manAt = time.Now().Format("2006-01-02")
	}
	total := req.EditionCount
	if total <= 0 {
		total = 1
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
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
			TokenID:      0,
			BrandSlug:    "", // юзерський продукт без бренду
			Meta:         meta,
			SKU:          sku,
			BatchID:      "", // без партії у юзера
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

// ==== COMPANY products (GET my by SKU, POST create with brand & batch) ====

type companyCreateReq struct {
	Name           string   `json:"name"`
	SKU            string   `json:"sku,omitempty"`
	ManufacturedAt string   `json:"manufacturedAt,omitempty"`
	Image          string   `json:"image,omitempty"`
	EditionCount   int      `json:"editionCount,omitempty"`
	Certificates   []string `json:"certificates,omitempty"`
	BatchID        string   `json:"batchId,omitempty"`
}

func companyProducts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		returnOK(w)
		return

	case http.MethodGet:
		// /api/manufacturer/products?sku=ABC
		u := currentUser(r)
		if u == "" {
			writeJSON(w, 401, ErrorResp{"missing user"})
			return
		}
		sku := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("sku")))
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		list, err := fsListProductsByOwner(ctx, u, sku)
		if err != nil {
			writeJSON(w, 500, ErrorResp{err.Error()})
			return
		}
		writeJSON(w, 200, list)
		return

	case http.MethodPost:
		u := currentUser(r)
		if u == "" {
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

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		brandSlug, ok, err := fsFirstBrandSlugByOwner(ctx, u)
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
		sku := strings.ToUpper(strings.TrimSpace(req.SKU))
		batchID := strings.TrimSpace(req.BatchID)

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
				SKU:          sku,
				BatchID:      batchID,
				IPFSHash:     ipfs,
				SerialHash:   serH,
				State:        StateCreated,
				CreatedAt:    time.Now().UnixMilli(),
				PublicURL:    "",
				Owner:        u,
				Seller:       u,
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
		return

	default:
		writeJSON(w, 405, ErrorResp{"Method not allowed"})
	}
}

// ==== PRODUCTS list (my; optional ?sku=) ====

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

	sku := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("sku")))
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	list, err := fsListProductsByOwner(ctx, user, sku)
	if err != nil {
		writeJSON(w, 500, ErrorResp{err.Error()})
		return
	}
	writeJSON(w, 200, list)
}

// ==== PRODUCT actions (/api/products/{id}/purchase) ====

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
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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

// ==== VERIFY (/api/verify/{id}) ====

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

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
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

	// приховаємо серійник якщо не власник/адмін
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
		"sku":          p.SKU,
		"batchId":      p.BatchID,
		"scope":        scope,
		"canAcquire":   canAcquire,
	})
}
