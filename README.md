# The Catalogue

Monitor up to 10 Shopify brands, browse their catalogues, and get restock emails for one exact size and colour.

Every page except sign-in, sign-up, and password reset requires a signed-in account. There is no guest browsing. Each account sees only its own stores, catalogue, updates, and saved products with their size alerts.

| Folder | Contents | Status |
|---|---|---|
| `frontend/` | React, TypeScript, Vite, React Router | Done. Uses the real API. |
| `backend/` | FastAPI, SQLAlchemy, Alembic, Authlib. Saves stores and catalogues, and runs the daily refresh. | Authentication, stores, catalogue, updates, and saved products with size alerts done. |
| `pipeline/` | Store checks and catalogue reads. Standard library only, no database. | Done |

Reference files: `catalogue-prototype.html` (visual reference) and `AUTHENTICATION_PLAN.md`. `check_shopify_store.py` is the old one-file check. `pipeline/` replaces it.

## How a store is added (auto-approve)

Nobody reviews stores by hand. The pipeline is the gatekeeper, so its checks are strict.

1. The address must be the store's main address. A product link is refused. A collection link becomes the home page.
2. The quick check (during the request) reads the home page, the fixed shop name (such as `xyzfuga.myshopify.com`), the currency, and the first product. The shop name is the store's ID, so `fugazee.com` and `www.fugazee.com` are one store.
3. If the quick check passes, the store is saved and the full import starts after the response. It reads 250 products per page until a page comes back empty. Every page must load. The store is approved only when the import passes.
4. Every address that passed is saved. A later add of that address, by any account, uses the saved result and sends no request.

The pipeline returns `approved`, `rejected`, or `retry_later`, with a reason. The backend maps these to `200`, `422 unsupported_store`, and `502 check_failed`.

Safety and politeness:

- Only public IP addresses. Time limits on the DNS lookup, each request, and the whole check. Size limits on every response. At most 4 redirects.
- At least 1 second between requests to one host. A "slow down" (429) reply pauses that host for the time the store asks (up to 30 seconds), then retries up to 2 times.
- Failed checks are remembered by host: 1 hour for `rejected`, 10 minutes for `retry_later`.
- One account can run 20 checks per hour. Adds that reuse a saved result don't count.

The daily refresh re-checks every monitored store. A store that left Shopify or became a different shop is marked `revoked`: its catalogue still shows, with "latest check failed", and a new add checks it again. Run it once a day, for example from cron:

```bash
cd backend
uv run python -m app.jobs.refresh
```

Check one store from the terminal (exit code 0 approved, 1 rejected, 2 try later):

```bash
cd pipeline
uv run python -m catalogue_pipeline https://fugazee.com
```

## Run the frontend

Use Node.js 24.

```bash
cd frontend
npm ci
npm run dev
```

The app reads live data from `/api`. Vite forwards `/api` to the FastAPI server at `127.0.0.1:8000`. If the API is not running, signed-in pages show a Retry message. Sample data is for tests only (`frontend/src/test/mock/` and `frontend/e2e/fakeApi.ts`).

### Sample-data mode (local development only)

```bash
cd frontend
npm run dev:mock
```

This sets `VITE_API_MODE=mock`. The app then uses sample data in the browser and sends no requests to `/api`. Any email and a password of 8 or more characters sign you in. Each email is a separate sample account. Production builds ignore this setting, and the sample data is not in the bundle.

Sample store addresses for **Add a store**:

| Address | Result |
|---|---|
| `https://fugazee.com` | Ready at once (14 products, two pages) |
| `https://archive.fugazee.com` | Same brand as Fugazee, so it doesn't use another brand slot |
| `https://northline.store` | Imports for a few seconds, then ready |
| `https://halfmast.in` | First import fails and frees its brand slot |
| `https://lowtide.in` | Ready, but the latest check failed |
| `https://kilnandco.in`, `saltwork.co`, `oddmonday.in`, `mosswear.in`, `ferrous.studio`, `papermoon.in`, `quietday.co`, `tallgrass.in`, `ridgeback.co` | More brands, to reach the 10-brand limit |
| `https://offline-shop.in` | “We couldn’t check this store” |
| Any other address, such as `https://example.com` | “Only supported Shopify stores can be added.” |

