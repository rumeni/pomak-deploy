# POMAK — Vercel Hobby + Neon Free deployment

This guide retains the existing `backend/`, `frontend/`, and Android structure. It does **not** convert the application to Next.js.

## Before deploying

- This code may be published publicly only with the original owner's permission. The repository includes exercise illustrations with CC BY-SA attribution; preserve their notices.
- Use Vercel **Hobby** only for non-commercial/personal use and stay within plan quotas. Neon Marketplace has its **own** quotas and billing; select **Free ($0)** explicitly. Do not enable paid add-ons or upgrades.
- No API keys, database URLs, or Django `SECRET_KEY` should be committed to Git.
- Permission from the original project owner to publish this copy was confirmed by the requesting collaborator. Do not assume this grants third parties a software license.

## Architecture

One GitHub monorepo, two Vercel Projects, one Neon PostgreSQL database:

- `pomak-api`: Root Directory = `backend`, Framework = **Django** (auto-detected from `manage.py`); pinned Python 3.13 from `.python-version`.
- `pomak-web`: Root Directory = `frontend`, Framework = **Vite**; Output Directory = `dist` (auto-detected).
- `pomak-db`: Neon PostgreSQL (Free tier). Use **pooled** connection URL in `DATABASE_URL` for serverless functions. Ensure the connection URL uses SSL.

Vercel (2026) auto-detects Django via `manage.py`/`WSGI_APPLICATION`; no `api/index.py` or custom routes are necessary.

## 1. Neon Free database

1. In Vercel → Storage / Marketplace, open existing Neon integration, choose **Create Database**, **Free ($0)**. Verify billing plan and region before creating.
2. Connect this database to `pomak-api` (Production environment). This should populate `DATABASE_URL` as a *protected* environment variable; check its name without exposing the value.
3. Disable preview deployments for the API initially if the preview environment would share the production database.
4. Migrate the database **once** from a trusted development machine, using the Neon connection URL (not stored in repository):

   ```bash
   cd backend
   python -m pip install -r requirements.txt
   # supply DATABASE_URL and SECRET_KEY privately via the shell / local untracked .env
   python manage.py migrate --noinput
   python manage.py check --deploy
   ```

   Don't run migrations automatically on every Vercel build against the production database; preview builds and concurrent builds can cause collisions. The migrations seed shared exercise and food libraries.

## 2. Vercel API project

Create a Vercel project linked to the GitHub repository, name `pomak-api`, Root Directory `backend`, Framework `django`. Set **Production** environment variables:

| Variable | Value / notes |
|---|---|
| `SECRET_KEY` | A strong random secret, stored as Sensitive/Encrypted, never in Git |
| `DEBUG` | `False` |
| `DATABASE_URL` | Neon **pooled** SSL connection string, injected via integration |
| `ALLOWED_HOSTS` | `pomak-api.vercel.app` (adjust if actual domain differs) |
| `CORS_ALLOWED_ORIGINS` | `https://pomak-web.vercel.app,https://localhost,capacitor://localhost` (adjust to real frontend URL) |
| `CSRF_TRUSTED_ORIGINS` | `https://pomak-api.vercel.app` (relevant to Django admin/forms) |

`VERCEL_URL` is read automatically and appended to Django's allowed hosts for immutable deployment URLs. Persistent Django DB connections are disabled on Vercel; pooled Neon PostgreSQL is strongly recommended.

Deployment: verify `GET https://<api-domain>/api/health/` returns `{"status":"ok"}` (liveness only; not a database check).

## 3. Vercel web project

Create another project linked to the **same** GitHub repository, name `pomak-web`, Root Directory `frontend`, Framework `vite`. Set a **Production** environment variable before building:

```
VITE_API_URL=/api
```

This must be a public *URL*, not a secret. The value is compiled into JavaScript at build time. `frontend/vercel.json` proxies `/api/:path*` to `https://pomak-api.vercel.app/api/:path*` **before** the SPA fallback. The API thus appears same-origin to the browser so `HttpOnly; Secure; SameSite=Strict` refresh cookies work without credentialed CORS. Page paths still fall back to `index.html`.

Do not use the React app's localhost API fallback or the direct cross-site API URL in **production web**. Verify browser requests target the web origin `/api` and return cookie-backed login/refresh. Android builds must use their own direct HTTPS `VITE_API_URL=https://pomak-api.vercel.app/api` and be rebuilt separately.

## 4. Smoke tests

- Open the frontend from a fresh session; navigate and reload a nested route (SPA routing).
- Test register → login → `GET /api/auth/me/` (confirm Neon database is migrated).
- Create, edit and delete a routine; log a training session; enter food/measurement data.
- Log out, then refresh and confirm protected endpoints require authentication.
- Test offline mode and synchronization after reconnecting; verify data is not duplicated.
- Check production **runtime** logs on both Vercel projects. Confirm no 500s, 400s for unexpected hosts, CORS failures or database connection exhaustion.
- Check the Android app separately. The APK uses its own build-time API URL; web deployment does not automatically update installed APKs.

## Troubleshooting

- `DisallowedHost` → configure `ALLOWED_HOSTS` with the exact API hostname; redeploy.
- CORS error → update `CORS_ALLOWED_ORIGINS` with the exact **frontend origin**; redeploy.
- Database errors on `/api/auth/...` → verify Neon free database is provisioned, `DATABASE_URL` exists on API project, and migrations ran.
- API proxy errors → verify the `/api/:path*` rewrite precedes the SPA fallback and `VITE_API_URL=/api` for web Production; older web deployments need the proxy before new cookie-only clients can ship.
- Django admin static errors → check `collectstatic` in Vercel Django build logs; `STATIC_ROOT` is already configured.

The `docker-compose.yml` file is intended for **local** development only, not for Vercel. Never deploy the local development DB or `.env` files.
