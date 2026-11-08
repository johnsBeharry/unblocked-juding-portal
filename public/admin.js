/* UNBLOCKED Admin Console — contest, judge, and API-key management.
   All dynamic strings are escaped with esc() before hitting markup. */

const state = {
  me: null,
  contests: [],
  view: "contests",       // contests | contest | users | keys
  contestDetail: null,
  users: [],
  keys: [],
  newKey: null,           // raw key shown once after creation
  notice: null,
  compose: null,          // { userId, userEmail, subject, body, mode, sending }
  activeDrawer: null,     // "new-contest" | "edit-contest" | "add-judge" | "add-user" | "create-key" | "edit-key" | "reason" | "history" | null
  submissionFilter: "active", // active | withdrawn | disqualified | all
  reasonAction: null,     // { kind: "disqualify" | "withdraw", subId, title }
  history: null,          // { title, publicId, events: [] }
  editKey: null,          // key row being edited
  confirmAction: null,    // { heading, message, confirmLabel, action } | null
};

const app = document.querySelector("[data-app]");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body ? { "content-type": "application/json" } : {},
    credentials: "same-origin",
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, body };
}

function gate(kicker, title, text) {
  app.innerHTML = `
    <section class="o-portal-gate">
      <article class="t-gate-panel">
        <span class="a-section-tag">${esc(kicker)}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
      </article>
    </section>`;
}

function loginGate(message) {
  app.innerHTML = `
    <section class="o-portal-gate">
      <article class="t-gate-panel login-card">
        <span class="a-section-tag">Sign in</span>
        <h2>UNBLOCKED Admin</h2>
        <p>${esc(message || "Enter your email and we'll send you a one-time sign-in link.")}</p>
        <form class="o-login-form" data-login-form>
          <input class="a-input-text" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
          <button class="a-action-trigger a-action-trigger--primary" type="submit">Email me a sign-in link</button>
        </form>
      </article>
    </section>`;
}

/* ---------- confirm modal (replaces window.confirm) ---------- */

function askConfirm({ heading, message, confirmLabel, action }) {
  state.confirmAction = { heading, message, confirmLabel, action };
  render();
}

function confirmModalMarkup() {
  if (!state.confirmAction) return "";
  const { heading, message, confirmLabel } = state.confirmAction;
  return `<ub-warning-modal heading="${esc(heading)}" message="${esc(message)}"
    ${confirmLabel ? `confirm-label="${esc(confirmLabel)}"` : ""}></ub-warning-modal>`;
}

document.addEventListener("ub-confirm", () => {
  const pending = state.confirmAction;
  state.confirmAction = null;
  pending?.action();
});

document.addEventListener("ub-cancel", () => {
  state.confirmAction = null;
  render();
});

/* ---------- drawers ---------- */

function drawerMarkup() {
  switch (state.activeDrawer) {
    case "new-contest": return newContestDrawerMarkup();
    case "add-judge": return addJudgeDrawerMarkup();
    case "add-user": return addUserDrawerMarkup();
    case "create-key": return createKeyDrawerMarkup();
    case "edit-key": return editKeyDrawerMarkup();
    case "edit-contest": return editContestDrawerMarkup();
    case "reason": return reasonDrawerMarkup();
    case "history": return historyDrawerMarkup();
    default: return "";
  }
}

document.addEventListener("ub-drawer-close", () => {
  state.activeDrawer = null;
  render();
});

/* ---------- welcome-email compose modal ---------- */

function renderMarkdownPreview(source) {
  const inlineMd = (text) => {
    let out = esc(text);
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      '<a href="$2">$1</a>',
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/==([^=]+)==/g, "<mark>$1</mark>");
    return out;
  };
  const blocks = source.trim().split(/\n\s*\n/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => l.startsWith("- "))) {
      const items = lines.map((l) => `<li>${inlineMd(l.slice(2))}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${lines.map(inlineMd).join("<br>")}</p>`;
  }).join("");
}

function judgeInviteDraft(user, contestName) {
  const name = user.name || user.email.split("@")[0];
  return {
    subject: `Judging ${contestName}`,
    body: `Hey ${name},\n\nYou're in — you've been added as a judge for **${contestName}** on the UNBLOCKED judging portal.\n\n→ [Head to the judge portal](${window.location.origin}/) and ==enter ${user.email}==. You'll get a one-time sign-in link, no password needed.\n\nCreatives have put real work into these. Take your time with them.\n\nThanks for judging.`,
  };
}

function accountInviteDraft(user) {
  const name = user.name || user.email.split("@")[0];
  const roleLabel = user.role === "admin" ? "an administrator" : user.role === "manager" ? "a contest manager" : "a judge";
  return {
    subject: "You're in",
    body: `Hey ${name},\n\nYou've been added as ${roleLabel} on the UNBLOCKED judging admin console.\n\n→ [Head to the admin console](${window.location.origin}/admin.html) and ==enter ${user.email}==. You'll get a one-time sign-in link, no password needed.`,
  };
}

function openCompose(user, draft) {
  state.compose = {
    userId: user.id,
    userEmail: user.email,
    subject: draft.subject,
    body: draft.body,
    mode: "edit",
    sending: false,
  };
  render();
}

function syncComposeFromDom() {
  if (!state.compose) return;
  const subjectInput = document.querySelector("[data-compose-subject]");
  const bodyInput = document.querySelector("[data-compose-body]");
  if (subjectInput) state.compose.subject = subjectInput.value;
  if (bodyInput) state.compose.body = bodyInput.value;
}

