# UNBLOCKED Judge Portal

Judging portal for UNBLOCKED poster contests. Multiple contests can run over
time, each with its own judging panel, all sharing the same two-round scoring
system (Round 1 Yes/No swipe → Round 2 category star ratings → deliberation →
results).

Built entirely on Cloudflare: a Worker (Hono + TypeScript) serving the static
portal, a JSON API, a D1 database, and R2 for poster files. Poster entries
arrive from the **submission form** at link.unblocked.world (the
`unblocked-links` Worker, not in this repo) through the API described in
[docs/external-api.md](docs/external-api.md). Artists confirm their email with
a code, save drafts as they go, and can come back any day to submit more.

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
    external.ts  /api/v1 one-shot submission intake (API-key auth)
    artists.ts   /api/v1 artist sign-in, profile, drafts, submit/withdraw
  contest.ts     Open/closed/withdrawal rules, consent version
  events.ts      Append-only entry history (entry_events)
  files.ts       File type sniffing and size limits
  results.ts     Panel-wide score aggregation
migrations/      D1 schema
scripts/         check-judging-pool.mjs (npm run check)
docs/            external-api.md + openapi.yaml (served at /docs/)
```

**Roles:** `admin` (everything, incl. users + API keys), `manager` (contests,
panels, round control), `judge` (vote + rate in assigned contests).

**Round flow is manager-controlled.** Contest status moves
`draft → open → round1 → round2 → deliberation → complete → archived`. Judges
only ever see the active stage. Round 1 is judged blind (artist identity
hidden until Round 2). Advancement to Round 2 is picked in the admin console
("preselect majority" + manual override).

## Artist accounts, drafts and withdrawals

- **Sign-in:** artists get a 6-digit code (and, if the form's API key has a
  sign-in link base, a one-click link) by email through Resend. Codes are
  stored as HMACs with `ARTIST_CODE_SECRET`, expire in 15 minutes, lock after
  5 wrong tries, and are limited to 3 per address per 15 minutes. Links use
  the same two-step confirm as judge links, so mail scanners can't use them up.
  Sessions last 30 days. Artist tables and sessions are separate from judges.
- **Account:** created from the form's first step. The details typed there
  (name, country, Instagram, bio, photo, agreement to the Terms of Service and
  Privacy Policy) travel with the code request and are saved when the email
  is verified, by code or by link, in any browser. Existing accounts only get
  empty fields filled, so a code requested for someone else's address can't
  change their profile. `TERMS_VERSION` in `src/contest.ts` is the version
  agreed to; bump it to make everyone agree again before submitting.
- **Profile:** email, name, country, Instagram, bio (optional) and a photo
  (optional, `artists/<id>/` in R2, staff only). Submissions copy name,
  country and Instagram at the moment they're sent, so later edits don't
  change what judges saw. Staff see the bio and photo under each entry.
- **Drafts** live in `entries`, never in `submissions`. Files upload to
  `drafts/contest-<id>/<entry>/` in R2 (judges can't reach that path) and are
  copied to `contest-<id>/<public-id>.<ext>` on submit.
- **What gets judged:** every judge-facing query reads the `judging_pool`
  view (submitted, not withdrawn, not disqualified). `npm run check` fails if
  judge code reads `submissions` directly.
- **Nothing is deleted.** Withdrawing sets `withdrawn_at`; removing a draft
  sets `status = 'discarded'`. Database triggers refuse `DELETE` on
  `submissions` and `entries`, and any change to `entry_events`, the history
  used for statistics. Votes on a withdrawn entry stay in the database but
  stop counting.
- **Withdrawal window:** artists can withdraw while the contest is open and
  judging has never started (`judging_started_at`, set the first time the
  contest moves past Open and never cleared). After that, staff can withdraw
  or restore from the admin console, with a reason.

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
   For artist sign-in also run `npx wrangler secret put ARTIST_CODE_SECRET`
   with a random value (e.g. `openssl rand -hex 32`). Without it, artist
   sign-in returns `artist_signin_not_configured`. Artist emails are sent from
   `MAIL_FROM_ARTISTS` (`UNBLOCKED <submissions@mail.pxpush.com>`).
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

For artist sign-in locally, add to `.dev.vars`:

```
ARTIST_CODE_SECRET=<any random string>
ARTIST_EMAIL_MODE=log   # print artist emails (with the code) to the console instead of sending
```

Run `npm run check` before pushing: it type-checks and makes sure judge-facing
code only reads the `judging_pool` view.

## Deployment

The repo auto-deploys to the `unblocked-juding-portal` Worker via the GitHub
integration (Workers Builds picks up `wrangler.jsonc`).

Provisioned already: R2 bucket `unblocked-posters`, remote D1
(`unblocked-judging`, migrated), and the `RESEND_API_KEY` secret.

**Every push deploys**, so for schema changes run `npm run migrate:remote`
*before* pushing code that uses the new tables or columns. Migrations only
add tables and columns; never rebuild `submissions` (dropping it would
cascade-delete every vote and rating, and the no-delete trigger blocks it).

Remaining one-time steps:

1. Verify a sending domain in Resend and update `MAIL_FROM` (above).
2. Optionally add a WAF rate-limiting rule on `POST /api/v1/*` and
   `POST /api/auth/request-link`. Traffic from the links Worker arrives over a
   service binding and skips these rules; the links Worker limits sign-in code
   requests itself.

## Operating a contest

1. Admin console → **New Contest** (criteria default to Theme Relevance,
   Concept, Execution, Creativity).
2. Create an **API key** with the form's **sign-in link base** (e.g.
   `https://link.unblocked.world/form/test`) and store it as a secret in the
   links Worker. See [docs/external-api.md](docs/external-api.md).
3. **Edit contest** to set an optional closing date and entries-per-artist
   limit, then set status **Submissions Open**. Artists sign in, save drafts
   and submit via `/api/v1`. The contest list shows submissions, drafts in
   progress and withdrawals.
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
  sniffed by magic bytes, size-capped; submissions only while status `open`
  and before the closing date.
- Artist sessions are only accepted with a valid API key; artist codes are
  HMAC'd, link tokens and sessions SHA-256 hashed. Sign-in link bases come
  from the API key's settings, never from a request.
- Judges only ever read the `judging_pool` view and can only open files that
  belong to entries in it.
- Mutations reject cross-site requests (`Sec-Fetch-Site`); all rendered
  strings are HTML-escaped; strict CSP + nosniff via `public/_headers`.

https://www.figma.com/board/49QT6xEIr4D20DAkNX3jPv/UNBLOCKED-JUDGING-SYSTEM-V1?node-id=0-1&p=f&t=RCqzfnMuIfslMDJP-0
- This figma link contains the judge and admin experience journey and platform architecture, think it will be usefull for the AI thats building it.
