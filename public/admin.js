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
    <section class="portal-gate">
      <article class="locked-panel">
        <span>${esc(kicker)}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
      </article>
    </section>`;
}

function loginGate(message) {
  app.innerHTML = `
    <section class="portal-gate">
      <article class="locked-panel login-card">
        <span>Sign in</span>
        <h2>UNBLOCKED Admin</h2>
        <p>${esc(message || "Enter your email and we'll send you a one-time sign-in link.")}</p>
        <form class="login-form" data-login-form>
          <input type="email" name="email" required placeholder="you@example.com" autocomplete="email">
          <button class="primary-button" type="submit">Email me a sign-in link</button>
        </form>
      </article>
    </section>`;
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
  const navButton = (view, label) =>
    `<button type="button" data-admin-view="${view}" class="${state.view === view || (view === "contests" && state.view === "contest") ? "is-active" : ""}">${esc(label)}</button>`;

  return `
    <aside class="judge-sidebar" aria-label="Admin navigation">
      <div class="judge-profile">
        <span class="profile-mark">${esc(initials || "A")}</span>
        <div>
          <strong>${esc(user.name || user.email)}</strong>
          <span>${esc(user.role === "admin" ? "Administrator" : "Contest Manager")}</span>
          <button class="text-button signout-button" type="button" data-logout>Sign out</button>
        </div>
      </div>
      <nav class="portal-nav">
        ${navButton("contests", "Contests")}
        ${isAdmin() ? navButton("users", "Users") : ""}
        ${isAdmin() ? navButton("keys", "API Keys") : ""}
      </nav>
      <section class="sidebar-card">
        <h2>Lifecycle</h2>
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

function contestsMarkup() {
  return `
    <section class="portal-view is-active">
      <div class="page-heading">
        <p class="eyebrow">Admin Console</p>
        <h1>Contests</h1>
        <p>Each contest runs its own judging panel with the shared scoring system.</p>
      </div>

      <div class="admin-grid">
        ${state.contests.map((ct) => `
          <article class="status-card admin-contest-card">
            <span>${esc(STATUS_LABELS[ct.status] || ct.status)}</span>
            <strong>${esc(ct.name)}</strong>
            <p>${ct.submission_count} submission${ct.submission_count === 1 ? "" : "s"} · ${ct.judge_count} judge${ct.judge_count === 1 ? "" : "s"} · <code>${esc(ct.slug)}</code></p>
            <button class="ghost-button" type="button" data-open-contest="${ct.id}">Manage</button>
          </article>`).join("") || `<p class="workflow-note">No contests yet — create the first one below.</p>`}
      </div>

      <section class="archive-card">
        <h2>New Contest</h2>
        <form class="admin-form" data-create-contest>
          <label>Name <input name="name" required maxlength="120" placeholder="Ownership 2026"></label>
          <label>Theme <input name="theme" maxlength="120" placeholder="Ownership"></label>
          <label class="wide">Description <textarea name="description" rows="2" maxlength="1000"></textarea></label>
          <label class="wide">Criteria (comma-separated)
            <input name="criteria" value="Theme Relevance, Concept, Execution, Creativity">
          </label>
          <button class="primary-button" type="submit">Create contest</button>
        </form>
      </section>
    </section>`;
}

/* ---------- contest detail ---------- */

function statusStepper(ct) {
  return `
    <div class="status-stepper">
      ${STATUS_FLOW.map((status) => `
        <button type="button" class="step ${ct.status === status ? "is-current" : ""}"
          data-set-status="${status}" ${ct.status === status ? "disabled" : ""}>
          ${esc(STATUS_LABELS[status])}
        </button>`).join("")}
    </div>`;
}