function composeModalMarkup() {
  const cm = state.compose;
  if (!cm) return "";
  return `
    <div class="o-overlay-backdrop o-overlay-backdrop--fade-in" data-compose-backdrop></div>
    <article class="t-modal-panel" role="dialog" aria-modal="true" aria-labelledby="compose-title">
      <span class="a-section-tag">Welcome email</span>
      <h2 id="compose-title">Send to ${esc(cm.userEmail)}</h2>
      <p>Nothing sends until you click Send — edit as needed first.</p>

      <label class="m-form-field">Subject
        <input class="a-input-text" type="text" data-compose-subject value="${esc(cm.subject)}" maxlength="200">
      </label>

      <div class="o-compose-tabs">
        <button type="button" class="${cm.mode === "edit" ? "is-active" : ""}" data-compose-mode="edit">Edit</button>
        <button type="button" class="${cm.mode === "preview" ? "is-active" : ""}" data-compose-mode="preview">Preview</button>
      </div>

      ${cm.mode === "edit"
        ? `<textarea class="a-input-textarea" data-compose-body rows="10" maxlength="5000">${esc(cm.body)}</textarea>
           <p class="a-workflow-note">Basic markdown: **bold**, ==highlight== (use sparingly), [link text](https://…), and "- " bullet lists.</p>`
        : `<div class="o-compose-preview">
             <div class="o-compose-preview-frame">
               ${renderMarkdownPreview(cm.body)}
               <p>Bests,<br>Johns</p>
             </div>
           </div>`}

      <div class="o-compose-form-actions">
        <button class="a-action-trigger a-action-trigger--dim" type="button" data-compose-skip ${cm.sending ? "disabled" : ""}>Skip for now</button>
        <button class="a-action-trigger a-action-trigger--primary" type="button" data-compose-send ${cm.sending ? "disabled" : ""}>${cm.sending ? "Sending…" : "Send email"}</button>
      </div>
    </article>`;
}

const STATUS_FLOW = ["draft", "open", "round1", "round2", "deliberation", "complete", "archived"];
const STATUS_LABELS = {
  draft: "Draft",
  open: "Submissions Open",
  round1: "Round 1",
  round2: "Round 2",
  deliberation: "Deliberation",
  complete: "Complete",
  archived: "Archived",
};

const isAdmin = () => state.me.user.role === "admin";

/* ---------- sidebar ---------- */

function sidebarMarkup() {
  const user = state.me.user;
  const initials = (user.name || user.email)
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join("");

  const navItem = (view, label) => {
    const active = state.view === view || (view === "contests" && state.view === "contest");
    return `<ub-nav-link view="${view}" label="${esc(label)}" ${active ? "active" : ""}></ub-nav-link>`;
  };

  return `
    <aside class="o-nav-sidebar" aria-label="Admin navigation">
      <div class="m-profile-card">
        <span class="m-profile-card__mark">${esc(initials || "A")}</span>
        <div>
          <strong class="m-profile-card__name">${esc(user.name || user.email)}</strong>
          <span class="m-profile-card__role">${esc(user.role === "admin" ? "Administrator" : "Contest Manager")}</span>
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-logout>Sign out</button>
        </div>
      </div>
      <nav class="o-portal-nav">
        ${navItem("contests", "Contests")}
        ${isAdmin() ? navItem("users", "Users") : ""}
        ${isAdmin() ? navItem("keys", "API Keys") : ""}
      </nav>
      <section class="o-sidebar-list">
        <span class="a-section-tag">Lifecycle</span>
        <ul>
          <li>Draft → set up contest</li>
          <li>Open → collect submissions</li>
          <li>Round 1 → Yes/No swipe</li>
          <li>Round 2 → star ratings</li>
          <li>Deliberation → Complete</li>
        </ul>
      </section>
    </aside>`;
}

/* ---------- contests list ---------- */

function newContestDrawerMarkup() {
  return `
    <ub-drawer heading="New Contest">
      <form data-create-contest>
        <label class="m-form-field">Name <input class="a-input-text" name="name" required maxlength="120" placeholder="Ownership 2026"></label>
        <label class="m-form-field">Theme <input class="a-input-text" name="theme" maxlength="120" placeholder="Ownership"></label>
        <label class="m-form-field is-wide">Description <textarea class="a-input-textarea" name="description" rows="3" maxlength="1000"></textarea></label>
        <label class="m-form-field is-wide">Criteria (comma-separated)
          <input class="a-input-text" name="criteria" value="Theme Relevance, Concept, Execution, Creativity">
        </label>
        <button class="a-action-trigger a-action-trigger--primary" type="submit">(+) Create Contest</button>
      </form>
    </ub-drawer>`;
}

function contestsMarkup() {
  return `
    <section class="portal-view is-active">
      <div class="t-page-heading">
        <p class="a-section-tag">Admin Console</p>
        <h1>Contests</h1>
        <p>Each contest runs its own judging panel with the shared scoring system.</p>
      </div>

      <div class="o-contest-list">
        ${state.contests.map((ct) => `
          <article class="m-contest-row">
            <div>
              <span class="a-section-tag">${esc(STATUS_LABELS[ct.status] || ct.status)}</span>
              <strong>${esc(ct.name)}</strong>
              <p class="m-contest-row__meta">${ct.submission_count} submission${ct.submission_count === 1 ? "" : "s"}${ct.draft_count ? ` · ${ct.draft_count} draft${ct.draft_count === 1 ? "" : "s"} in progress` : ""}${ct.withdrawn_count ? ` · ${ct.withdrawn_count} withdrawn` : ""} · ${ct.judge_count} judge${ct.judge_count === 1 ? "" : "s"} · <code>${esc(ct.slug)}</code></p>
            </div>
            <button class="a-action-trigger" type="button" data-open-contest="${ct.id}">(Manage)</button>
          </article>`).join("") || `<p class="a-workflow-note">No contests yet — create the first one below.</p>`}
      </div>

      <button class="a-action-trigger" type="button" data-open-drawer="new-contest">(+) New Contest</button>
    </section>`;
}

/* ---------- contest detail ---------- */

function stageNavInteractiveMarkup(ct) {
  return `
    <nav class="o-stage-nav" aria-label="Contest stage">
      ${STATUS_FLOW.map((status) => `<button type="button"
        class="o-stage-nav__item o-stage-nav__item--clickable${ct.status === status ? " o-stage-nav__item--active" : ""}"
        data-set-status="${status}" ${ct.status === status ? "disabled" : ""}>${esc(STATUS_LABELS[status])}</button>`).join("")}
    </nav>`;
}

function addJudgeDrawerMarkup() {
  return `
    <ub-drawer heading="Add Judge to Panel">
      <form data-add-judge>
        <label class="m-form-field">Email <input class="a-input-text" name="email" type="email" required placeholder="judge@example.com"></label>
        <label class="m-form-field">Name <input class="a-input-text" name="name" maxlength="120" placeholder="Optional"></label>
        <button class="a-action-trigger a-action-trigger--primary" type="submit">(+) Add Judge to Panel</button>
      </form>
      <p class="a-workflow-note">Judges sign in with this email via a one-time emailed link — no password setup needed. Adding a judge prompts a welcome email you can edit before sending.</p>
    </ub-drawer>`;
}

function contestDetailMarkup() {
  const d = state.contestDetail;
  const ct = d.contest;
  const majority = Math.floor(d.judges.length / 2) + 1;

  const filters = {
    active: (sub) => !sub.withdrawn_at && sub.status === "submitted",
    withdrawn: (sub) => Boolean(sub.withdrawn_at),
    disqualified: (sub) => !sub.withdrawn_at && sub.status === "disqualified",
    all: () => true,
  };
  const visible = d.submissions.filter(filters[state.submissionFilter] || filters.active);
  const counts = d.counts || { active: 0, withdrawn: 0, disqualified: 0, drafts: 0 };
  const filterTab = (key, label, n) => `<button type="button"
    class="a-action-trigger${state.submissionFilter === key ? "" : " a-action-trigger--dim"}"
    data-submission-filter="${key}" aria-pressed="${state.submissionFilter === key}">${esc(label)} (${n})</button>`;

  const submissionRows = visible.map((sub) => {
    const thumb = sub.fileUrl && (sub.file_type || "").startsWith("image/")
      ? `<img src="${esc(sub.fileUrl)}" alt="" loading="lazy">`
      : `<span class="a-thumb-fallback">${esc((sub.file_type || "—").split("/")[1] || "—")}</span>`;
    const withdrawn = Boolean(sub.withdrawn_at);
    const inPool = !withdrawn && sub.status === "submitted";
    const rowClass = withdrawn ? "is-withdrawn" : sub.status === "disqualified" ? "is-disqualified" : "";
    const contact = [sub.artist_email, sub.instagram ? `@${sub.instagram}` : ""].filter(Boolean).join(" · ");
    const badge = withdrawn
      ? `<br><span class="a-status-chip">Withdrawn ${esc(formatDateTime(sqlTime(sub.withdrawn_at)))}${sub.withdrawn_by === "admin" ? " by staff" : ""}${sub.withdrawn_reason ? ` · ${esc(sub.withdrawn_reason)}` : ""}</span>`
      : sub.status === "disqualified" ? `<br><span class="a-status-chip">Disqualified</span>` : "";
    return `
      <tr class="${rowClass}">
        <td class="cell-thumb">${sub.fileUrl ? `<a href="${esc(sub.fileUrl)}" target="_blank" rel="noopener">${thumb}</a>` : thumb}</td>
        <td><strong>${esc(sub.title)}</strong><br><small>${esc(sub.public_id)} · ${esc([sub.artist_name, sub.country].filter(Boolean).join(", ") || "anonymous")}</small>
          ${contact ? `<br><small>${esc(contact)}</small>` : ""}
          ${sub.artist_bio || sub.artistPhotoUrl ? `<details class="a-artist"><summary><small>Artist profile</small></summary>
            ${sub.artistPhotoUrl ? `<img class="a-artist-photo" src="${esc(sub.artistPhotoUrl)}" alt="" loading="lazy">` : ""}
            ${sub.artist_bio ? `<p><small>${esc(sub.artist_bio)}</small></p>` : ""}</details>` : ""}${badge}</td>
        <td>${sub.yes_votes} yes / ${sub.no_votes} no</td>
        <td>${sub.ratings_count}</td>
        <td><label class="a-check-label"><input type="checkbox" data-advance-check value="${sub.id}" ${sub.advanced && inPool ? "checked" : ""} ${inPool ? "" : "disabled"}> R2</label></td>
        <td class="cell-actions">
          ${withdrawn ? "" : `<button class="a-action-trigger a-action-trigger--dim" type="button" data-toggle-dq="${sub.id}" data-current="${sub.status}">
            ${sub.status === "disqualified" ? "Reinstate" : "Disqualify"}</button>`}
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-${withdrawn ? "restore-sub" : "withdraw-sub"}="${sub.id}">${withdrawn ? "Restore" : "Withdraw"}</button>
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-history="${sub.id}">History</button>
        </td>
      </tr>`;
  }).join("");

  const resultRows = (d.results || []).filter((r) => r.average !== null).map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(r.title)}</strong><br><small>${esc([r.artistName, r.country].filter(Boolean).join(", ") || r.publicId)}</small></td>
      <td>${r.average.toFixed(2)}</td>
      <td>${r.judgesRated}</td>
    </tr>`).join("");

  return `
    <section class="portal-view is-active">
      <div class="o-review-header">
        <div>
          <p class="a-section-tag">Contest</p>
          <h1>${esc(ct.name)}</h1>
        </div>
        <div class="m-review-nav">
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-admin-view="contests">Back to contests</button>
          <a class="a-action-trigger" href="/api/admin/contests/${ct.id}/export.csv">Export CSV</a>
        </div>
      </div>

      <section class="o-section">
        <h2>Status</h2>
        <p>Slug <code>${esc(ct.slug)}</code>. Artists sign in and save drafts through <code>/api/v1/artists/*</code> and <code>/api/v1/contests/${esc(ct.slug)}/me/*</code>; other clients can still post to <code>/api/v1/contests/${esc(ct.slug)}/submissions</code>. See the <a href="/docs/" target="_blank" rel="noopener">API reference</a>.</p>
        <p>${ct.closes_at ? `Closes <strong>${esc(formatDateTime(ct.closes_at))}</strong>` : "No closing date"} · ${ct.max_entries_per_artist ? `Up to <strong>${ct.max_entries_per_artist}</strong> entries per artist` : "No entry limit"}${ct.judging_started_at ? ` · Judging started ${esc(formatDateTime(ct.judging_started_at))} (artist withdrawals closed)` : ""}
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-open-drawer="edit-contest">Edit contest</button></p>
        ${stageNavInteractiveMarkup(ct)}
        <p class="a-workflow-note">Moving to Round 2 requires at least one advanced submission. Judges only ever see the active stage, and only entries that are submitted, not withdrawn and not disqualified.</p>
      </section>

      <section class="o-section">
        <h2>Judging Panel (${d.judges.length})</h2>
        <div class="o-table-scroll">
          <table class="o-data-table">
            <thead><tr><th>Judge</th><th>Round 1</th><th>Round 2</th><th>Welcome email</th><th></th></tr></thead>
            <tbody>
              ${d.judges.map((j) => `
                <tr>
                  <td><strong>${esc(j.name || j.email)}</strong><br><small>${esc(j.email)}</small></td>
                  <td>${j.round1_votes} votes</td>
                  <td>${j.round2_ratings} rated</td>
                  <td>
                    ${j.invite_sent_at ? `<span class="a-status-chip">Sent ${esc(j.invite_sent_at)}</span><br>` : ""}
                    ${j.opted_out_at
                      ? `<span class="a-status-chip">Unsubscribed</span>`
                      : `<button class="a-action-trigger a-action-trigger--dim" type="button" data-send-judge-invite="${j.id}">${j.invite_sent_at ? "Resend" : "Send invite"}</button>`}
                  </td>
                  <td><button class="a-action-trigger a-action-trigger--danger" type="button" data-remove-judge="${j.id}">Remove</button></td>
                </tr>`).join("") || `<tr><td colspan="5">No judges on the panel yet.</td></tr>`}
            </tbody>
          </table>
        </div>
        <button class="a-action-trigger" type="button" data-open-drawer="add-judge">(+) Add Judge to Panel</button>
      </section>

      <section class="o-section">
        <h2>Submissions (${counts.active} active${counts.withdrawn ? ` · ${counts.withdrawn} withdrawn` : ""}${counts.disqualified ? ` · ${counts.disqualified} disqualified` : ""}${counts.drafts ? ` · ${counts.drafts} draft${counts.drafts === 1 ? "" : "s"} in progress` : ""})</h2>
        <div class="m-filter-tabs" role="group" aria-label="Filter submissions">
          ${filterTab("active", "Active", counts.active)}
          ${filterTab("withdrawn", "Withdrawn", counts.withdrawn)}
          ${filterTab("disqualified", "Disqualified", counts.disqualified)}
          ${filterTab("all", "All", d.submissions.length)}
        </div>
        <div class="o-table-scroll">
          <table class="o-data-table">
            <thead><tr><th></th><th>Entry</th><th>Round 1 votes</th><th>Ratings</th><th>Advance</th><th></th></tr></thead>
            <tbody>${submissionRows || `<tr><td colspan="6">${d.submissions.length ? "Nothing in this filter." : "No submissions yet. Entries arrive from the submission form."}</td></tr>`}</tbody>
          </table>
        </div>
        <div class="o-compose-form-actions">
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-preselect-majority>Preselect majority (≥ ${majority} yes)</button>
          <button class="a-action-trigger a-action-trigger--primary" type="button" data-save-advance>Save Round 2 selection</button>
        </div>
      </section>

      <section class="o-section">
        <h2>Results</h2>
        <div class="o-table-scroll">
          <table class="o-data-table">
            <thead><tr><th>#</th><th>Entry</th><th>Average</th><th>Judges</th></tr></thead>
            <tbody>${resultRows || `<tr><td colspan="4">No Round 2 ratings yet.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </section>`;
}

/** SQLite datetime('now') text ("2026-11-08 14:02:11", UTC) → ISO. */
function sqlTime(value) {
  return /^\d{4}-\d\d-\d\d \d/.test(value || "") ? value.replace(" ", "T") + "Z" : value;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** ISO (UTC) → value for <input type="datetime-local"> in the viewer's time zone. */
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function editContestDrawerMarkup() {
  const ct = state.contestDetail?.contest;
  if (!ct) return "";
  return `
    <ub-drawer heading="Edit Contest">
      <form data-edit-contest>
        <label class="m-form-field">Name <input class="a-input-text" name="name" required maxlength="120" value="${esc(ct.name)}"></label>
        <label class="m-form-field">Theme <input class="a-input-text" name="theme" maxlength="120" value="${esc(ct.theme)}"></label>
        <label class="m-form-field is-wide">Description <textarea class="a-input-textarea" name="description" rows="3" maxlength="1000">${esc(ct.description)}</textarea></label>
        <label class="m-form-field">Closing date (your time zone)
          <input class="a-input-text" type="datetime-local" name="closesAt" value="${esc(toLocalInput(ct.closes_at))}">
        </label>
        <label class="m-form-field">Max entries per artist
          <input class="a-input-text" type="number" name="maxEntriesPerArtist" min="1" max="100" placeholder="No limit" value="${ct.max_entries_per_artist ?? ""}">
        </label>
        <button class="a-action-trigger a-action-trigger--primary" type="submit">Save contest</button>
      </form>
      <p class="a-workflow-note">Leave the closing date empty to keep submissions open until you move the contest to Round 1. The form shows the closing date to artists.</p>
    </ub-drawer>`;
}

function reasonDrawerMarkup() {
  const ra = state.reasonAction;
  if (!ra) return "";
  const copy = ra.kind === "withdraw"
    ? { heading: "Withdraw Entry", note: "It leaves judging at once. Its votes and ratings stay in the database for the record but stop counting. You can restore it later.", button: "Withdraw entry" }
    : { heading: "Disqualify Entry", note: "It's excluded from Round 1/Round 2 selection and results until reinstated.", button: "Disqualify entry" };
  return `
    <ub-drawer heading="${esc(copy.heading)}">
      <form data-reason-form>
        <p><strong>${esc(ra.title)}</strong></p>
        <label class="m-form-field is-wide">Reason (optional, kept in the entry's history)
          <textarea class="a-input-textarea" name="reason" rows="3" maxlength="500"></textarea>
        </label>
        <button class="a-action-trigger a-action-trigger--primary" type="submit">${esc(copy.button)}</button>
      </form>
      <p class="a-workflow-note">${esc(copy.note)}</p>
    </ub-drawer>`;
}

const EVENT_LABELS = {
  created: "Draft started",
  file_added: "File added",
  file_replaced: "Poster file replaced",
  file_removed: "File removed",
  submitted: "Submitted",
  withdrawn: "Withdrawn",
  restored: "Restored",
  discarded: "Draft removed",
  disqualified: "Disqualified",
  requalified: "Reinstated",
  advanced: "Advanced to Round 2",
  unadvanced: "Removed from Round 2",
};

function historyDrawerMarkup() {
  const h = state.history;
  if (!h) return "";
  const rows = h.events.map((ev) => {
    const who = ev.actor === "admin" ? (ev.actor_email || "staff") : ev.actor;
    const detail = ev.detail?.asset ? " (supporting file)" : ev.detail?.name ? ` (${ev.detail.name})` : "";
    return `<tr>
      <td>${esc(formatDateTime(sqlTime(ev.created_at)))}</td>
      <td>${esc((EVENT_LABELS[ev.type] || ev.type) + detail)}${ev.reason ? `<br><small>${esc(ev.reason)}</small>` : ""}</td>
      <td>${esc(who)}</td>
    </tr>`;
  }).join("");
  return `
    <ub-drawer heading="History · ${esc(h.publicId)}">
      <p><strong>${esc(h.title)}</strong></p>
      <div class="o-table-scroll">
        <table class="o-data-table">
          <thead><tr><th>When</th><th>What</th><th>Who</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3">No history recorded. Entries sent before artist accounts existed have no history.</td></tr>`}</tbody>
        </table>
      </div>
    </ub-drawer>`;
}

/* ---------- users + keys ---------- */

function addUserDrawerMarkup() {
  return `
    <ub-drawer heading="Add User">
      <form data-add-user>
        <label class="m-form-field">Email <input class="a-input-text" name="email" type="email" required></label>
        <label class="m-form-field">Name <input class="a-input-text" name="name" maxlength="120"></label>
        <label class="m-form-field">Role
          <select class="a-input-select" name="role">
            <option value="judge">Judge</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button class="a-action-trigger a-action-trigger--primary" type="submit">(+) Add / Update User</button>
      </form>
    </ub-drawer>`;
}

function usersMarkup() {
  return `
    <section class="portal-view is-active">
      <div class="t-page-heading">
        <p class="a-section-tag">Admin Console</p>
        <h1>Users</h1>
        <p>Anyone signing in must exist here (or be listed in ADMIN_EMAILS) to receive a sign-in link.</p>
      </div>
      <section class="o-section">
        <div class="o-table-scroll">
          <table class="o-data-table">
            <thead><tr><th>User</th><th>Role</th><th>Last seen</th><th>Welcome email</th></tr></thead>
            <tbody>
              ${state.users.map((u) => `
                <tr>
                  <td><strong>${esc(u.name || u.email)}</strong><br><small>${esc(u.email)}</small></td>
                  <td>${esc(u.role)}</td>
                  <td>${esc(u.last_seen_at || "never")}</td>
                  <td>
                    ${u.invite_sent_at ? `<span class="a-status-chip">Sent ${esc(u.invite_sent_at)}</span><br>` : ""}
                    ${u.opted_out_at
                      ? `<span class="a-status-chip">Unsubscribed</span>`
                      : `<button class="a-action-trigger a-action-trigger--dim" type="button" data-send-invite="${u.id}">${u.invite_sent_at ? "Resend" : "Send invite"}</button>`}
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <button class="a-action-trigger" type="button" data-open-drawer="add-user">(+) Add User</button>
      </section>
    </section>`;
}

function createKeyDrawerMarkup() {
  return `
    <ub-drawer heading="Create API Key">
      <form data-create-key>
        <label class="m-form-field">Name <input class="a-input-text" name="name" required maxlength="120" placeholder="External submission form"></label>
        <label class="m-form-field">Contest scope
          <select class="a-input-select" name="contestId">
            <option value="">All contests</option>
            ${state.contests.map((ct) => `<option value="${ct.id}">${esc(ct.name)}</option>`).join("")}
          </select>
        </label>
        <label class="m-form-field is-wide">Sign-in link base (optional)
          <input class="a-input-text" name="signinUrl" type="url" placeholder="https://link.unblocked.world/form/test">
        </label>
        <button class="a-action-trigger a-action-trigger--primary" type="submit">(+) Create Key</button>
      </form>
      <p class="a-workflow-note">The sign-in link base is the form's address. Artist sign-in emails link to it (…/signin) and receipts link back to it. Without it, artists get a code only.</p>
    </ub-drawer>`;
}

function editKeyDrawerMarkup() {
  const k = state.editKey;
  if (!k) return "";
  return `
    <ub-drawer heading="Edit API Key">
      <form data-edit-key-form>
        <p><strong>${esc(k.name)}</strong> · ${esc(k.contest_slug || "All contests")}</p>
        <label class="m-form-field is-wide">Sign-in link base
          <input class="a-input-text" name="signinUrl" type="url" value="${esc(k.signin_url || "")}" placeholder="https://link.unblocked.world/form/test">
        </label>
        <button class="a-action-trigger a-action-trigger--primary" type="submit">Save</button>
      </form>
      <p class="a-workflow-note">Leave empty to send code-only sign-in emails.</p>
    </ub-drawer>`;
}

function keysMarkup() {
  return `
    <section class="portal-view is-active">
      <div class="t-page-heading">
        <p class="a-section-tag">Admin Console</p>
        <h1>API Keys</h1>
        <p>Keys authenticate the external submission system. See docs/external-api.md in the repo.</p>
      </div>

      ${state.newKey ? `
      <section class="o-section">
        <h2>Copy this key now</h2>
        <p>It is shown once and stored only as a hash:</p>
        <code class="a-key-value">${esc(state.newKey)}</code>
      </section>` : ""}

      <section class="o-section">
        <div class="o-table-scroll">
          <table class="o-data-table">
            <thead><tr><th>Name</th><th>Scope</th><th>Sign-in link base</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${state.keys.map((k) => `
                <tr>
                  <td>${esc(k.name)}</td>
                  <td>${esc(k.contest_slug || "All contests")}</td>
                  <td>${k.signin_url ? `<code>${esc(k.signin_url)}</code>` : "<small>Code only</small>"}</td>
                  <td>${esc(k.created_at)}</td>
                  <td>${k.revoked_at ? "(Revoked)" : "(Active)"}</td>
                  <td>${k.revoked_at ? "" : `<button class="a-action-trigger a-action-trigger--dim" type="button" data-edit-key="${k.id}">Edit</button>
                    <button class="a-action-trigger a-action-trigger--danger" type="button" data-revoke-key="${k.id}">Revoke</button>`}</td>
                </tr>`).join("") || `<tr><td colspan="6">No API keys yet.</td></tr>`}
            </tbody>
          </table>
        </div>
        <button class="a-action-trigger" type="button" data-open-drawer="create-key">(+) Create API Key</button>
      </section>
    </section>`;
}

/* ---------- render + data ---------- */

function render() {
  const views = {
    contests: contestsMarkup,
    contest: contestDetailMarkup,
    users: usersMarkup,
    keys: keysMarkup,
  };
  app.innerHTML = `
    ${sidebarMarkup()}
    <section class="t-workspace">
      ${state.notice ? `<p class="a-workflow-note">${esc(state.notice)}</p>` : ""}
      ${views[state.view]()}
    </section>
    ${drawerMarkup()}
    ${confirmModalMarkup()}
    ${composeModalMarkup()}`;
  state.notice = null;
}

async function loadContests() {
  const res = await api("/admin/contests");
  if (res.ok) state.contests = res.body.contests;
}

async function openContest(id) {
  const res = await api(`/admin/contests/${id}`);
  if (!res.ok) {
    state.notice = "Couldn't load that contest.";
    return render();
  }
  if (state.contestDetail?.contest.id !== res.body.contest.id) state.submissionFilter = "active";
  state.contestDetail = res.body;
  state.view = "contest";
  render();
}

async function switchView(view) {
  if (view === "users") {
    const res = await api("/admin/users");
    if (res.ok) state.users = res.body.users;
  }
  if (view === "keys") {
    const res = await api("/admin/keys");
    if (res.ok) state.keys = res.body.keys;
    await loadContests();
  }
  if (view === "contests") await loadContests();
  if (view !== "keys") state.newKey = null;
  state.view = view;
  render();
}

/* ---------- events ---------- */

document.addEventListener("ub-navigate", (event) => {
  switchView(event.detail.view);
});

document.addEventListener("click", async (event) => {
  const openDrawerButton = event.target.closest("[data-open-drawer]");
  if (openDrawerButton) {
    state.activeDrawer = openDrawerButton.dataset.openDrawer;
    render();
    return;
  }

  const viewButton = event.target.closest("[data-admin-view]");
  if (viewButton) { switchView(viewButton.dataset.adminView); return; }

  const openButton = event.target.closest("[data-open-contest]");
  if (openButton) { openContest(Number(openButton.dataset.openContest)); return; }

  const statusButton = event.target.closest("[data-set-status]");
  if (statusButton) {
    const status = statusButton.dataset.setStatus;
    const ct = state.contestDetail.contest;
    const counts = state.contestDetail.counts || {};
    const backToOpen = status === "open" && ct.judging_started_at;
    askConfirm({
      heading: `Move to ${STATUS_LABELS[status]}?`,
      message: backToOpen
        ? `Judging has already started${counts.votes ? ` and ${counts.votes} vote${counts.votes === 1 ? " has" : "s have"} been cast` : ""}. New entries can come in again, but artists still can't withdraw, and existing votes are kept.`
        : `This changes what "${ct.name}" shows to its judging panel.`,
      confirmLabel: "( Confirm Stage Transition )",
      action: async () => {
        const res = await api(`/admin/contests/${ct.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
        if (!res.ok) {
          state.notice = res.body?.error === "no_advanced_submissions"
            ? "Select and save a Round 2 set before opening Round 2."
            : "Status change failed.";
          return render();
        }
        return openContest(ct.id);
      },
    });
    return;
  }

  const removeJudge = event.target.closest("[data-remove-judge]");
  if (removeJudge) {
    const ct = state.contestDetail.contest;
    askConfirm({
      heading: "Remove this judge?",
      message: "Their existing votes and ratings are kept, but they lose access to this contest's panel.",
      confirmLabel: "( Confirm Remove )",
      action: async () => {
        await api(`/admin/contests/${ct.id}/judges/${removeJudge.dataset.removeJudge}`, { method: "DELETE" });
        return openContest(ct.id);
      },
    });
    return;
  }

  const filterButton = event.target.closest("[data-submission-filter]");
  if (filterButton) {
    state.submissionFilter = filterButton.dataset.submissionFilter;
    render();
    return;
  }

  const withdrawSub = event.target.closest("[data-withdraw-sub]");
  if (withdrawSub) {
    const sub = state.contestDetail.submissions.find((x) => x.id === Number(withdrawSub.dataset.withdrawSub));
    state.reasonAction = { kind: "withdraw", subId: sub.id, title: `${sub.title} · ${sub.public_id}` };
    state.activeDrawer = "reason";
    render();
    return;
  }

  const restoreSub = event.target.closest("[data-restore-sub]");
  if (restoreSub) {
    const subId = restoreSub.dataset.restoreSub;
    askConfirm({
      heading: "Restore this entry?",
      message: "It goes back into the judging pool with the same reference, and its earlier votes count again.",
      confirmLabel: "( Confirm Restore )",
      action: async () => {
        const res = await api(`/admin/submissions/${subId}/restore`, { method: "POST", body: "{}" });
        if (!res.ok) state.notice = "Couldn't restore that entry.";
        return openContest(state.contestDetail.contest.id);
      },
    });
    return;
  }

  const historyButton = event.target.closest("[data-history]");
  if (historyButton) {
    const sub = state.contestDetail.submissions.find((x) => x.id === Number(historyButton.dataset.history));
    const res = await api(`/admin/submissions/${sub.id}/events`);
    if (!res.ok) { state.notice = "Couldn't load the history."; return render(); }
    state.history = { title: sub.title, publicId: sub.public_id, events: res.body.events };
    state.activeDrawer = "history";
    render();
    return;
  }

  const editKeyButton = event.target.closest("[data-edit-key]");
  if (editKeyButton) {
    state.editKey = state.keys.find((k) => k.id === Number(editKeyButton.dataset.editKey));
    state.activeDrawer = "edit-key";
    render();
    return;
  }

  const toggleDq = event.target.closest("[data-toggle-dq]");
  if (toggleDq && toggleDq.dataset.current !== "disqualified") {
    const sub = state.contestDetail.submissions.find((x) => x.id === Number(toggleDq.dataset.toggleDq));
    state.reasonAction = { kind: "disqualify", subId: sub.id, title: `${sub.title} · ${sub.public_id}` };
    state.activeDrawer = "reason";
    render();
    return;
  }
  if (toggleDq) {
    const disqualifying = toggleDq.dataset.current !== "disqualified";
    const next = disqualifying ? "disqualified" : "submitted";
    const subId = toggleDq.dataset.toggleDq;
    askConfirm({
      heading: disqualifying ? "Disqualify this submission?" : "Reinstate this submission?",
      message: disqualifying
        ? "It's excluded from Round 1/Round 2 selection and results until reinstated."
        : "It becomes eligible for Round 1/Round 2 selection and results again.",
      confirmLabel: disqualifying ? "( Confirm Disqualify )" : "( Confirm Reinstate )",
      action: async () => {
        await api(`/admin/submissions/${subId}/status`, { method: "POST", body: JSON.stringify({ status: next }) });
        return openContest(state.contestDetail.contest.id);
      },
    });
    return;
  }

  if (event.target.closest("[data-preselect-majority]")) {
    const majority = Math.floor(state.contestDetail.judges.length / 2) + 1;
    const byId = new Map(state.contestDetail.submissions.map((s) => [String(s.id), s]));
    document.querySelectorAll("[data-advance-check]").forEach((box) => {
      const sub = byId.get(box.value);
      // Withdrawn and disqualified rows are never preselected.
      if (sub && sub.status === "submitted" && !sub.withdrawn_at) box.checked = sub.yes_votes >= majority;
    });
    return;
  }

  if (event.target.closest("[data-save-advance]")) {
    const ids = [...document.querySelectorAll("[data-advance-check]:checked")].map((box) => Number(box.value));
    const ct = state.contestDetail.contest;
    const res = await api(`/admin/contests/${ct.id}/advance`, {
      method: "POST",
      body: JSON.stringify({ submissionIds: ids }),
    });
    state.notice = res.ok
      ? `Round 2 selection saved (${ids.length} poster${ids.length === 1 ? "" : "s"}).`
      : res.body?.error === "advance_only_during_judging"
        ? "Advancement can only be changed during Round 1 or Round 2."
        : "Couldn't save the selection.";
    return openContest(ct.id);
  }

  const revoke = event.target.closest("[data-revoke-key]");
  if (revoke) {
    askConfirm({
      heading: "Revoke this API key?",
      message: "The external form using it will stop working immediately.",
      confirmLabel: "( Confirm Revoke )",
      action: async () => {
        await api(`/admin/keys/${revoke.dataset.revokeKey}`, { method: "DELETE" });
        return switchView("keys");
      },
    });
    return;
  }

  const sendJudgeInvite = event.target.closest("[data-send-judge-invite]");
  if (sendJudgeInvite) {
    const judge = state.contestDetail.judges.find((j) => j.id === Number(sendJudgeInvite.dataset.sendJudgeInvite));
    if (judge) openCompose(judge, judgeInviteDraft(judge, state.contestDetail.contest.name));
    return;
  }

  const sendInvite = event.target.closest("[data-send-invite]");
  if (sendInvite) {
    const user = state.users.find((u) => u.id === Number(sendInvite.dataset.sendInvite));
    if (user) openCompose(user, accountInviteDraft(user));
    return;
  }

  if (event.target.closest("[data-compose-mode]")) {
    syncComposeFromDom();
    state.compose.mode = event.target.closest("[data-compose-mode]").dataset.composeMode;
    return render();
  }

  if (event.target.closest("[data-compose-skip]")) {
    state.compose = null;
    return render();
  }

  const backdrop = event.target.closest("[data-compose-backdrop]");
  if (backdrop && event.target === backdrop) {
    state.compose = null;
    return render();
  }

  if (event.target.closest("[data-compose-send]")) {
    syncComposeFromDom();
    const cm = state.compose;
    if (!cm.subject.trim() || !cm.body.trim()) {
      state.notice = "Add a subject and message before sending.";
      return render();
    }
    cm.sending = true;
    render();
    const res = await api(`/admin/users/${cm.userId}/invite-email`, {
      method: "POST",
      body: JSON.stringify({ subject: cm.subject, body: cm.body }),
    });
    state.compose = null;
    state.notice = res.ok
      ? `Welcome email sent to ${cm.userEmail}.`
      : res.body?.error === "recipient_unsubscribed"
        ? `${cm.userEmail} unsubscribed from these emails — nothing sent.`
        : "Couldn't send the email — check the Resend configuration and try again.";
    if (state.view === "contest") return openContest(state.contestDetail.contest.id);
    if (state.view === "users") return switchView("users");
    return render();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.compose) {
    state.compose = null;
    render();
  }
});

document.addEventListener("submit", async (event) => {
  const create = event.target.closest("[data-create-contest]");
  if (create) {
    event.preventDefault();
    const data = new FormData(create);
    const criteria = String(data.get("criteria") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const res = await api("/admin/contests", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        theme: data.get("theme"),
        description: data.get("description"),
        criteria,
      }),
    });
    if (!res.ok) {
      state.notice = res.body?.error === "slug_taken" ? "A contest with that name/slug already exists." : "Couldn't create the contest.";
      return render();
    }
    state.activeDrawer = null;
    return openContest(res.body.contest.id);
  }

  const addJudge = event.target.closest("[data-add-judge]");
  if (addJudge) {
    event.preventDefault();
    const data = new FormData(addJudge);
    const ct = state.contestDetail.contest;
    const res = await api(`/admin/contests/${ct.id}/judges`, {
      method: "POST",
      body: JSON.stringify({ email: data.get("email"), name: data.get("name") }),
    });
    if (!res.ok) {
      state.notice = "Couldn't add that judge.";
      return render();
    }
    state.activeDrawer = null;
    await openContest(ct.id);
    if (!res.body.inviteSent) openCompose(res.body.user, judgeInviteDraft(res.body.user, ct.name));
    return;
  }

  const addUser = event.target.closest("[data-add-user]");
  if (addUser) {
    event.preventDefault();
    const data = new FormData(addUser);
    const res = await api("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: data.get("email"), name: data.get("name"), role: data.get("role") }),
    });
    if (!res.ok) {
      state.notice = "Couldn't save that user.";
      return render();
    }
    state.activeDrawer = null;
    await switchView("users");
    if (!res.body.inviteSent) openCompose(res.body.user, accountInviteDraft(res.body.user));
    return;
  }

  const editContest = event.target.closest("[data-edit-contest]");
  if (editContest) {
    event.preventDefault();
    const data = new FormData(editContest);
    const ct = state.contestDetail.contest;
    const closesLocal = String(data.get("closesAt") || "");
    const res = await api(`/admin/contests/${ct.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: data.get("name"),
        theme: data.get("theme"),
        description: data.get("description"),
        // datetime-local is the viewer's local time; send it as UTC ISO.
        closesAt: closesLocal ? new Date(closesLocal).toISOString() : null,
        maxEntriesPerArtist: data.get("maxEntriesPerArtist") ? Number(data.get("maxEntriesPerArtist")) : null,
      }),
    });
    if (!res.ok) {
      state.notice = res.body?.error === "invalid_max_entries" ? "Max entries must be a whole number from 1 to 100." : "Couldn't save the contest.";
      return render();
    }
    state.activeDrawer = null;
    state.notice = "Contest saved.";
    return openContest(ct.id);
  }

  const reasonForm = event.target.closest("[data-reason-form]");
  if (reasonForm) {
    event.preventDefault();
    const ra = state.reasonAction;
    const reason = String(new FormData(reasonForm).get("reason") || "").trim();
    const res = ra.kind === "withdraw"
      ? await api(`/admin/submissions/${ra.subId}/withdraw`, { method: "POST", body: JSON.stringify({ reason }) })
      : await api(`/admin/submissions/${ra.subId}/status`, { method: "POST", body: JSON.stringify({ status: "disqualified", reason }) });
    state.activeDrawer = null;
    state.reasonAction = null;
    if (!res.ok) state.notice = "That change didn't save.";
    return openContest(state.contestDetail.contest.id);
  }

  const editKey = event.target.closest("[data-edit-key-form]");
  if (editKey) {
    event.preventDefault();
    const res = await api(`/admin/keys/${state.editKey.id}`, {
      method: "PATCH",
      body: JSON.stringify({ signinUrl: new FormData(editKey).get("signinUrl") }),
    });
    if (!res.ok) {
      state.notice = res.body?.error === "invalid_signin_url" ? "Use a full https:// address with no ? or #." : "Couldn't save the key.";
      return render();
    }
    state.activeDrawer = null;
    state.editKey = null;
    return switchView("keys");
  }

  const createKey = event.target.closest("[data-create-key]");
  if (createKey) {
    event.preventDefault();
    const data = new FormData(createKey);
    const res = await api("/admin/keys", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        contestId: data.get("contestId") ? Number(data.get("contestId")) : null,
        signinUrl: data.get("signinUrl") || null,
      }),
    });
    if (res.ok) state.newKey = res.body.key;
    else state.notice = res.body?.error === "invalid_signin_url" ? "Use a full https:// address for the sign-in link base." : "Couldn't create the key.";
    state.activeDrawer = null;
    return switchView("keys");
  }
});

