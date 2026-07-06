# Lavalle Haus OS — Security Audit
**Date:** July 5, 2026 · **Deployment:** https://lavalle-haus-os.vercel.app (Vercel + Upstash Redis)
Evidence-based review of the actual implementation, per the June 11 audit request. Items marked ✅ FIXED were corrected in this same update.

## Security score: 78 / 100
Up from ~55 before this update. The app is safe for its current use (two authorized operators) once `APP_PASSWORD` is confirmed set in Vercel. It is **not yet ready for outside customers** — that requires real multi-user auth and multi-tenant isolation (Phase 3).

## 1. Authentication — GOOD, with one condition
- A house password protects the app: the frontend exchanges it for an HMAC session token (`/api/data?op=login`); every `/api/*` call carries `x-app-token`, and any 401 locks the UI.
- **Condition:** the lock is only active when the `APP_PASSWORD` environment variable is set in Vercel. If it is unset, every endpoint is open by design ("never lock anyone out"). → **Action: verify in Vercel → Settings → Environment Variables that `APP_PASSWORD` is set in Production.**
- The session token never expires and is shared by all users. Acceptable for 2 operators; must change before customers.

## 2. Endpoint coverage — was PARTIAL, now FULL ✅
| Endpoint | Before | Now |
|---|---|---|
| `/api/data`, `/api/amazon-sync`, `/api/shopify-sync`, `/api/fba-shipments` | protected | protected |
| `/api/categorize` (Claude API proxy) | **OPEN — anyone could spend the Anthropic key** | ✅ FIXED — requires session token |
| `/api/drive-upload` (uploads to business Drive) | **OPEN** — anyone could upload files / read status | ✅ FIXED — requires session token |
| `/api/api/fba-shipments` (stray old copy, no auth) | **OPEN — leaked Amazon FBA data** | ✅ FIXED — deleted |
| `/api/shopify-webhook` | verifies Shopify HMAC signature | unchanged (correct) |
| OAuth endpoints (`google-auth/callback`, `shopify-auth/callback`) | open by necessity (browser redirects) | see §5 |

## 3. Database security — ACCEPTABLE
- Upstash Redis is reached only server-side with a bearer token from env vars; the browser never sees KV credentials. TLS in transit; Upstash encrypts at rest.
- All business data lives under one key (`lavalle_data`) plus token keys (`plaid_items`, `shopify_oauth`, `google_oauth`). Single-tenant by design — fine now, not multi-tenant-ready.

## 4. Secrets & environment variables — GOOD
- Anthropic, Plaid, Resend, SP-API, Shopify and Google secrets are all read from `process.env` server-side only; nothing sensitive is compiled into the frontend bundle (verified: only the session token, which is derived, lives in localStorage).
- Bank credentials are never seen by the app (Plaid handles the login).
- Minor: `shopify-auth.js` has a hardcoded fallback `client_id` (public identifier — low risk, but move to env for cleanliness).

## 5. OAuth flows — MODERATE risk, documented
- The Google OAuth client is in testing mode restricted to listed test users, which limits abuse. The Shopify flow requires admin login on the store itself.
- Residual risk: `/api/google-auth` is publicly reachable, so a listed test user could re-run consent and overwrite the stored refresh token. Low likelihood; fix belongs in Phase 2 (signed `state` parameter).

## 6. Financial data — GOOD (after §2 fixes)
- P&L, bank balances, payroll figures and uploaded-statement categorization all flow through protected endpoints now.
- Statement PDFs are stored in the business's own Google Drive under `drive.file` scope (the app can only see the folder it created).

## 7. Public static pages — BY DESIGN
- `wholesale.html` and `wholesale-outreach.html` (added in this update) are static marketing/outreach workspaces served without auth. They contain contact-outreach content, not financial data. If account lists inside them are considered sensitive, move them behind the app shell.

## Remediation plan
**Phase 1 — done in this update ✅**
1. Locked `/api/categorize` and `/api/drive-upload`; 2. Deleted the stray unauthenticated `/api/api/fba-shipments`; 3. Added `.gitignore` to keep secrets/artifacts out of git.

**Phase 2 — before wider team use**
1. Confirm `APP_PASSWORD` + `CRON_SECRET` set in Vercel; rotate the house password (it has been shared in chats). 2. Session token expiry (add a timestamp to the HMAC input). 3. Signed `state` on OAuth starts. 4. Move the Shopify fallback client_id to env.

**Phase 3 — before accepting customers**
1. Real per-user accounts (Supabase Auth or similar) with the roles already stored on the team roster. 2. Multi-tenant data isolation (per-company keys + server-side permission checks). 3. Route-level permission enforcement per the Security & Permissions Framework doc. 4. Move Business-Health scoring and recommendation logic server-side (IP protection).

## Answers to the original questions
1. **Is sensitive data currently exposed?** It was (three open endpoints, worst being the stray FBA copy and the open Claude proxy). All three are fixed in this update. Nothing else sensitive is publicly reachable **provided `APP_PASSWORD` is set**.
2. **Could another person access my business information?** Only by guessing the house password, or if `APP_PASSWORD` is unset. Verify it is set.
3. **Is authentication properly implemented?** Yes for a 2-person internal tool; not yet for customers (single shared credential, no expiry).
4. **Is the database secure?** Yes — server-side access only, no public read/write paths.
5. **What must be fixed before Chief accepts customers?** Phase 3 above: per-user auth, tenant isolation, server-side permissions.
