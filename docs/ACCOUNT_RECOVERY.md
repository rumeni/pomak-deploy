# POMAK — password recovery and email verification rollout

**Status:** backend/frontend implementation in draft PR; `ACCOUNT_EMAIL_ENABLED=False` by default. Do not enable production account email flows until a verified sender and Android compatible build are in place.

## Security behavior

- `POST /api/auth/password/reset/request/` accepts a valid email and returns the same HTTP 202/JSON for both known and unknown accounts. Requests are subject to PostgreSQL-backed IP and email throttling.
- An emailed `/lozinka/reset?uid=...&token=...` link expires after **30 minutes**. The token is Django's password-reset HMAC and cannot be reused once the password changes.
- `POST /api/auth/password/change/` requires current password and authenticated JWT. Changing/resetting passwords increments the user's `session_version`. **All old access and refresh JWTs** fail authentication; outstanding refresh tokens are also blacklisted. Users sign in again with the new password.
- New accounts created **after** enabling `ACCOUNT_EMAIL_ENABLED` must confirm their email address using a signed 24-hour link; protected API endpoints return 403 until verified. `/api/auth/me/`, `/api/auth/email/resend/`, logout and confirmation are available during verification. Existing accounts are not retroactively locked out.
- Unverified confirmation is single-use; after a successful confirmation the user has to reload to refresh `/auth/me/`.
- Password rules use Django's existing password validators. Token values never enter application logs intentionally.
- No new email or password is stored in frontend localStorage; Android refresh remains in the native secure store.
- The register endpoint **still distinguishes duplicate emails**; complete anti-enumeration requires the separate signup-by-email workflow in issue #17.

## Production configuration

Set the following variables on **pomak-api**, through Vercel encrypted environment variables, and on `pomak-web` only where noted. Never commit credentials.

| Variable | Scope | Guidance |
|---|---|---|
| `ACCOUNT_EMAIL_ENABLED` | API | `False` initially; explicitly set `True` only after Android/web checks |
| `ACCOUNT_EMAIL_BASE_URL` | API | Canonical HTTPS web origin (e.g. `https://pomak-web.vercel.app`) |
| `EMAIL_HOST` | API | SMTP hostname of the chosen transactional provider |
| `EMAIL_PORT` | API | Usually `587` |
| `EMAIL_USE_TLS` | API | `True` for SMTP STARTTLS |
| `EMAIL_HOST_USER` | API | Encrypted SMTP username/API key |
| `EMAIL_HOST_PASSWORD` | API | Encrypted SMTP password/API key |
| `DEFAULT_FROM_EMAIL` | API | Verified sender for the project domain |
| `VITE_ACCOUNT_EMAIL_ENABLED` | Web / Android build | Set `true` after email service QA to show the forgotten-password link |
| `SECRET_KEY` | API | Existing stable encrypted Django secret, do not rotate casually |

When enabled outside DEBUG, startup refuses invalid/missing HTTPS sender settings. Disabling this flag does not undo the schema migration or password changes. **Never use Django's console email backend in production**.

## Staged QA before enabling

1. Apply migration `accounts.0006_user_email_verification_session_version` **once** from trusted deployment tooling, not automatically from parallel Vercel builds. Verify old accounts remain usable.
2. Deploy frontend and backend with `ACCOUNT_EMAIL_ENABLED=False`. Verify existing login/refresh, old Android APK, and authenticated password change. No email should be sent at this stage.
3. Configure transactional email DNS/sender (SPF, DKIM, DMARC), test deliverability including a second real mailbox, link TTL/one-time consumption and resend failures.
4. Test signup → unverified profile → blocked protected routes → verify link → app accessible on web **and** a fresh Android build. Test reset and password change across two devices: all old JWTs must fail.
5. Only after these checks, enable `ACCOUNT_EMAIL_ENABLED=True` on the API and `VITE_ACCOUNT_EMAIL_ENABLED=true` at frontend build time; monitor rate limiting, error rates and delivery timeouts. Plan rollback by setting email flag to False while preserving data and previous account access.

## Operational limits

SMTP delivery is synchronous in the current implementation. For a public/high-volume launch, move sends to a managed queue and track delivery failures without logging reset links. A 202 response does not prove an email was delivered. If the provider fails after signup, new users need the resend operation. This PR does not implement provider provisioning, inbox tests, SMS recovery or legal/privacy pages.