/* ---------- init ---------- */

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-login-form]");
  if (!form) return;
  event.preventDefault();
  const email = new FormData(form).get("email");
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Sending…";
  api("/auth/request-link", { method: "POST", body: JSON.stringify({ email }) }).then((res) => {
    if (res.ok) {
      gate("Check your email", "Sign-in link sent",
        `If ${email} has access, a one-time link is on its way. It expires in 15 minutes.`);
    } else if (res.status === 429) {
      loginGate("Too many link requests — wait a few minutes and try again.");
    } else {
      loginGate("Couldn't send the sign-in email. Try again in a moment.");
    }
  });
});

document.addEventListener("click", async (event) => {
  if (!event.target.closest("[data-logout]")) return;
  await api("/auth/logout", { method: "POST", body: "{}" });
  window.location.href = "/";
});

async function init() {
  const res = await api("/me");
  if (res.status === 401) return loginGate();
  if (res.status === 403) return gate("No access", "Not authorized", "Your account doesn't have access to the admin console.");
  if (!res.ok) return gate("Error", "Something went wrong", `The API returned HTTP ${res.status}.`);

  state.me = res.body;
  if (!["admin", "manager"].includes(state.me.user.role)) {
    return gate("No access", "Managers only", "The admin console is limited to admins and contest managers. Use the Judge Portal instead.");
  }
  await switchView("contests");
}

init();
