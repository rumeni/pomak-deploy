# POMAK CI/CD and iPhone PWA testing

## GitHub Actions

- `pull_request -> main`: frontend tests/lint/build/PWA Chromium smoke, backend tests with Postgres, and an installable Android debug APK uploaded for 7 days. Newer pushes to the same PR cancel superseded CI runs.
- `push -> main`: rerun all three jobs on the actual merged commit. After they pass, `production-smoke` waits for `https://pomak-web.vercel.app/build.json` to expose the same Git SHA and then checks the web login shell, API health, API database readiness, and the frontend API rewrite. It requires no tokens or test credentials.
- `workflow_dispatch`: manually rerun CI on `main` after Vercel rate-limit resets.

A healthy older deployment **must not** count as a successful new release. If the web is blocked by Vercel's build quota, the post-deploy job goes red instead of claiming that code reached production. The web SHA check is exact; API checks are liveness/readiness, **not** a proof of the API's Git SHA or a substitute for actual login/refresh/registration tests.

## Vercel build quota

Both `frontend/vercel.json` and `backend/vercel.json` intentionally allow automatic Git-triggered deploys only from `main`. The `**` pattern includes slash-containing feature branches, while the explicit `main: true` overrides the false wildcard. This avoids auto preview builds for each PR commit while preserving automatic production deployments. To do staged preview testing, manually create a preview deployment or temporarily enable preview branches, then revert this policy.

The setting does not perform any production deployment by itself. When the changes are merged, GitHub Actions and Vercel still run independently: CI does not gate Vercel's promotion. For strict gated releases consider Vercel Deployment Checks later.

## iPhone PWA

POMAK remains a website, not a signed native iOS application. On iPhone, open `https://pomak-web.vercel.app` in Safari, use **Share -> Add to Home Screen**, and launch via the new icon. The project has a web manifest, standalone mode, Apple touch icon, viewport safe-area, local IndexedDB outbox, and a service worker that precaches the app shell. On first run, go online to load and sign in. Offline data availability is limited to functionality implemented locally; new server-only requests cannot work offline.

The Android debug APK is a separate installable Android app. No paid Apple account, Mac or iOS build is required for PWA.
