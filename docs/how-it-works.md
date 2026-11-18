# How the UNBLOCKED portal works

A plain-language guide for the team. You don't need to read the code to use
it. For developer setup see the [README](../README.md), and for the API the
submission form uses see [external-api.md](external-api.md).

## The three parts

| Part | Where | Who uses it | What it does |
|---|---|---|---|
| **Submission form** | link.unblocked.world | Artists | Sign in with an email code, fill in a profile, upload posters, submit or withdraw them. **It is a separate project (`unblocked-links`), not in this repo.** |
| **Judge portal** | the portal's home page | Judges | Vote Yes/No in Round 1, rate posters in Round 2, see results. |
| **Admin console** | `/admin.html` | Admins and managers | Create contests, move them between stages, add judges, manage API keys, export results. |

The form doesn't store anything itself. It sends everything to this portal
through the API. So when the form shows an error, the cause is usually the
**state of a contest** in the admin console, not broken code.

## Who can do what

| Role | Can do |
|---|---|
| **Admin** | Everything, including managing users and API keys. |
| **Manager** | Contests, judging panels and moving contests between stages. Not users or API keys. |
| **Judge** | Vote and rate in the contests they were added to. Nothing else. |

## The form is tied to one contest

Every request the form sends includes the contest's short name (its
**slug**, e.g. `test-november` or `ownership-2026`). The slug is set in the
form's settings in the `unblocked-links` project.

- The form does **not** pick "whichever contest is open". If its slug points
  to a contest that isn't open, artists get an error even if another contest
  is open.
- "All contests" on an API key only means the key isn't limited to one
  contest. It doesn't decide which contest the form uses.
- **Switching the form to a different contest is a change in
  `unblocked-links`** (Edy), not in this portal.

## Contest stages

A contest moves through these stages. Admins and managers change the stage in
**Admin console → Contests → Manage**.

| Stage (admin label) | Artists (form) | Judges | Notes |
|---|---|---|---|
| **Draft** | Can't submit. | Don't see posters. | Set-up stage. |
| **Submissions Open** | Can sign in, save drafts, submit. Can withdraw only if judging has never started (see below). | Posters hidden, rounds locked. | The **only** stage where the form accepts posters. If a closing date is set, submissions stop at that date even while the stage still says Open. |
| **Round 1** | Can't submit or withdraw. | Swipe Yes/No. Artist names are hidden (blind). | Before Round 2, pick which posters advance ("preselect majority" or by hand) and save the selection. |
| **Round 2** | Can't submit or withdraw. | Rate the advanced posters on each criterion. Artist names visible. | Moving to Round 2 is refused until at least one poster has advanced. |
| **Deliberation** | Can't submit or withdraw. | See the combined finalist ranking. | |
| **Complete** | Can't submit or withdraw. | See the final results. | Export CSV any time. |
| **Archived** | The form gets "not found". | Contest disappears from the judge portal. | Contests are archived, never deleted. |

### Moving a contest back a stage

- You can move a contest to any stage, including backwards.
- **Votes and ratings are kept.** Changing the stage only changes the status.
  It doesn't delete anything.
- **Withdrawals stay closed forever once judging has started.** The first
  time a contest moves past Submissions Open, the portal remembers that
  judging started and never forgets it. If you move it back to Submissions
  Open, artists can submit again but **can't withdraw**. To test withdrawing,
  use a contest that has never been judged.

## Starting over / resetting a contest

There is no reset button, on purpose: posters and entries are never deleted.
So "resetting" means one of these:

- **New contest (cleanest):** Admin console → **New Contest**, set it up and
  move it to **Submissions Open**. Then **Edy has to point the form at the
  new contest's slug**, or it won't receive any posters. Set the old contest
  to **Archived**. This is the only way to get a contest where artists can
  withdraw again.
- **Same contest, change the stage:** move it to any stage, including
  backwards. Votes and ratings stay, and withdrawals stay closed once judging
  has started.
- **Same contest, remove posters from judging:** withdraw or disqualify
  entries from the contest's submissions list. They stay in the database but
  judges stop seeing them and their votes stop counting.
- **Change who goes to Round 2:** save a new Round 2 selection.
- **Actually wiping votes:** only a developer can do it, directly in the
  database, and it isn't recommended. Posters and entries can't be removed
  even then.

For testing, use a separate test contest (e.g. `test-december`) that the form
is pointed at, rather than resetting a contest that real judges have used.

## Artist accounts, drafts and withdrawals

- **Sign-in:** artists get a 6-digit code by email (plus a one-click link if
  the form's API key has a sign-in link set). Codes expire after 15 minutes,
  lock after 5 wrong tries, and an address can request 3 codes per
  15 minutes.
- **Profile:** name and country are required before submitting, and the
  artist has to accept the current Terms of Service and Privacy Policy.
- **Drafts:** up to 50 drafts per artist per contest. Judges never see
  drafts.
- **Files:** JPG, PNG or PDF up to 5 MB. GIF or MP4 up to 20 MB. Up to 3
  extra assets per entry. The file type is checked from the file itself, not
  its name.
- **Entries per artist:** optional limit, set with **Edit contest**.
- **Withdrawing:** artists can withdraw while the contest is in Submissions
  Open and judging has never started. After that, staff can withdraw or
  restore an entry from the admin console, with a reason.
- **Nothing is deleted.** Withdrawn or discarded entries are marked, not
  removed, so the history stays complete.

## Judges

- Inviting a judge = adding their email in the admin console. A compose
  window opens so you can check the welcome email before it sends.
- Judges sign in with a one-time email link (no password). The link lasts
  15 minutes and works once. A session lasts 30 days.
- Judges only see contests they were added to, and only the current stage.

## Launch checklist for a real contest

1. Contest exists (e.g. **Ownership**) with the right criteria, closing date
   and entries-per-artist limit (**Edit contest**).
2. Stage set to **Submissions Open**.
3. The form (`unblocked-links`) points at **this contest's slug**, not the
   test contest's.
4. The test contest is **not** left in Submissions Open.
5. Judges added to the panel and their welcome emails sent.
6. Sender address checked: emails currently come from `mail.pxpush.com`
   addresses. To send from an UNBLOCKED address, verify that domain in Resend
   and update `MAIL_FROM` / `MAIL_FROM_ARTISTS` in `wrangler.jsonc`.

When something goes wrong, see [troubleshooting.md](troubleshooting.md).
