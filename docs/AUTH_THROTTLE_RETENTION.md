# Auth throttle bucket retention

The `accounts_auththrottlebucket` table stores only SHA-256 identity keys, time windows and counters. Authentication and password-deletion throttles produce new rows over time. Existing windows do not expire automatically in PostgreSQL.

## Automatic maintenance

The **pomak-api** Vercel project has root directory `backend`, so `backend/vercel.json` registers one daily cron at **04:00 UTC** (`0 4 * * *`; Vercel Hobby may trigger any time during the hour). Vercel makes an HTTPS GET to `/api/internal/cleanup-auth-throttle/` on the **production** API deployment and includes `Authorization: Bearer <CRON_SECRET>`.

Set a long, random `CRON_SECRET` as an **encrypted Production** environment variable in the `pomak-api` Vercel project, then redeploy. The endpoint **returns 404 without a configured secret and 401 without the correct bearer credential**. The auth secret is never committed to GitHub.

The cleanup deletes only rows with `window_start` strictly older than two hours. This is safe for both one-minute login quotas and one-hour account-deletion quotas. Cleanup is idempotent, deletes at most **150,000 rows per invocation** (50 batches of 3,000), and reports `more_expired: true` if some rows remain for the next run. The job does not purge JWT blacklists, accounts, workouts, or meals.

Local/manual equivalent:

```bash
cd backend
python manage.py cleanup_auth_throttle
```

To verify daily execution, check the **pomak-api → Cron Jobs** and runtime logs in Vercel. The API is not designed to expose deletion counts publicly.

With the shared auth IP limit reduced from 120 to **60 requests/IP/minute**, one continuously abusive source can create at most about **87,840** minute+account buckets/day (60 distinct account keys plus one IP bucket per minute). Extra Turnstile verification keys add a small bounded amount. **Distributed attacks across many source IPs can still exceed cron capacity**; deploy and monitor Vercel WAF rate limits before relying on cleanup as a sustained-attack defense.

If a severe traffic attack creates more than 150,000 expired rows per day, reduce source abuse upstream and run the command in a trusted one-off job until the backlog is clear. This is retention cleanup, **not** a substitute for rate limiting or a DDoS defense.
