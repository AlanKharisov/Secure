# MARKI Secure

Product provenance and lifecycle management through authenticated APIs, QR verification, and a lightweight operations dashboard.

## Overview

MARKI Secure is a Go and Firebase application for managing manufacturers, product records, ownership changes, and public verification. It gives operations teams a single workflow for onboarding companies, issuing traceable products, and exposing a verification result through a QR-friendly endpoint.

The repository contains:

- a Go REST API backed by Firebase Authentication and Cloud Firestore;
- a static HTML, CSS, and JavaScript dashboard in `docs/`;
- manufacturer, batch, product, purchase, and verification workflows;
- administrative review and access-management endpoints.

## Core capabilities

- Verify Firebase ID tokens and load the current user context.
- Submit and moderate company applications.
- Create and verify manufacturer profiles.
- Group products into manufacturer batches.
- Create, list, purchase, and verify product records.
- Track product states such as created, purchased, claimed, and revoked.
- Generate and consume QR-oriented public product URLs.
- Configure CORS, security headers, and an explicitly gated development identity fallback.

## Architecture

```text
Browser dashboard (docs/)
        │
        │ HTTPS + Firebase ID token
        ▼
Go net/http API
        │
        ├── Firebase Authentication
        └── Cloud Firestore
                ├── users and administrators
                ├── company applications
                ├── manufacturers and batches
                └── products and ownership state
```

The Go service can also serve the static dashboard from `DOCS_DIR`, keeping the API and demonstration UI in one deployable process.

## Technology

- Go 1.24
- `net/http`
- Firebase Authentication
- Cloud Firestore
- HTML, CSS, and modern JavaScript
- QR code generation through a browser-side module

## API overview

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Current user | `/api/me` |
| Administrators | `/api/admins`, `/api/admins/bootstrap`, `/api/admins/grant` |
| Company review | `/api/company/apply`, `/api/admins/company-applications/*` |
| Manufacturers | `/api/manufacturers`, `/api/manufacturers/*` |
| Batches | `/api/manufacturer/batches` |
| Products | `/api/user/products`, `/api/manufacturer/products`, `/api/products/*` |
| Verification | `/api/verify/{product-id}` |

Protected routes expect a Firebase ID token. Administrative operations are authorised separately in the service.

## Run locally

### Prerequisites

- Go 1.24 or a compatible toolchain
- A Firebase project with Authentication and Firestore enabled
- Google application credentials for local server access

### Configuration

Set secrets in your shell or deployment platform. Do not commit service-account JSON.

| Variable | Required | Purpose |
|---|---:|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | One credential method required | Path to a local service-account file |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | One credential method required | Inline service-account JSON for managed hosting |
| `FIRESTORE_PROJECT_ID` | Recommended | Explicit Firebase/Google Cloud project ID |
| `ALLOWED_ORIGINS` | Production | Comma-separated browser origins |
| `PUBLIC_BASE` | Production | Base URL used for public product links |
| `DOCS_DIR` | No | Static dashboard directory; defaults to `docs` |
| `PORT` | No | HTTP port |
| `ALLOW_XUSER_DEV` | Development only | Enables the local identity fallback when set to `true` |

```bash
git clone https://github.com/AlanKharisov/Secure.git
cd Secure

go mod download
go run .
```

Check the service:

```bash
curl http://localhost:5000/health
```

## Project structure

```text
.
├── main.go          # Domain models, Firebase integration, handlers, and server
├── go.mod
├── go.sum
└── docs/            # Static operations dashboard
    ├── index.html
    ├── admin.html
    ├── dashboard.html
    ├── css/
    └── js/
```

## Demo and screenshots

The previous GitHub Pages deployment is not currently available. Real product captures should be added here when a stable demo environment is restored:

- operations dashboard;
- company-application review;
- product details and lifecycle state;
- QR-based public verification.

## Deployment

The service is designed for a Go-compatible container or managed runtime with credentials supplied through the platform's secret manager. The current repository does not advertise an active public backend deployment.

For production:

- keep service-account credentials outside Git;
- restrict Firebase client configuration to the intended domains and APIs;
- configure `ALLOWED_ORIGINS` explicitly;
- keep `ALLOW_XUSER_DEV` disabled;
- use HTTPS for every dashboard and API request.

## Status

Active prototype. The backend compiles successfully with `go test ./...`; automated tests have not yet been added.

## My contribution

I designed and implemented the product workflows represented in this repository, including the Go API, Firebase/Firestore integration, administrative operations, product lifecycle, verification flow, and dashboard integration. The commit history is authored under variants of my name, Alan Kharisov.