The signed-in dashboard uses Tailwind CSS and shadcn/ui (Radix registry). Its design tokens apply only inside `.dashboard-theme`, which covers the shell and its overlays. The public sign-in pages keep `src/styles.css`.

## Run the API

Use Python 3.13, [uv](https://docs.astral.sh/uv/), and PostgreSQL 18. Settings come from `.env` at the repository root (see `.env.example`).

```bash
cd backend
uv sync --locked
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Then run `npm run dev` in `frontend/` and open http://localhost:5173. Vite forwards `/api` to the API. Use port 5173: Google only accepts the registered callback `http://localhost:5173/api/auth/google/callback`.

Check the API:

```bash
cd backend
uv run ruff check .
uv run pytest
```

Check the pipeline:

```bash
cd pipeline
uv run ruff check .
uv run pytest
```

Pipeline tests use a fake network. They send no requests.

The tests use a separate database, `the_catalogue_test`, and fake SMTP and Google clients. They send no email.

### Authentication summary

- **Email sign-up:** a one-time link (30 minutes) confirms the email before the password is set. Passwords use Argon2id.
- **Google sign-in:** OpenID Connect with state, nonce, and PKCE stored in short-lived PostgreSQL rows. Accounts are matched by Google's `sub`. A Google email that already has an account is not linked automatically: the person signs in first, then links Google in Settings (recent sign-in required).
- **Two-factor:** authenticator apps (secret encrypted with Fernet, reused codes rejected) and 10 one-time recovery codes (Argon2 hashes). Required after either sign-in method.
- **Sessions:** a 15-minute access token (PyJWT) and a rotating renewal token, both in `HttpOnly` cookies. A replayed renewal token revokes the session. Password changes and resets revoke every session. Resets keep two-factor on.
- **Protection:** writes need the app's origin and the `X-CSRF-Token` header. API responses send `Cache-Control: no-store`. Sign-in and email requests are rate-limited in PostgreSQL.
- **Email:** sent from a Gmail account over SMTP (`smtp.gmail.com:587`, STARTTLS) to each user's own address. Set `SMTP_USERNAME`, `SMTP_PASSWORD` (a Google app password), and `EMAIL_FROM` in `.env`. A personal Gmail account sends about 500 emails a day. Resend was removed; a custom domain with a provider such as Resend is the upgrade path when volume grows.
- `GET/POST /api/stores` and `DELETE /api/stores/{id}` are live.
- `GET /api/stores/{id}/products` and `/api/stores/{id}/products/{productId}` are live. They return 404 for a store the account doesn't monitor. Until the first import is ready, the list is empty.
- `GET /api/updates?kind=` is live.
- `GET/POST /api/alerts` and `DELETE /api/alerts/{id}` are live.
- `GET /api/wishlist`, `PUT /api/wishlist/{productId}`, and `DELETE /api/wishlist/{productId}` are live. They serve the Saved page. `DELETE` returns `{"cancelledAlerts": n}`.

### Updates and price history

- Each refresh compares the new catalogue with the saved one. The first import records no updates, because it has nothing to compare with.
- Kinds: `price_drop`, `price_rise`, `restock`, and `sold_out`. When every option of a product has the same change, one update covers the product (`variantTitle` is null). Otherwise each option gets its own update.
- Only accounts that monitor the store see its updates. Updates for removed products are hidden. Updates older than 90 days are deleted. The list shows the newest 200.
- Price history saves a point for each new option and each price change, not each check. The product page shows up to 30 points per option, and the product's lowest price over time.

### Catalogue filters

- `q` matches the product title or a colour value. `size` matches the variant's size option. With `size`, `availability` (`in` or `out`) looks at that size only.
- `price` bands follow each store's own prices: `low` is the cheapest third, `mid` the middle third, and `high` the top third. This works for any currency.
- 12 products per page, newest first. `nextCursor` is the next offset.
- `alerts` on a product lists the account's active alerts for it.

## Check the frontend

```bash
cd frontend
npm run typecheck
npm run lint
npm test
npm run e2e
```

`npm run e2e` starts its own dev server. Playwright serves `/api` from sample data through `e2e/fakeApi.ts`, so the real HTTP client runs in the browser. `e2e/screens.spec.ts` writes review screenshots at 1440, 1024, 768, 390, and 320 px to `test-results/screens/`. To test a server that already runs, set `PLAYWRIGHT_BASE_URL`.

## API contract

`frontend/src/api/client.ts` defines the `Api` interface. `frontend/src/api/types.ts` defines the response shapes for the planned FastAPI routes. `frontend/src/api/http.ts` calls the routes. The test mock in `frontend/src/test/mock/` follows the same rules that the API must enforce:

- `401` for every private call without a session, and `404` for a store, product, or alert that the account can’t access.
- `422 unsupported_store` with “Only supported Shopify stores can be added.” No entry, brand slot, or import is created.
- `409 brand_limit` for an 11th brand. Another storefront or an alias of a monitored brand is accepted.
- A pending first import counts toward the limit. A failed first import releases the slot.
- Removing a store cancels the account’s active alerts for it.
- One active alert per account and exact variant. In-stock variants are refused.

Routes the frontend expects beyond the original list: `POST /api/auth/sign-in`, `/api/auth/two-factor`, `/api/auth/sign-out`, `/api/auth/signup`, `/api/auth/password-reset`, `GET /api/auth/google/start?return_to=…&intent=link`, `GET/DELETE /api/sessions[/{id}]`, and `POST /api/account/password` and `/api/account/two-factor/{setup,confirm,disable}`. Errors use `{"detail": {"code", "message"}}`. Writes send the `csrf_token` cookie value as `X-CSRF-Token`. The Google linking callback returns to `/account?google=linked` (or an error code such as `reauthentication_required`).

### Restock alerts

- An alert watches one exact sold-out option for one account. In-stock options are refused with `422 not_sold_out`. Asking again for the same option returns the existing alert.
- The account must monitor the store. Removing the store cancels the account's active alerts for it. An account can have up to 200 active alerts.
- The daily refresh sends the emails at the end. An email goes out only when the latest check succeeded and the option is in stock, and only to a verified address.
- An alert is marked `sent` only after the SMTP server accepts the email. A failed send stays `active` and is tried again on the next run, up to 5 times. Each alert has a fixed Message-ID, so a retried copy is the same message. Each alert is locked while it sends, so two runs never send it twice.
- To try failed sends sooner than the daily refresh, run this every hour:

```bash
cd backend
uv run python -m app.jobs.send_alerts
```

### Saved products and size alerts (one list)

Saved products and restock alerts are one feature, shown on the **Saved** page (`/saved`). The old `/wishlist` and `/alerts` addresses open it.

```
 ♡ Save a product ──────────────> Saved page
 Email me when it's back (size M) ─> saves the product too, and shows "Watching M" under it
 Size M is back ──> one email ──> the row shows "Back in stock · email sent"
 Remove the product ──> its active size alerts stop
```

- A heart on each product card, and a Save button on the product page, saves the product. Saving alone sends no email.
- "Email me when it’s back" on a sold-out size creates an alert and saves the product. Stopping an alert keeps the product saved.
- Each saved product lists its watched sizes: the active alert, or else the latest sent one.
- Only products from stores the account monitors can be saved. Saving twice keeps one entry. An account can save up to 500 products.
- Product lists and product details include `saved`, for the signed-in account only.
- Removing a store removes the account's saved products and alerts from it. A product that leaves the store is hidden, and shows again if the store lists it again.
- Migration `0007` saves the product of every existing active or sent alert, so no alert is left without its product.

