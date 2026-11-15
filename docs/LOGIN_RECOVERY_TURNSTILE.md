# Issue #6 — bounded login recovery with Turnstile

## Threat model

POMAK's original per-email PostgreSQL limit of 10 login attempts/minute prevents distributed password guessing, but attackers can deliberately exhaust it to block a valid sign-in. A password-only exception is **not safe**: an attacker can rotate IPs and keep trying passwords after the account bucket is full. This implementation keeps the original quota and opens a *separate, small* recovery budget **only after independent server-side Turnstile verification**.

Both real and nonexistent emails follow the same quota and verification path; the server does not query whether the email exists before requiring a challenge.

### Admission rules

- Normal login: **10 requests/account/minute**, **120 requests/IP/minute** in PostgreSQL, plus the existing DRF anonymous and auth-scoped throttles.
- After exhaustion: return HTTP 429 and `code: login_verification_required` only if recovery is enabled and server-side configuration is complete; otherwise preserve the original 429 behavior.
- Challenged login: token must be verified by Cloudflare's HTTPS Siteverify endpoint with the **backend secret**, and must match `action=pomak_login_recovery` and an explicitly allowlisted hostname. Cloudflare validates expiry and single-use (300 seconds); a duplicate must fail.
- After successful Siteverify, allow at most **2 verified recovery logins/account/minute** and **3/IP/minute**, in atomic PostgreSQL buckets; incorrect passwords still count. This keeps a bounded account-wide rate even across rotating IP addresses.
- Before Siteverify, limit validation attempts to **8/IP/minute** to cap unnecessary provider calls. Unverified tokens do not consume the two precious per-account recovery attempts, so random invalid-token spam cannot directly exhaust them.
- Network errors, wrong action/hostname, token length over 2048, missing configuration and Siteverify failures all fail closed. No bypass based only on password correctness.
- Recovery still respects the other DRF IP-based throttles. A user behind the same abusive IP may need to wait for that separate IP window; the recovery protects against **distributed, per-account** lockouts, not a saturated IP-wide gate.
- The existing 2-hour retention job cleans the same-minute challenge buckets automatically; no database migration.

Security limits: Turnstile is friction rather than a mathematical proof of humanity. An attacker who repeatedly solves valid challenges can still use the small recovery budget or attempt denial of service. Monitor verification failures, account rates and user feedback. Stronger/longer duration limits or dedicated risk scoring are future options.

## Deployment (all must be satisfied before enabling)

1. Create a Cloudflare Turnstile managed widget. Restrict it to the real web domain(s) you own; confirm the actual domain and native Android WebView origin, not an assumed placeholder. Cloudflare currently supports WebViews, but Android Capacitor loads the app under `https://localhost`, which requires explicit device testing and carefully configured hostname allowances; avoid allowing localhost for general web clients unless this has been assessed. Production and local test widgets should be separate.
2. Configure **pomak-web** Vercel Build/Environment variable `VITE_TURNSTILE_SITE_KEY` (public key), redeploy the frontend, and validate challenge rendering in browser/PWA. Rebuild Android with the correct public key; Vite variables are baked into client bundles.
3. Configure **pomak-api** Vercel server-only variables `TURNSTILE_SECRET_KEY` and `TURNSTILE_ALLOWED_HOSTNAMES` (comma-separated hostname list, **no schemes or ports**). Never put the secret in `VITE_*` or commit it. Turnstile's returned `hostname` and `action` are checked on every challenge.
4. Initially leave `TURNSTILE_LOGIN_ENABLED=False`. Verify Django tests, frontend tests/build, and browser + installed PWA + Android WebView under real network conditions. Only then turn **pomak-api** `TURNSTILE_LOGIN_ENABLED=True`, redeploy the API and test the 11th login challenge end-to-end. Verify the login is not blocked by a stale app/unsupported widget.
5. Monitor Vercel logs and Turnstile analytics for failures, CSP/WebView restrictions, and suspicious challenge volume. Roll back instantly by setting `TURNSTILE_LOGIN_ENABLED=False` and redeploying the API: the original strict account limit is restored without schema changes.

Do not use Cloudflare's **test** secret in production. The backend checks and refuses common documented test-secret prefixes when `DEBUG=False` and the feature is enabled.

### Verification checklist

- Ten wrong passwords from ten different IPs; an 11th request gets a challenge, and an **independently verified** challenge with the correct password logs in.
- Unknown email receives the same throttled response and challenge behavior (no existence disclosure).
- Invalid/reused/expired token and wrong action/hostname fail; no tokens or secrets leak in logs.
- Two validated wrong-password recovery attempts consume the per-account verified budget. A third fails even from a new IP.
- Confirm accessibility, widget expiry/reset, offline/online transitions, registration and refresh remain unchanged.
- Confirm real installed PWA update and Android Capacitor WebView (including access to `challenges.cloudflare.com`) before enabling in production.
- Recheck `VITE_TURNSTILE_SITE_KEY` presence on all deployed web/native builds and stage changes as above.

## References

- [Cloudflare Siteverify and one-time token behavior](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Cloudflare mobile WebView requirements](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)
- [Hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- [Official test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
