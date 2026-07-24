# UNBLOCKED Judging Portal — External Submission API

This API lets the external submission system (the public UNBLOCKED site /
submission form) push poster entries into the judging portal. The submission
form itself is **not** part of this repository — it only needs to call these
two endpoints.

- **Base URL**: `https://<your-worker-domain>` (e.g. `https://unblocked-juding-portal.<account>.workers.dev`)
- **Path prefix**: `/api/v1`
- All responses are JSON.

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

### Form fields

| Field              | Required | Notes                                          |
| ------------------ | -------- | ---------------------------------------------- |
| `title`            | yes      | Poster title, ≤ 200 chars                      |
| `file`             | yes      | The poster file (see file rules)               |
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
| `assets`           | no       | Up to 3 supporting files (repeat the field)    |

### File rules

File types are detected from content (magic bytes), not the filename.

| Type          | Max size |
| ------------- | -------- |
| JPG, PNG, PDF | 5 MB     |
| GIF, MP4      | 20 MB    |

### Responses

| Status | Body                                                        |
| ------ | ----------------------------------------------------------- |
| `201`  | `{ "id": "OWN-4F2A9C", "status": "submitted" }`             |
| `400`  | `{ "error": "title_required" \| "file_required" \| … }`     |
| `401`  | `{ "error": "invalid_api_key" }`                            |
| `409`  | `{ "error": "submissions_closed", "status": "round1" }`     |
| `413`  | `{ "error": "file_too_large", "limitBytes": 5242880 }`      |
| `415`  | `{ "error": "unsupported_file_type", "accepted": [...] }`   |

Keep the returned `id` — it is the entry's public reference in the judging
portal (there is no public status endpoint; artists are contacted by email).

### Example

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

## Rate limiting & abuse

Put a Cloudflare WAF rate-limiting rule on `POST /api/v1/*` (e.g. 10 requests
per minute per IP) in the dashboard. The endpoint additionally enforces
per-file size limits and rejects unknown file types.

## Authentication note

The judge/admin portal uses its own magic-link sessions; `/api/v1/*` never
uses cookies or sessions — API keys are the only authentication on these
routes.
