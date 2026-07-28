# UNBLOCKED Judge Portal

Judging portal for UNBLOCKED poster contests. Multiple contests can run over
time, each with its own judging panel, all sharing the same two-round scoring
system (Round 1 Yes/No swipe → Round 2 category star ratings → deliberation →
results).

Built entirely on Cloudflare: a Worker (Hono + TypeScript) serving the static
portal, a JSON API, a D1 database, and R2 for poster files. Poster entries
arrive from an **external submission system** (not in this repo) through the
API described in [docs/external-api.md](docs/external-api.md).

## Architecture

```
public/          Static frontend (Worker assets)
  index.html     Judge portal (portal.js)
  admin.html     Admin console for admins + contest managers (admin.js)
src/
  index.ts       Worker entry: routing, R2 file serving
  auth.ts        Session authentication, roles, CSRF guard
  email.ts       Plain-email template, minimal markdown renderer, Resend sender
  routes/
    auth.ts      Magic-link sign-in via Resend (request-link, callback, logout)
    portal.ts    Judge endpoints (votes, ratings, contest view)
    admin.ts     Contest/judge/user/API-key management, welcome emails, CSV export
    external.ts  /api/v1 submission intake (API-key auth)
  results.ts     Panel-wide score aggregation
migrations/      D1 schema
scripts/         seed-demo.sql (local demo data)
```

**Roles:** `admin` (everything, incl. users + API keys), `manager` (contests,
panels, round control), `judge` (vote + rate in assigned contests).

**Round flow is manager-controlled.** Contest status moves
`draft → open → round1 → round2 → deliberation → complete → archived`. Judges
only ever see the active stage. Round 1 is judged blind (artist identity
hidden until Round 2). Advancement to Round 2 is picked in the admin console
("preselect majority" + manual override).

## Authentication (magic links via Resend)

Sign-in is passwordless: an invited user enters their email, receives a
one-time link (15-minute expiry, single use) sent through
[Resend](https://resend.com), and gets a 30-day HttpOnly session cookie.
Tokens and sessions are stored only as SHA-256 hashes. Unknown emails get the
same "link sent" response but no email, so panel membership can't be probed.

Inviting a judge is just: add their email in the admin console. Emails in
`ADMIN_EMAILS` (wrangler.jsonc) are auto-provisioned as admins the first time
they request a link.

Adding a judge or user who hasn't been welcomed yet opens a compose modal —
subject and body are pre-filled but nothing sends until you review, optionally
edit, and click Send. Every send (and any failure) is logged to the
`invite_emails` table, so the Users and judging-panel tables show whether —
and when — each person was actually emailed, with a Resend button for anyone
who wasn't. Email bodies use a small trusted markdown subset (`**bold**`,
`[text](url)`, `- ` bullets) and render as a plain, client-agnostic email —
white background, Inter with system fallback, blue links, no branded chrome —
consistent with the sign-in email.

Setup:

1. `npx wrangler secret put RESEND_API_KEY` (already done for this worker).
2. **Verify a sending domain in Resend** and set `MAIL_FROM` in
   `wrangler.jsonc` (e.g. `"UNBLOCKED Judging <judging@peakshift.com>"`).
   Until then the default `onboarding@resend.dev` sender only delivers to the
   Resend account owner's own email — fine for testing, useless for judges.

`AUTH_MODE` is `"magic"` in production (wrangler.jsonc). Local dev uses
`.dev.vars` (gitignored) to set `AUTH_MODE=dev`, which signs you in as
`DEV_USER_EMAIL` without any email round-trip — never deploy with dev mode.

## Development

```bash
npm install
npm run migrate:local
npx wrangler d1 execute unblocked-judging --local --file scripts/seed-demo.sql  # optional demo data
npm run dev            # http://localhost:8787
```

In dev mode you are `DEV_USER_EMAIL` (an admin). To act as another user, send
an `x-dev-user: someone@example.com` header (curl) or temporarily change
`DEV_USER_EMAIL`.

## Deployment

The repo auto-deploys to the `unblocked-juding-portal` Worker via the GitHub
integration (Workers Builds picks up `wrangler.jsonc`).

Provisioned already: R2 bucket `unblocked-posters`, remote D1
(`unblocked-judging`, migrated), and the `RESEND_API_KEY` secret. For future
schema changes: `npm run migrate:remote`.

Remaining one-time steps:

1. Verify a sending domain in Resend and update `MAIL_FROM` (above).
2. Optionally add a WAF rate-limiting rule on `POST /api/v1/*` and
   `POST /api/auth/request-link`.

## Operating a contest

1. Admin console → **New Contest** (criteria default to Theme Relevance,
   Concept, Execution, Creativity).
2. Create an **API key** and hand it to the external submission form team
   with [docs/external-api.md](docs/external-api.md).
3. Set status **Submissions Open**; entries flow in via `/api/v1`.
4. Add judges to the panel (their sign-in email).
5. Status **Round 1** → judges swipe Yes/No (blind).
6. **Save Round 2 selection** (majority preselect or manual) → status
   **Round 2** → judges rate categories.
7. **Deliberation** reveals the aggregated finalist ranking to the panel;
   **Complete** publishes final results. **Export CSV** any time.

## Security notes

- All portal/API routes require an authenticated, invited user; role checks
  on every admin route; judges can only fetch files for their own contests.
- External intake: API keys stored as SHA-256 hashes, shown once; file type
  sniffed by magic bytes, size-capped; submissions only while status `open`.
- Mutations reject cross-site requests (`Sec-Fetch-Site`); all rendered
  strings are HTML-escaped; strict CSP + nosniff via `public/_headers`.

https://www.figma.com/board/49QT6xEIr4D20DAkNX3jPv/UNBLOCKED-JUDGING-SYSTEM-V1?node-id=0-1&p=f&t=RCqzfnMuIfslMDJP-0
- This figma link contains the judge and admin experience journey and platform architecture, think it will be usefull for the AI thats building it.