function contestDetailMarkup() {
  const d = state.contestDetail;
  const ct = d.contest;
  const majority = Math.floor(d.judges.length / 2) + 1;

  const submissionRows = d.submissions.map((sub) => {
    const thumb = sub.fileUrl && (sub.file_type || "").startsWith("image/")
      ? `<img src="${esc(sub.fileUrl)}" alt="" loading="lazy">`
      : `<span class="thumb-fallback">${esc((sub.file_type || "—").split("/")[1] || "—")}</span>`;
    return `
      <tr class="${sub.status === "disqualified" ? "is-disqualified" : ""}">
        <td class="cell-thumb">${sub.fileUrl ? `<a href="${esc(sub.fileUrl)}" target="_blank" rel="noopener">${thumb}</a>` : thumb}</td>
        <td><strong>${esc(sub.title)}</strong><br><small>${esc(sub.public_id)} · ${esc([sub.artist_name, sub.country].filter(Boolean).join(", ") || "anonymous")}</small></td>
        <td>${sub.yes_votes} yes / ${sub.no_votes} no</td>
        <td>${sub.ratings_count}</td>
        <td><label class="check-label"><input type="checkbox" data-advance-check value="${sub.id}" ${sub.advanced ? "checked" : ""} ${sub.status === "disqualified" ? "disabled" : ""}> R2</label></td>
        <td><button class="text-button" type="button" data-toggle-dq="${sub.id}" data-current="${sub.status}">
          ${sub.status === "disqualified" ? "Reinstate" : "Disqualify"}</button></td>
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
      <div class="review-header">
        <div>
          <p class="eyebrow">Contest</p>
          <h1>${esc(ct.name)}</h1>
        </div>
        <div class="review-tools">
          <button class="ghost-button" type="button" data-admin-view="contests">Back to contests</button>
          <a class="ghost-button" href="/api/admin/contests/${ct.id}/export.csv">Export CSV</a>
        </div>
      </div>

      <section class="archive-card">
        <h2>Status</h2>
        <p>Slug <code>${esc(ct.slug)}</code> — the external form submits to <code>/api/v1/contests/${esc(ct.slug)}/submissions</code>.</p>
        ${statusStepper(ct)}
        <p class="workflow-note">Moving to Round 2 requires at least one advanced submission. Judges only ever see the active stage.</p>
      </section>

      <section class="archive-card">
        <h2>Judging Panel (${d.judges.length})</h2>
        <table class="admin-table">
          <thead><tr><th>Judge</th><th>Round 1</th><th>Round 2</th><th></th></tr></thead>
          <tbody>
            ${d.judges.map((j) => `
              <tr>
                <td><strong>${esc(j.name || j.email)}</strong><br><small>${esc(j.email)}</small></td>
                <td>${j.round1_votes} votes</td>
                <td>${j.round2_ratings} rated</td>
                <td><button class="text-button" type="button" data-remove-judge="${j.id}">Remove</button></td>
              </tr>`).join("") || `<tr><td colspan="4">No judges on the panel yet.</td></tr>`}
          </tbody>
        </table>
        <form class="admin-form inline" data-add-judge>
          <label>Email <input name="email" type="email" required placeholder="judge@example.com"></label>
          <label>Name <input name="name" maxlength="120" placeholder="Optional"></label>
          <button class="primary-button" type="submit">Add judge</button>
        </form>
        <p class="workflow-note">Judges sign in with this email through Cloudflare Access — no password setup needed.</p>
      </section>

      <section class="archive-card">
        <h2>Submissions (${d.submissions.length})</h2>
        <div class="table-scroll">
          <table class="admin-table">
            <thead><tr><th></th><th>Entry</th><th>Round 1 votes</th><th>Ratings</th><th>Advance</th><th></th></tr></thead>
            <tbody>${submissionRows || `<tr><td colspan="6">No submissions yet — entries arrive via the external form API.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="form-actions">
          <button class="ghost-button" type="button" data-preselect-majority>Preselect majority (≥ ${majority} yes)</button>
          <button class="primary-button" type="button" data-save-advance>Save Round 2 selection</button>
        </div>
      </section>

      <section class="archive-card">
        <h2>Results</h2>
        <div class="table-scroll">
          <table class="admin-table">
            <thead><tr><th>#</th><th>Entry</th><th>Average</th><th>Judges</th></tr></thead>
            <tbody>${resultRows || `<tr><td colspan="4">No Round 2 ratings yet.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </section>`;
}

/* ---------- users + keys ---------- */

function usersMarkup() {
  return `
    <section class="portal-view is-active">
      <div class="page-heading">
        <p class="eyebrow">Admin Console</p>
        <h1>Users</h1>
        <p>Anyone signing in through Cloudflare Access must exist here (or be listed in ADMIN_EMAILS) to get in.</p>
      </div>
      <section class="archive-card">
        <table class="admin-table">
          <thead><tr><th>User</th><th>Role</th><th>Last seen</th></tr></thead>
          <tbody>
            ${state.users.map((u) => `
              <tr>
                <td><strong>${esc(u.name || u.email)}</strong><br><small>${esc(u.email)}</small></td>
                <td>${esc(u.role)}</td>
                <td>${esc(u.last_seen_at || "never")}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        <form class="admin-form inline" data-add-user>
          <label>Email <input name="email" type="email" required></label>
          <label>Name <input name="name" maxlength="120"></label>
          <label>Role
            <select name="role">
              <option value="judge">Judge</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button class="primary-button" type="submit">Add / update user</button>
        </form>
      </section>
    </section>`;
}

function keysMarkup() {
  return `
    <section class="portal-view is-active">
      <div class="page-heading">
        <p class="eyebrow">Admin Console</p>
        <h1>API Keys</h1>
        <p>Keys authenticate the external submission system. See docs/external-api.md in the repo.</p>
      </div>

      ${state.newKey ? `
      <section class="archive-card key-reveal">
        <h2>Copy this key now</h2>
        <p>It is shown once and stored only as a hash:</p>
        <code class="key-value">${esc(state.newKey)}</code>
      </section>` : ""}

      <section class="archive-card">
        <table class="admin-table">
          <thead><tr><th>Name</th><th>Scope</th><th>Created</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${state.keys.map((k) => `
              <tr>
                <td>${esc(k.name)}</td>
                <td>${esc(k.contest_slug || "All contests")}</td>
                <td>${esc(k.created_at)}</td>
                <td>${k.revoked_at ? "Revoked" : "Active"}</td>
                <td>${k.revoked_at ? "" : `<button class="text-button" type="button" data-revoke-key="${k.id}">Revoke</button>`}</td>
              </tr>`).join("") || `<tr><td colspan="5">No API keys yet.</td></tr>`}
          </tbody>
        </table>
        <form class="admin-form inline" data-create-key>
          <label>Name <input name="name" required maxlength="120" placeholder="External submission form"></label>
          <label>Contest scope
            <select name="contestId">
              <option value="">All contests</option>
              ${state.contests.map((ct) => `<option value="${ct.id}">${esc(ct.name)}</option>`).join("")}
            </select>
          </label>
          <button class="primary-button" type="submit">Create key</button>
        </form>
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
    <section class="portal-workspace">
      ${state.notice ? `<div class="lock-notice">${esc(state.notice)}</div>` : ""}
      ${views[state.view]()}
    </section>`;
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

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-admin-view]");
  if (viewButton) { switchView(viewButton.dataset.adminView); return; }

  const openButton = event.target.closest("[data-open-contest]");
  if (openButton) { openContest(Number(openButton.dataset.openContest)); return; }

  const statusButton = event.target.closest("[data-set-status]");
  if (statusButton) {
    const status = statusButton.dataset.setStatus;
    const ct = state.contestDetail.contest;
    if (!confirm(`Move "${ct.name}" to ${STATUS_LABELS[status]}?`)) return;
    const res = await api(`/admin/contests/${ct.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!res.ok) {
      state.notice = res.body?.error === "no_advanced_submissions"
        ? "Select and save a Round 2 set before opening Round 2."
        : "Status change failed.";
      return render();
    }
    return openContest(ct.id);
  }

  const removeJudge = event.target.closest("[data-remove-judge]");
  if (removeJudge) {
    const ct = state.contestDetail.contest;
    if (!confirm("Remove this judge from the panel? Their existing votes are kept.")) return;
    await api(`/admin/contests/${ct.id}/judges/${removeJudge.dataset.removeJudge}`, { method: "DELETE" });
    return openContest(ct.id);
  }

  const toggleDq = event.target.closest("[data-toggle-dq]");
  if (toggleDq) {
    const next = toggleDq.dataset.current === "disqualified" ? "submitted" : "disqualified";
    await api(`/admin/submissions/${toggleDq.dataset.toggleDq}/status`, {
      method: "POST",
      body: JSON.stringify({ status: next }),
    });
    return openContest(state.contestDetail.contest.id);
  }

  if (event.target.closest("[data-preselect-majority]")) {
    const majority = Math.floor(state.contestDetail.judges.length / 2) + 1;
    const byId = new Map(state.contestDetail.submissions.map((s) => [String(s.id), s]));
    document.querySelectorAll("[data-advance-check]").forEach((box) => {
      const sub = byId.get(box.value);
      if (sub && sub.status === "submitted") box.checked = sub.yes_votes >= majority;
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
    if (!confirm("Revoke this API key? The external form using it will stop working.")) return;
    await api(`/admin/keys/${revoke.dataset.revokeKey}`, { method: "DELETE" });
    return switchView("keys");
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
    if (!res.ok) state.notice = "Couldn't add that judge.";
    return openContest(ct.id);
  }

  const addUser = event.target.closest("[data-add-user]");
  if (addUser) {
    event.preventDefault();
    const data = new FormData(addUser);
    const res = await api("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: data.get("email"), name: data.get("name"), role: data.get("role") }),
    });
    if (!res.ok) state.notice = "Couldn't save that user.";
    return switchView("users");
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
      }),
    });
    if (res.ok) state.newKey = res.body.key;
    else state.notice = "Couldn't create the key.";
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
