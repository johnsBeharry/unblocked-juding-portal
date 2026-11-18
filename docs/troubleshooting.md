# Troubleshooting

What the common errors mean, what causes them and who can fix them. Error
codes are what the portal's API returns; the submission form may show its own
wording on top (see the first section). For how contests and stages work, see
[how-it-works.md](how-it-works.md).

## "Cannot find contest" / "no open contests" on the form

**This text comes from the submission form (`unblocked-links`), not from this
portal.** The portal never sends those words. They usually mean the portal
answered one of these:

| Portal error | Cause | Fix | Who |
|---|---|---|---|
| `submissions_closed` | The form's contest isn't in **Submissions Open**, or its closing date has passed. | Admin console → Contests → the contest → **Manage** → **Submissions Open**. Or move/clear the closing date with **Edit contest**. | Admin or manager |
| `not_found` | The form's slug doesn't match any contest, or that contest is **Archived**. | Point the form at the right slug, or un-archive the contest. | Edy (form) / admin |
| `invalid_api_key` | The form's API key is wrong, revoked, or limited to a different contest. | Create a new key in **Admin → API Keys** and store it in the form's settings. | Admin + Edy |

To find out which, open `https://<portal-domain>/api/v1/contests/<slug>` in a
browser (no login needed). If it shows `"acceptingSubmissions": false`, the
contest isn't open. If it shows `not_found`, the slug is wrong or the contest
is archived.

**Suggested form change (Edy):** when the portal answers
`submissions_closed`, show "Submissions are currently closed" instead of
"cannot find contest", so it doesn't look broken.

## Artist sign-in

| Error | Meaning | Fix |
|---|---|---|
| `invalid_code` | Wrong 6-digit code. | Retype it. After 5 wrong tries the code locks. |
| `code_locked` | Too many wrong tries. | Request a new code. |
| `code_expired` | Codes last 15 minutes. | Request a new code. |
| `too_many_codes` | More than 3 codes for this address in 15 minutes. | Wait 15 minutes. |
| `artist_signin_not_configured` | The `ARTIST_CODE_SECRET` secret isn't set on the portal. | Developer: `npx wrangler secret put ARTIST_CODE_SECRET`. |
| Email never arrives | Spam folder, or the sender domain isn't verified in Resend. | Check spam. Developer: verify the domain and update `MAIL_FROM_ARTISTS`. |

## Saving and submitting posters

| Error | Meaning | Fix |
|---|---|---|
| `unsupported_file_type` | Not JPG, PNG, PDF, GIF or MP4 (checked from the file itself, so renaming doesn't help). | Export in one of those formats. |
| `file_too_large` | Over 5 MB (JPG/PNG/PDF) or 20 MB (GIF/MP4). | Compress the file. |
| `too_many_assets` | More than 3 extra assets on one entry. | Remove one. |
| `too_many_drafts` | 50 drafts in this contest. | Delete old drafts. |
| `profile_incomplete` | Name or country missing. | Fill in the profile. |
| `terms_not_accepted` / `terms_outdated` / `consent_outdated` | The artist hasn't accepted the current terms (they may have changed). | The form should show the terms again to accept. |
| `submission_limit_reached` | The contest's entries-per-artist limit is used up. | Withdraw one, or raise the limit with **Edit contest**. |
| `entry_locked` | The entry is already submitted or withdrawn, so it can't be edited. | Expected. Withdraw first if the window is open. |
| `version_conflict` | The same draft was edited in two tabs. | Reload and redo the last change. |

## Withdrawing

| Error | Meaning | Fix |
|---|---|---|
| `withdrawals_closed` | Judging has started on this contest at some point, so artists can't withdraw, **even if it was moved back to Submissions Open**. | Staff can withdraw it from the admin console (with a reason). To test withdrawing, use a contest that was never judged. |

## Admin console

| Error | Meaning | Fix |
|---|---|---|
| `no_advanced_submissions` | You tried to move to Round 2 with no posters advanced. | Save a Round 2 selection first. |
| `slug_taken` | Another contest already uses that slug. | Pick another slug. |
| `forbidden` | Your role can't do this (e.g. a manager opening Users or API Keys). | Ask an admin. |
| Contest can't be deleted | By design: contests are archived, never deleted. | Set the stage to **Archived**. |
| Want to reset / start over | There's no reset button; nothing is deleted. | See [Starting over](how-it-works.md#starting-over--resetting-a-contest) in how-it-works.md. |

## Judges

| Problem | Cause | Fix |
|---|---|---|
| "Link sent" but no email | The address isn't a user in the portal (it shows "link sent" anyway, on purpose), or the email went to spam. | Check the address under Users in the admin console; check spam. |
| Sign-in link doesn't work | Links last 15 minutes and work once. | Request a new link. |
| No posters / rounds "Locked" | The contest is in Draft or Submissions Open. | Expected until it moves to Round 1. |
| Invite came from a `pxpush` address | The sender domain isn't set to an UNBLOCKED address yet. | Developer: verify the domain in Resend and update `MAIL_FROM`. |
