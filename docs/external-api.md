# UNBLOCKED Judging Portal — External Submission API

This API lets the submission form (link.unblocked.world, not part of this
repository) push poster entries into the judging portal. There are two ways
to use it:

- **One-shot submissions** (`POST /contests/:slug/submissions`): send a
  finished poster in one request with just an API key.
- **Artist accounts** (`/artists/*`, `/me`, `/contests/:slug/me/*`): artists
  confirm their email with a 6-digit code, save drafts as they work, come back
  any day to submit more, and can withdraw an entry before judging starts.
  See [Artist accounts and drafts](#artist-accounts-and-drafts).

- **Base URL**: `https://<your-worker-domain>` (e.g. `https://unblocked-juding-portal.<account>.workers.dev`)
- **Path prefix**: `/api/v1`
- All responses are JSON.
- This page is also published at `https://<your-worker-domain>/docs/external-api.md` — no login required, safe to share with the external platform team directly.
- Interactive API reference (Scalar): `https://<your-worker-domain>/docs/`. The OpenAPI 3 spec behind it is at `https://<your-worker-domain>/docs/openapi.yaml` — import it into Postman/Insomnia or a client generator.

## Authentication

Every write request needs an API key created by an admin in the portal's admin
console (**Admin → API Keys**). Keys look like `ubk_…`, are shown **once** at
creation, and may be scoped to a single contest or valid for all contests.

Send the key in either header:

```
Authorization: Bearer ubk_xxxxxxxx...
# or
X-Api-Key: ubk_xxxxxxxx...
```

Keys can be revoked at any time in the admin console. Store the key server-side
in the submission system — never ship it in client-side JavaScript.

## Contest lifecycle

A contest only accepts submissions while its status is `open` and, if it has
a closing date, before that date. Statuses move through:
`draft → open → round1 → round2 → deliberation → complete → archived`.
Once judging starts (`round1`), submissions are closed.

---

## `GET /api/v1/contests/:slug`

Public (no key required). Use it to render the form state ("submissions open" /
"closed").

### Response `200`

```json
{
  "slug": "ownership-2026",
  "name": "Ownership 2026",
  "theme": "Ownership",
  "description": "…",
  "acceptingSubmissions": true,
  "closesAt": "2027-01-31T23:59:00.000Z",
  "maxEntriesPerArtist": 5,
  "withdrawalsOpen": true,
  "consentVersion": "2026-11-08"
}
```

| Field | Meaning |
| ----- | ------- |
| `acceptingSubmissions` | `open` and before `closesAt` |
| `closesAt` | Closing date and time (UTC), or `null` |
| `maxEntriesPerArtist` | Active submissions allowed per artist account, or `null` |
| `withdrawalsOpen` | Artists can withdraw: `open` and judging has never started |
| `consentVersion` | Version of the submission terms; send it back when submitting |

`404` if the slug is unknown or the contest is archived.

---

## `POST /api/v1/contests/:slug/submissions`

Submit one poster entry. Requires an API key. `Content-Type: multipart/form-data`.

Provide the poster image **either** as an uploaded file (`file`) **or** as a
link to an image hosted elsewhere (`image_url`) — exactly one of the two is
required per submission.

### Form fields

| Field              | Required | Notes                                          |
| ------------------ | -------- | ---------------------------------------------- |
| `title`            | yes      | Poster title, ≤ 200 chars                      |
| `file`             | one of `file` / `image_url` | The poster file (see file rules) |
| `image_url`        | one of `file` / `image_url` | `http(s)://` link to the poster image, ≤ 2000 chars |
| `artist_name`      | no       | ≤ 200 chars                                    |
| `artist_email`     | no       | ≤ 200 chars                                    |
| `country`          | no       | ≤ 100 chars                                    |
| `concept`          | no       | Poster concept / rationale, ≤ 4000 chars       |
| `year_designed`    | no       | Stored as metadata                             |
| `designed_for`     | no       | Stored as metadata                             |
| `client_name`      | no       | Stored as metadata                             |
| `creation_method`  | no       | Stored as metadata                             |
| `materials_used`   | no       | Stored as metadata                             |
| `digital_programs` | no       | Stored as metadata                             |
| `printing_method`  | no       | Stored as metadata                             |
| `age`              | no       | Stored as metadata                             |
| `assets`           | no       | Up to 3 supporting files (repeat the field). File uploads only — not covered by `image_url`. |

### File rules (`file` / `image_url` / `assets`)

File types are detected from content (magic bytes), not the filename or any
`Content-Type` header. The same rules apply whether the bytes came from an
upload or from fetching `image_url`.

| Type          | Max size |
| ------------- | -------- |
| JPG, PNG, PDF | 5 MB     |
| GIF, MP4      | 20 MB    |

### `image_url` rules

- Must be an absolute `http://` or `https://` URL, ≤ 2000 chars, and publicly
  reachable with no auth wall (the portal's server fetches it directly).
- **The portal fetches it once, at submission time, and mirrors the bytes
  into its own storage** — exactly like an uploaded `file`. The same
  magic-byte type check and size limits above apply to the fetched content;
  an unrecognized or oversized response is rejected the same way a bad
  upload would be.
- Because the image is copied in immediately, the source URL going offline
  or changing later has no effect on the submission.
- The fetch has a 15s timeout and a 20 MB cap applied before the full body is
  read (using `Content-Length` where the response provides one).

### Responses

| Status | Body                                                        |
| ------ | ----------------------------------------------------------- |
| `201`  | `{ "id": "OWN-4F2A9C", "status": "submitted" }`             |
| `400`  | `{ "error": "title_required" \| "file_or_image_url_required" \| "provide_file_or_image_url_not_both" \| "invalid_image_url" \| "image_url_fetch_failed" \| … }` |
| `401`  | `{ "error": "invalid_api_key" }`                            |
| `409`  | `{ "error": "submissions_closed", "status": "round1" }` (not open, or past the closing date) |
| `413`  | `{ "error": "file_too_large" \| "image_too_large", "limitBytes": 5242880 }` |
| `415`  | `{ "error": "unsupported_file_type", "accepted": [...] }`   |

`image_url_fetch_failed` covers network errors, timeouts, and non-2xx
responses from the source URL (an `httpStatus` field is included when the
source did respond, just not with a success status).

Keep the returned `id` — it is the entry's public reference in the judging
portal. One-shot submissions aren't tied to an artist account until that email
address signs in; they then appear in the artist's list as read-only
(`earlierSubmissions`).

### Example — uploading a file

```bash
curl -X POST "https://<worker-domain>/api/v1/contests/ownership-2026/submissions" \
  -H "Authorization: Bearer ubk_xxxxxxxx" \
  -F "title=The Locked Garden" \
  -F "artist_name=Elena Moretti" \
  -F "artist_email=elena@example.com" \
  -F "country=Italy" \
  -F "concept=A private garden drawn as a public promise…" \
  -F "creation_method=Digital illustration" \
  -F "file=@poster.png"
```

### Example — linking an externally hosted image

```bash
curl -X POST "https://<worker-domain>/api/v1/contests/ownership-2026/submissions" \
  -H "Authorization: Bearer ubk_xxxxxxxx" \
  -F "title=The Locked Garden" \
  -F "artist_name=Elena Moretti" \
  -F "artist_email=elena@example.com" \
  -F "country=Italy" \
  -F "concept=A private garden drawn as a public promise…" \
  -F "creation_method=Digital illustration" \
  -F "image_url=https://cdn.example.com/uploads/locked-garden.jpg"
```

Both examples return the same response shape:

```json
{ "id": "OWN-4F2A9C", "status": "submitted" }
```

## Rate limiting & abuse

Put a Cloudflare WAF rate-limiting rule on `POST /api/v1/*` (e.g. 10 requests
per minute per IP) in the dashboard. Note that requests arriving through a
service binding (the links Worker) skip the portal's WAF rules, so the links
Worker limits sign-in code requests by IP itself (5 per minute) and the portal
limits each email address to 3 codes per 15 minutes. The endpoint additionally enforces
per-file size limits and rejects unknown file types — including for bytes
fetched via `image_url`, so a submission can't be used to smuggle an
oversized or unexpected file type into storage just by pointing at a URL
instead of uploading directly.

## Artist accounts and drafts

These endpoints are for a **server** that sits between the artist's browser
and the portal (on link.unblocked.world that's the links Worker). Every call
needs the API key. Calls for a signed-in artist also need
`X-Artist-Session: <session token>`. The portal only accepts that header
together with a valid key, so keep both server-side: the links Worker stores
the session in an `HttpOnly` cookie and adds the headers itself.

Full request and response shapes are in the interactive reference at `/docs/`.

### Sign-in

1. `POST /artists/codes` `{ email, contest }` → `202`. Sends one email with a
   6-digit code and, if the API key has a **sign-in link base**, a link to
   `<signin_url>/signin?t=<token>`. Both work once and expire in 15 minutes.
   A new code cancels the previous one. Same answer for new and known
   addresses. Limits: 3 per address per 15 minutes (`429 too_many_codes`,
   with `retryAfter` seconds).

   **Creating an account in one step:** also send `profile` `{ name, country,
   instagram?, bio?, acceptTerms }` (where `acceptTerms` is the contest's
   `termsVersion`) and optionally `photo` (base64 JPG/PNG/WebP under 5 MB).
   They're held with the code and saved when it's verified, by code or by
   link, in any browser. A new account gets everything; an existing account
   only gets fields that are still empty, so a code requested for someone
   else's address can't change their profile.
2. `POST /artists/sessions` with `{ email, code }` or `{ token }` → `201 { session,
   expiresAt, artist, isNew, applied }`, where `applied` lists the details
   from step 1 that were saved. Wrong code: `400 invalid_code { attemptsLeft }`;
   after 5 wrong codes `423 code_locked`; expired or used: `410 code_expired`.
   The profile is created here (not when the code is sent), and earlier
   one-shot submissions with the same email are linked to it. Sessions last
   30 days and are extended while used.
3. **Links take two steps.** Email scanners open links automatically, so the
   link page must call `GET /artists/sessions/check?token=` (doesn't use it up)
   and show a Continue button. Only the button calls `POST /artists/sessions`.
4. `DELETE /artists/session` signs out on this device.

Set the sign-in link base on the key in **Admin → API Keys** (e.g.
`https://link.unblocked.world/form/test`). Without it, emails contain the code
only.

### Profile

`GET /me` → `{ email, name, country, instagram, bio, hasPhoto, photoId,
termsVersion, termsAcceptedAt, termsAccepted, complete }`. `complete` means
name and country are filled in and the current terms are accepted.

`PATCH /me` `{ name?, country?, instagram?, bio?, acceptTerms? }`. Instagram is
stored as a bare handle (`@Name` or `instagram.com/Name/` → `name`); anything
else is `400 invalid_instagram`. Bio is cut to 1000 characters. `acceptTerms`
must equal the contest's `termsVersion` (else `400 terms_outdated`); when the
terms change, artists must agree again before submitting. The email can't
change. Profile edits don't change entries already submitted, which keep a
snapshot.

`PUT /me/photo` (raw JPG, PNG or WebP under 5 MB) replaces the profile photo;
`GET` serves it and `DELETE` removes it. `photoId` changes with each upload.
Photos are seen by staff in the admin console, not by judges.

### Entries

| Call | What it does |
| ---- | ------------ |
| `GET /contests/:slug/me/entries` | Drafts, submitted and withdrawn entries, `earlierSubmissions`, `used`, `max`, and the contest |
| `POST /contests/:slug/me/entries` `{ id, fields? }` | Start a draft. The client makes the UUID, so offline creates sync safely; a repeated id returns the existing entry |
| `PATCH …/entries/:id` `{ fields }` + `If-Match: <version>` | Save changed fields. `409 version_conflict` (with the server's `entry`) if another device saved first; `409 entry_locked` if it's no longer a draft |
| `PUT …/entries/:id/file` | Upload or replace the poster. Body = the file bytes, `X-File-Name` = URI-encoded name. Same type and size rules as above |
| `GET` / `DELETE …/entries/:id/file` | Download it (for previews) / unlink it from the draft |
| `POST …/entries/:id/assets`, `GET`/`DELETE …/assets/:assetId` | Supporting files, up to 3 |
| `POST /contests/:slug/me/submissions` `{ entryIds, consentVersion }` | Submit ready drafts (title + poster file). Per-entry `reference` or `error`. One receipt email per call |
| `POST …/entries/:id/submit` `{ consentVersion }` | Submit one draft. Submitting twice returns the same reference |
| `POST …/entries/:id/withdraw` `{ reason? }` | Withdraw. Only while `withdrawalsOpen`; otherwise `409 withdrawals_closed` |
| `POST …/entries/:id/restore` | Put a withdrawn entry back, same reference, while `acceptingSubmissions` |
| `DELETE …/entries/:id` | Remove a draft (soft delete). Submitted entries use withdraw |

Submit errors: `409 submissions_closed`, `409 consent_outdated` (with the
current `consentVersion`), `422 profile_incomplete` (name and country are
required), `422 terms_not_accepted` (with the current `termsVersion`), and per entry `entry_incomplete` (with `missing`) or
`submission_limit_reached`.

### What judges see

Only entries that are submitted, not withdrawn and not disqualified are
judged. A withdrawn entry disappears from the judge list, voting, results and
the CSV, and judges can no longer open its files. Its row, files, votes and
history are all kept. Nothing is ever deleted: removing a draft and
withdrawing an entry only set a status and a date, and the database refuses
deletes on submissions, entries and their history.

## Authentication note

The judge/admin portal uses its own magic-link sessions; `/api/v1/*` never
uses cookies — API keys (plus `X-Artist-Session` for artist calls) are the
only authentication on these routes.
