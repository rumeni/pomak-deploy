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
4. The **initial** database setup is done once on a trusted machine or in the protected
   GitHub release workflow. Subsequent production migrations MUST run **before** promoting
   code that needs them. Never put migrations in a Vercel build (preview and concurrent builds
   could race, and a successful build can become live before migration completes).

   ```bash
   cd backend
   python -m pip install -r requirements.txt
   # supply DATABASE_URL and SECRET_KEY privately, never in Git
   python manage.py migrate --noinput
   python manage.py migrate --check
   ```

   The migrations seed shared exercise and food libraries. A deployment's migrations must be
   **expand/contract-compatible**: when the migration runs, the old production API remains live.
   Add nullable columns/new tables first; remove/rename old columns only in a later release
   after old code is no longer serving traffic.

### Production release gate (PR #77 and later)

Both `backend/vercel.json` and `frontend/vercel.json` disable automatic `main` deployments
(`git.deploymentEnabled.main=false`). The reviewed GitHub Actions workflow is now the only
intended production release mechanism. It runs after frontend/backend/Android CI passes:

1. Acquire the **GitHub `production` environment** (restrict it to `main`, protect it with a
   required reviewer if practical). The job refuses to proceed if credentials are absent.
2. Connect to the production Neon database with `NEON_MIGRATE_DATABASE_URL` and run
   `python manage.py migrate --noinput` then `migrate --check`.
3. Only after successful migration, build and deploy `pomak-api` with the reviewed, pinned
   Vercel CLI. If deployment or API readiness fails, **do not deploy the new web**.
4. Deploy `pomak-web` with the new commit SHA embedded in `build.json`.
5. Production smoke checks the exact web commit and API health/readiness.

**Before merging the release-workflow PR**, configure the following as secrets in the GitHub
`production` environment (Settings → Environments → production → Environment secrets):

- `NEON_MIGRATE_DATABASE_URL`: Neon **direct (unpooled)** PostgreSQL connection URI with
  `sslmode=require`, for the **same production database** used by `pomak-api`. Use a
  least-privileged migration role with DDL permissions. Never use the test/backup branch URL.
- `VERCEL_TOKEN`: Vercel token scoped to the `rumenis-projects` team that can deploy the two
  existing projects. Create it under Vercel account tokens; never paste it into Git or chat.

The Vercel organization and project IDs are not secrets and are fixed in `ci.yml`. The
workflow has `cancel-in-progress: false` so a second release cannot interrupt an active
migration or deployment. **Test the production release path before relying on it.** If these
secrets are missing, `main` CI will fail closed, and neither project will auto-deploy.

Recovery: if a migration fails, leave the old API/web live and repair it through a reviewed
follow-up. If the API build fails after an additive migration, the old API must remain
compatible with the expanded schema. Never roll back migrations by dropping columns that
might contain user data.

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
