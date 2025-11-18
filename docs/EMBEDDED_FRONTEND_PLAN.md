# Shopify Embedded Frontend Plan

**Goal:** Replace the static HTML views served from `backend/src/views` with a first-class embedded app that runs inside Shopify Admin, reuses Cartrel’s REST APIs, and keeps all data mutations on the backend (no client-side data loss).

## 1. Tech Stack
- **Framework:** React + Vite (fast dev server) or Next.js (if we want SSR/lambda later). Keep it in `frontend/`.
- **UI Kit:** Shopify Polaris for native look/feel.
- **Bridge:** Shopify App Bridge + App Bridge React to handle auth redirects, `host` param parsing, and navigation.
- **State/Data:** SWR or React Query for REST calls to our backend; each request includes the Shopify session token obtained via App Bridge.
- **Build Output:** Static bundle served behind `/app` via Express or uploaded to object storage/CDN and proxied through the backend.

## 2. Data Flow & Security
1. Shopify loads the embedded app iframe with `host` and `shop` params.
2. Frontend boots App Bridge, requests a session token (`getSessionToken`), and attaches it as `Authorization: Bearer <token>` on every API call to `https://cartrel.com/api/...`.
3. Backend verifies the token, looks up the shop session, and performs database mutations. **No direct Shopify mutations happen in the browser**—the browser can only call our REST endpoints.
4. Responses contain data only; writes remain server-side, so there’s no risk of losing data if the iframe reloads.

## 3. UX Surfaces
- **Dashboard Landing:** Key counters (connections, invites pending, orders).
- **Connections View:** Invite creation, pending/active lists, tier display.
- **Catalog Management:** Wholesale toggles, sync preferences, import wizard trigger.
- **Retailer Tools:** Available products, import preview, markup settings, PO creation.
- **Health/Status:** Inline status widget that embeds `/status` JSON.

Each page should map 1:1 with existing REST endpoints to minimize new backend work.

## 4. Directory Layout
```
frontend/
├── src/
│   ├── main.tsx        # App Bridge + Polaris providers
│   ├── routes/         # Feature routes (dashboard, connections, etc.)
│   ├── components/     # Shared UI bits
│   ├── hooks/          # useSessionToken, useApi
│   ├── lib/api.ts      # Axios/SWR client
│   └── types/          # Shared DTO interfaces
├── public/
├── package.json
└── vite.config.ts
```
Hook the Vite dev server up to the backend via proxy so `npm run dev` starts both.

## 5. Implementation Steps
1. **Bootstrap frontend** (`npm create vite@latest frontend -- --template react-ts`), add Polaris/App Bridge dependencies.
2. **Session Token Hook:** Implement `useSessionToken` that refreshes tokens every minute and caches them.
3. **API Client:** Create a tiny wrapper around `fetch`/Axios that injects the token and handles 401 → redirect to `/auth/shopify`.
4. **Feature Routes:** Port HTML view functionality into React pages, calling the existing APIs.
5. **Build Integration:** Add a build step in the backend Dockerfile that copies `frontend/dist` into `backend/dist/public` and have Express serve it at `/app/*`.
6. **Auth Hardening:** Update `/` route to always serve the embedded bundle when `shop` + `host` params are present, falling back to marketing pages otherwise.
7. **QA:** Use Shopify’s Embedded App tools to test navigation, exit iframe flow, and verify no data is mutated directly from the client.

## 6. Data-Loss Safeguards
- All writes hit backend APIs; the frontend merely sends JSON payloads that the backend validates.
- Use optimistic UI only for display; never assume a write succeeded until the API responds.
- Keep AutoSave/long-running flows server-driven (queues/processors stay unchanged).
- When handling file uploads or large imports, call the existing async import endpoints—never attempt to process the files in-browser beyond validation.

## 7. Timeline & Deliverables
| Week | Deliverable |
|------|-------------|
| 1 | Bootstrap project, App Bridge wiring, simple dashboard shell |
| 2 | Connections + invites + catalog toggles screens |
| 3 | Retailer import wizard + PO flow |
| 4 | Health/status embeds, polish, analytics hooks |

Once GA, retire the legacy HTML views and keep them only for marketing pages (`/landing`, `/pricing`, etc.).
