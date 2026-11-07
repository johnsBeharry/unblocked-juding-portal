# UNBLOCKED Judging Portal — External Submission API

This API lets the external submission system (the public UNBLOCKED site /
submission form) push poster entries into the judging portal. The submission
form itself is **not** part of this repository — it only needs to call these
two endpoints.

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

A contest only accepts submissions while its status is `open`. Statuses move
through: `draft → open → round1 → round2 → deliberation → complete → archived`.
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
  "acceptingSubmissions": true
}
```

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
| `409`  | `{ "error": "submissions_closed", "status": "round1" }`     |
| `413`  | `{ "error": "file_too_large" \| "image_too_large", "limitBytes": 5242880 }` |
| `415`  | `{ "error": "unsupported_file_type", "accepted": [...] }`   |

`image_url_fetch_failed` covers network errors, timeouts, and non-2xx
responses from the source URL (an `httpStatus` field is included when the
source did respond, just not with a success status).

Keep the returned `id` — it is the entry's public reference in the judging
portal (there is no public status endpoint; artists are contacted by email).

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
per minute per IP) in the dashboard. The endpoint additionally enforces
per-file size limits and rejects unknown file types — including for bytes
fetched via `image_url`, so a submission can't be used to smuggle an
oversized or unexpected file type into storage just by pointing at a URL
instead of uploading directly.

## Authentication note

The judge/admin portal uses its own magic-link sessions; `/api/v1/*` never
uses cookies or sessions — API keys are the only authentication on these
routes.
