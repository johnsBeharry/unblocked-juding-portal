/* UNBLOCKED Judge Portal — API-driven frontend. All dynamic strings are
   escaped with esc() before being placed in markup. */

const state = {
  me: null,
  contests: [],
  contestId: null,
  data: null,
  view: "dashboard",
  r1Index: 0,
  r2Index: 0,
  pendingRatings: {},
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
  try { body = await res.json(); } catch { /* empty body */ }
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
        <h2>UNBLOCKED Judging</h2>
        <p>${esc(message || "Enter your invited email and we'll send you a one-time sign-in link.")}</p>
        <form class="o-login-form" data-login-form>
          <input class="a-input-text" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
          <button class="a-action-trigger a-action-trigger--primary" type="submit">Email me a sign-in link</button>
        </form>
      </article>
    </section>`;
}

async function requestLoginLink(form) {
  const email = new FormData(form).get("email");
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Sending…";
  const res = await api("/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
  if (res.ok) {
    gate("Check your email", "Sign-in link sent",
      `If ${email} is invited, a one-time link is on its way. It expires in 15 minutes.`);
  } else if (res.status === 429) {
    loginGate("Too many link requests — wait a few minutes and try again.");
  } else {
    loginGate("Couldn't send the sign-in email. Try again, or contact the contest manager.");
  }
}

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-login-form]");
  if (!form) return;
  event.preventDefault();
  requestLoginLink(form);
});

document.addEventListener("click", async (event) => {
  if (!event.target.closest("[data-logout]")) return;
  await api("/auth/logout", { method: "POST", body: "{}" });
  window.location.href = "/";
});

/* ---------- data helpers ---------- */

const STAGE_ORDER = ["draft", "open", "round1", "round2", "deliberation", "complete"];

const STATUS_LABELS = {
  draft: "Draft",
  open: "Submissions Open",
  round1: "Round 1 Active",
  round2: "Round 2 Active",
  deliberation: "Deliberation",
  complete: "Results Ready",
  archived: "Archived",
};

function contest() { return state.data?.contest; }
function submissions() { return state.data?.submissions ?? []; }
function advancedSubs() { return submissions().filter((s) => s.advanced); }
function myVote(subId) { return state.data?.myVotes?.[subId]; }

function round1Done() {
  return submissions().filter((s) => myVote(s.id)).length;
}

function ratingComplete(subId) {
  const ratings = state.pendingRatings[subId] || {};
  return contest().criteria.every((crit) => ratings[crit] >= 1);
}

function savedRatingComplete(subId) {
  const ratings = state.data?.myRatings?.[subId] || {};
  return contest().criteria.every((crit) => ratings[crit] >= 1);
}

function round2Done() {
  return advancedSubs().filter((s) => savedRatingComplete(s.id)).length;
}

function viewUnlocked(view) {
  const status = contest().status;
  switch (view) {
    case "dashboard": return true;
    case "round-one": return ["round1", "round2", "deliberation", "complete"].includes(status);
    case "round-two": return ["round2", "deliberation", "complete"].includes(status);
    case "finalists":
    case "deliberation":
    case "results": return ["deliberation", "complete"].includes(status);
    default: return false;
  }
}

function canOpenRoundOne(index) {
  const subs = submissions();
  if (index < 0 || index >= subs.length) return false;
  const firstOpen = subs.findIndex((s) => !myVote(s.id));
  return myVote(subs[index].id) || firstOpen === -1 || index <= firstOpen;
}

/* ---------- shared markup ---------- */

function posterThumbTag(sub, variant) {
  return `<ub-poster-thumb variant="${variant}" src="${esc(sub.fileUrl || "")}"
    file-type="${esc(sub.fileType || "")}" title="${esc(sub.title)}" art-seed="${sub.id}"></ub-poster-thumb>`;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function lockedPanel(title, text) {
  return `
    <article class="t-gate-panel">
      <span class="a-section-tag">Locked</span>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
    </article>`;
}

function stageNavMarkup() {
  const status = contest().status;
  return `
    <nav class="o-stage-nav" aria-label="Contest stage">
      ${STAGE_ORDER.map((stage) => `<span class="o-stage-nav__item${stage === status ? " o-stage-nav__item--active" : ""}">${esc(STATUS_LABELS[stage])}</span>`).join("")}
    </nav>`;
}

function criteriaBarMarkup() {
  return `<ub-criteria-bar criteria='${esc(JSON.stringify(contest().criteria))}'></ub-criteria-bar>`;
}

/* ---------- sidebar ---------- */

function sidebarMarkup() {
  const user = state.me.user;
  const initials = (user.name || user.email)
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join("");
  const roleLine = state.data?.onPanel
    ? `Judge, ${contest().name}`
    : user.role === "judge" ? "Judge" : `${user.role[0].toUpperCase()}${user.role.slice(1)} (observer)`;

  const picker = state.contests.length > 1
    ? `<label class="contest-picker">Contest
         <select class="a-input-select" data-contest-picker>
           ${state.contests.map((ct) => `<option value="${ct.id}" ${ct.id === state.contestId ? "selected" : ""}>${esc(ct.name)}</option>`).join("")}
         </select>
       </label>`
    : "";

  const navItem = (view, label) => {
    const locked = !viewUnlocked(view);
    return `<ub-nav-link view="${view}" label="${esc(label)}" ${state.view === view ? "active" : ""} ${locked ? "locked" : ""}></ub-nav-link>`;
  };

  return `
    <aside class="o-nav-sidebar" aria-label="Judge portal navigation">
      <div class="m-profile-card">
        <span class="m-profile-card__mark">${esc(initials || "J")}</span>
        <div>
          <strong class="m-profile-card__name">${esc(user.name || user.email)}</strong>
          <span class="m-profile-card__role">${esc(roleLine)}</span>
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-logout>Sign out</button>
        </div>
      </div>
      ${picker}
      <nav class="o-portal-nav">
        ${navItem("dashboard", "Dashboard")}
        ${navItem("round-one", "Round 1 Review")}
        ${navItem("round-two", "Round 2 Review")}
        ${navItem("finalists", "Finalists")}
        ${navItem("deliberation", "Deliberation")}
        ${navItem("results", "Results")}
      </nav>
      <section class="o-sidebar-list">
        <span class="a-section-tag">Judging Criteria</span>
        <ul>${contest().criteria.map((crit) => `<li>${esc(crit)}</li>`).join("")}</ul>
      </section>
    </aside>`;
}

/* ---------- views ---------- */

function dashboardMarkup() {
  const ct = contest();
  const total = submissions().length;
  const status = ct.status;
  const judgingStarted = viewUnlocked("round-one");

  const roundNote = {
    draft: "The contest is being set up. You'll be notified when judging opens.",
    open: "Submissions are being collected. Judging opens once the manager starts Round 1.",
    round1: "Swipe each poster: left for No, right for Yes. You can revise until Round 2 opens.",
    round2: `Rate each advancing poster across ${ct.criteria.length} categories, 10 stars each.`,
    deliberation: "Ratings are in. Review the finalist ranking before the deliberation call.",
    complete: "Judging is complete. Final results are available.",
    archived: "This contest is archived.",
  }[status] || "";

  return `
    <section class="portal-view is-active">
      ${stageNavMarkup()}
      <div class="t-page-heading">
        <p class="a-section-tag">Judge Portal</p>
        <h1>${esc(ct.name)}</h1>
        <p>${esc(ct.description || ct.theme || "")}</p>
      </div>

      <div class="o-status-grid">
        <ub-status-tile highlight label="Contest status" value="${esc(statusLabel(status))}" desc="${esc(roundNote)}"></ub-status-tile>
        <ub-status-tile label="Round 1 progress" value="${round1Done()}/${total}" desc="Your Yes/No decisions, saved to the judging server."></ub-status-tile>
        <ub-status-tile label="Round 2 progress" value="${viewUnlocked("round-two") ? `${round2Done()}/${advancedSubs().length}` : "Locked"}"
          ${viewUnlocked("round-two") ? "" : "muted"}
          desc="${viewUnlocked("round-two") ? "Advancing posters you have fully rated." : "Opens when the manager starts Round 2."}"></ub-status-tile>
        <ub-status-tile label="Results" value="${viewUnlocked("results") ? "Available" : "Hidden"}"
          ${viewUnlocked("results") ? "" : "muted"}
          desc="${viewUnlocked("results") ? "Aggregated across the full judging panel." : "Rankings appear once deliberation begins."}"></ub-status-tile>
      </div>

      ${judgingStarted ? `
      <section>
        <div class="o-queue-section__header">
          <h2>Submission Queue</h2>
          ${status === "round1" ? `<button class="a-action-trigger" type="button" data-view-target="round-one">Start reviewing</button>` : ""}
        </div>
        <div class="o-submission-grid">
          ${submissions().map((sub, index) => {
            const decision = myVote(sub.id);
            const locked = status === "round1" && !canOpenRoundOne(index);
            const chip = decision ? (decision === "yes" ? "(Yes)" : "(No)") : locked ? "(Locked)" : "(Ready)";
            return `
              <article class="m-submission-card ${decision ? "is-reviewed" : ""} ${locked ? "is-locked" : ""}">
                <button type="button" data-open-submission="${index}" ${locked ? "disabled" : ""}>
                  ${posterThumbTag(sub, "thumb")}
                  <span class="m-submission-card__body">
                    <strong>${esc(sub.title)}</strong>
                    <span>${esc(sub.artistName ? `${sub.artistName}${sub.country ? ", " + sub.country : ""}` : sub.publicId)}</span>
                    <span class="a-status-chip">${chip}</span>
                  </span>
                </button>
              </article>`;
          }).join("")}
        </div>
      </section>` : `
      <section>
        <div class="o-queue-section__header"><h2>Submission Queue</h2></div>
        ${lockedPanel("Posters are hidden", status === "open" ? "Submissions are still coming in. The queue is revealed when Round 1 opens." : "The queue is revealed when judging begins.")}
      </section>`}
    </section>`;
}

function roundOneMarkup() {
  if (!viewUnlocked("round-one")) {
    return `<section class="portal-view is-active">${lockedPanel("Round 1 is closed", "Round 1 opens when the contest manager starts judging.")}</section>`;
  }

  const subs = submissions();
  if (!subs.length) {
    return `<section class="portal-view is-active">${lockedPanel("No submissions", "No posters were submitted to this contest.")}</section>`;
  }

  if (!canOpenRoundOne(state.r1Index)) {
    state.r1Index = Math.max(0, subs.findIndex((s) => !myVote(s.id)));
  }
  const sub = subs[state.r1Index];
  const decision = myVote(sub.id);
  const votingOpen = contest().status === "round1" && state.data.onPanel;
  const complete = round1Done() === subs.length;
  const yesCount = subs.filter((s) => myVote(s.id) === "yes").length;

  return `
    <section class="portal-view is-active">
      <div class="o-review-header">
        <div>
          <p class="a-section-tag">Round 1</p>
          <h1>Swipe Review</h1>
        </div>
        <div class="m-review-nav">
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-prev-submission ${state.r1Index === 0 ? "disabled" : ""}>Previous</button>
          <strong>${state.r1Index + 1} of ${subs.length}</strong>
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-next-submission ${!canOpenRoundOne(state.r1Index + 1) ? "disabled" : ""}>Next</button>
        </div>
      </div>

      ${complete && votingOpen ? `<p class="a-workflow-note">All ${subs.length} decisions recorded — ${yesCount} Yes. You can revise them until the manager opens Round 2.</p>`
        : votingOpen ? `<p class="a-workflow-note">Swipe left for No, right for Yes. Poster ${Math.max(0, subs.findIndex((s) => !myVote(s.id))) + 1} is next.</p>`
        : `<p class="a-workflow-note">Round 1 voting is closed. Your recorded decisions are shown for reference.</p>`}

      <div class="o-swipe-stage">
        <article class="m-swipe-card ${decision === "no" ? "swiped-left" : ""} ${decision === "yes" ? "swiped-right" : ""}" data-swipe-card>
          ${posterThumbTag(sub, "stage")}
          <div class="m-swipe-card__meta">
            <h2>${esc(sub.title)}</h2>
            ${sub.concept ? `<p class="m-swipe-card__concept">${esc(sub.concept)}</p>` : ""}
          </div>
        </article>

        ${votingOpen ? `
        <div class="o-swipe-actions" aria-label="Round 1 decision">
          <button class="a-swipe-trigger" type="button" data-swipe-left>
            <span>Swipe left</span>No
          </button>
          <button class="a-swipe-trigger" type="button" data-swipe-right>
            <span>Swipe right</span>Yes
          </button>
        </div>` : ""}
      </div>
      ${criteriaBarMarkup()}
    </section>`;
}

function roundTwoMarkup() {
  if (!viewUnlocked("round-two")) {
    return `<section class="portal-view is-active">${lockedPanel("Round 2 is closed", "Round 2 opens when the contest manager advances posters from Round 1.")}</section>`;
  }
  const subs = advancedSubs();
  if (!subs.length) {
    return `<section class="portal-view is-active">${lockedPanel("No posters advanced", "The manager has not advanced any posters to Round 2.")}</section>`;
  }

  state.r2Index = Math.max(0, Math.min(state.r2Index, subs.length - 1));
  const sub = subs[state.r2Index];
  if (!state.pendingRatings[sub.id]) {
    state.pendingRatings[sub.id] = { ...(state.data.myRatings?.[sub.id] || {}) };
  }
  const pending = state.pendingRatings[sub.id];
  const ratingOpen = contest().status === "round2" && state.data.onPanel;
  const meta = sub.metadata || {};
  const metaRows = [
    ["Year", meta.year_designed],
    ["Designed for", meta.designed_for],
    ["Client", meta.client_name],
    ["Method", meta.creation_method],
    ["Programs", meta.digital_programs],
    ["Printing", meta.printing_method],
  ].filter(([, v]) => v);

  return `
    <section class="portal-view is-active">
      <div class="o-review-header">
        <div>
          <p class="a-section-tag">Round 2</p>
          <h1>Category Ratings</h1>
        </div>
        <div class="m-review-nav">
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-round-two-prev ${state.r2Index === 0 ? "disabled" : ""}>Previous</button>
          <strong>${state.r2Index + 1} of ${subs.length}</strong>
          <button class="a-action-trigger a-action-trigger--dim" type="button" data-round-two-next ${state.r2Index === subs.length - 1 ? "disabled" : ""}>Next</button>
        </div>
      </div>

      <article class="o-rating-stage">
        ${posterThumbTag(sub, "stage")}
        <form class="o-review-form" data-round-two-form data-submission-id="${sub.id}">
          <div class="m-submission-meta">
            <span class="a-section-tag">${esc(sub.publicId)}</span>
            <h2>${esc(sub.title)}</h2>
            <p>${savedRatingComplete(sub.id) ? "Ratings submitted — you can revise them while Round 2 is open." : "Rate each category out of 10 stars."}</p>
          </div>
          <div class="o-designer-context" aria-label="Designer and poster context">
            <div>
              <span class="a-context-kicker">Designer</span>
              <div class="o-designer-summary">
                <p><span>Name</span><strong>${esc(sub.artistName || "—")}</strong></p>
                <p><span>Country</span><strong>${esc(sub.country || "—")}</strong></p>
                ${metaRows.map(([label, value]) => `<p><span>${esc(label)}</span><strong>${esc(value)}</strong></p>`).join("")}
              </div>
            </div>
            <div class="o-poster-description">
              <span class="a-context-kicker">Poster concept</span>
              <p>${esc(sub.concept || "No concept statement provided.")}</p>
            </div>
          </div>
          <div class="o-star-rating-list">
            ${contest().criteria.map((crit) => `<ub-star-rating criterion="${esc(crit)}" value="${pending[crit] || 0}" max="10" ${ratingOpen ? "" : "readonly"}></ub-star-rating>`).join("")}
          </div>
          ${ratingOpen
            ? `<button class="a-action-trigger a-action-trigger--primary" type="submit">Submit ratings</button>`
            : `<p class="a-workflow-note">Round 2 rating is closed.</p>`}
        </form>
      </article>
      ${criteriaBarMarkup()}
    </section>`;
}

function rankingRows() {
  const results = (state.data.results || []).filter((r) => r.average !== null);
  return results.map((r, index) => {
    const sub = submissions().find((s) => s.id === r.submissionId) || { id: r.submissionId, title: r.title, fileUrl: null };
    return `
      <article class="m-ranking-row">
        <span class="m-ranking-row__rank">${String(index + 1).padStart(2, "0")}</span>
        ${posterThumbTag(sub, "queue")}
        <div>
          <strong>${esc(r.title)}</strong>
          <p>${esc([r.artistName, r.country].filter(Boolean).join(", ") || r.publicId)} · ${r.judgesRated} judge${r.judgesRated === 1 ? "" : "s"}</p>
        </div>
        <strong class="m-ranking-row__score">${r.average.toFixed(1)}</strong>
      </article>`;
  }).join("");
}

function finalistsMarkup() {
  if (!viewUnlocked("finalists")) {
    return `<section class="portal-view is-active">${lockedPanel("Finalists are hidden", "The finalist ranking is revealed when deliberation begins.")}</section>`;
  }
  return `
    <section class="portal-view is-active">
      <div class="t-page-heading is-tight">
        <p class="a-section-tag">Finalists</p>
        <h1>Finalist Ranking</h1>
        <p>Aggregated Round 2 ratings across the full judging panel.</p>
      </div>
      <div class="o-ranking-list">${rankingRows() || lockedPanel("No ratings yet", "No Round 2 ratings have been submitted.")}</div>
    </section>`;
}

function deliberationMarkup() {
  if (!viewUnlocked("deliberation")) {
    return `<section class="portal-view is-active">${lockedPanel("Deliberation is locked", "The deliberation hub opens once Round 2 closes.")}</section>`;
  }
  return `
    <section class="portal-view is-active">
      <div class="t-page-heading is-tight">
        <p class="a-section-tag">Deliberation</p>
        <h1>Meeting Hub</h1>
      </div>
      <div class="o-meeting-grid">
        <article>
          <span class="a-section-tag">${esc(contest().name)}</span>
          <h2>Final Deliberation</h2>
          <p>The panel compares finalist rankings, rating variance, and flagged entries before winners are confirmed.</p>
        </article>
        <article class="o-resource-list">
          <span class="a-section-tag">Resources</span>
          <a href="#finalists" data-view-target="finalists">Finalist ranking</a>
          <a href="#round-one" data-view-target="round-one">Round 1 decisions</a>
          <a href="#dashboard" data-view-target="dashboard">Contest overview</a>
        </article>
      </div>
    </section>`;
}

function resultsMarkup() {
  if (!viewUnlocked("results")) {
    return `<section class="portal-view is-active">${lockedPanel("Results are not available yet", "Results are published when the contest completes.")}</section>`;
  }
  const winners = (state.data.results || []).filter((r) => r.average !== null).slice(0, 3);
  const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : "3rd");
  return `
    <section class="portal-view is-active">
      <div class="t-page-heading is-tight">
        <p class="a-section-tag">Results</p>
        <h1>${contest().status === "complete" ? "Final Results" : "Provisional Results"}</h1>
        <p>Calculated from Round 2 category ratings across all judges.</p>
      </div>
      <div class="o-winner-grid">
        ${winners.map((r, index) => `
          <article class="m-winner-tile">
            <span class="a-section-tag">${ordinal(index + 1)} Place</span>
            <strong>${esc(r.title)}</strong>
            <small>${esc([r.artistName, r.country].filter(Boolean).join(", ") || r.publicId)} · ${r.average.toFixed(1)}/10</small>
          </article>`).join("") || lockedPanel("No ratings", "No Round 2 ratings were submitted.")}
      </div>
      <section>
        <h2>Calculated Ranking</h2>
        <p class="a-workflow-note">Ranked by the mean of every category score from every judge on the panel.</p>
        <button class="a-action-trigger" type="button" data-view-target="finalists">View full ranking</button>
      </section>
    </section>`;
}

/* ---------- render + events ---------- */

function render() {
  if (!state.data) return;
  const viewMarkup = {
    dashboard: dashboardMarkup,
    "round-one": roundOneMarkup,
    "round-two": roundTwoMarkup,
    finalists: finalistsMarkup,
    deliberation: deliberationMarkup,
    results: resultsMarkup,
  }[state.view];

  app.innerHTML = `
    ${sidebarMarkup()}
    <section class="t-workspace">
      ${state.notice ? `<p class="a-workflow-note">${esc(state.notice)}</p>` : ""}
      ${viewMarkup()}
    </section>`;
  state.notice = null;
}

function activateView(view) {
  if (!viewUnlocked(view)) {
    state.notice = "That stage isn't open yet — the contest manager controls round progression.";
  } else {
    state.view = view;
    if (window.location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  }
  render();
}

async function loadContest(id) {
  state.contestId = id;
  localStorage.setItem("unblockedContestId", String(id));
  const res = await api(`/contests/${id}`);
  if (!res.ok) {
    gate("Error", "Couldn't load contest", res.body?.error || `HTTP ${res.status}`);
    return;
  }
  state.data = res.body;
  state.pendingRatings = {};
  state.r1Index = Math.max(0, state.data.submissions.findIndex((s) => !state.data.myVotes[s.id]));
  state.r2Index = 0;
  if (!viewUnlocked(state.view)) state.view = "dashboard";
  render();
}

async function submitVote(decision) {
  const sub = submissions()[state.r1Index];
  if (!sub) return;
  const res = await api(`/contests/${state.contestId}/votes`, {
    method: "POST",
    body: JSON.stringify({ submissionId: sub.id, decision }),
  });
  if (!res.ok) {
    state.notice = res.body?.error === "round1_not_active"
      ? "Round 1 has closed — the page will refresh."
      : "Couldn't save your decision. Try again.";
    if (res.body?.error === "round1_not_active") return loadContest(state.contestId);
    return render();
  }
  state.data.myVotes[sub.id] = decision;
  const next = submissions().findIndex((s) => !myVote(s.id));
  if (next !== -1) state.r1Index = next;
  render();
}

async function submitRatings(subId) {
  const ratings = state.pendingRatings[subId] || {};
  if (!ratingComplete(subId)) {
    state.notice = "Give every category a star rating before submitting.";
    return render();
  }
  const res = await api(`/contests/${state.contestId}/ratings`, {
    method: "POST",
    body: JSON.stringify({ submissionId: subId, ratings }),
  });
  if (!res.ok) {
    state.notice = "Couldn't save ratings. Try again.";
    return render();
  }
  state.data.myRatings[subId] = { ...ratings };
  const subs = advancedSubs();
  const next = subs.findIndex((s) => !savedRatingComplete(s.id));
  if (next !== -1) state.r2Index = next;
  render();
}

document.addEventListener("ub-navigate", (event) => {
  activateView(event.detail.view);
});

document.addEventListener("ub-rate", (event) => {
  const form = event.target.closest("[data-round-two-form]");
  if (!form) return;
  const subId = Number(form.dataset.submissionId);
  state.pendingRatings[subId] = state.pendingRatings[subId] || {};
  state.pendingRatings[subId][event.detail.criterion] = event.detail.value;
});

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view-target]");
  if (viewButton) {
    event.preventDefault();
    activateView(viewButton.dataset.viewTarget);
    return;
  }
  const openSubmission = event.target.closest("[data-open-submission]");
  if (openSubmission) {
    state.r1Index = Number(openSubmission.dataset.openSubmission);
    state.view = "round-one";
    render();
    return;
  }
  if (event.target.closest("[data-prev-submission]")) {
    if (state.r1Index > 0) { state.r1Index -= 1; render(); }
    return;
  }
  if (event.target.closest("[data-next-submission]")) {
    if (canOpenRoundOne(state.r1Index + 1)) { state.r1Index += 1; render(); }
    return;
  }
  if (event.target.closest("[data-swipe-left]")) { submitVote("no"); return; }
  if (event.target.closest("[data-swipe-right]")) { submitVote("yes"); return; }
  if (event.target.closest("[data-round-two-prev]")) { state.r2Index -= 1; render(); return; }
  if (event.target.closest("[data-round-two-next]")) { state.r2Index += 1; render(); return; }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-round-two-form]");
  if (!form) return;
  event.preventDefault();
  submitRatings(Number(form.dataset.submissionId));
});

document.addEventListener("change", (event) => {
  const picker = event.target.closest("[data-contest-picker]");
  if (picker) loadContest(Number(picker.value));
});

async function init() {
  const authError = new URLSearchParams(window.location.search).get("auth");
  const res = await api("/me");
  if (res.status === 401) {
    return loginGate(authError === "invalid"
      ? "That sign-in link is invalid or has expired — request a fresh one."
      : undefined);
  }
  if (res.status === 403) {
    return gate("No access", "You're not on a judging panel", `${res.body?.email || "This account"} hasn't been invited to any contest. Contact the contest manager if you were expecting access.`);
  }
  if (!res.ok) {
    return gate("Error", "Something went wrong", `The portal API returned HTTP ${res.status}. Try reloading.`);
  }

  state.me = res.body;
  state.contests = res.body.contests;

  if (["admin", "manager"].includes(state.me.user.role)) {
    // Toggle the attribute (not the .hidden DOM property) so this works
    // regardless of whether <ub-header-bar> has upgraded/rendered yet —
    // attributeChangedCallback re-renders it either way.
    document.querySelector("ub-header-bar")?.removeAttribute("other-hidden");
  }
  if (!state.contests.length) {
    return gate("No contests", "No active contests", state.me.user.role === "judge"
      ? "You're registered as a judge but not assigned to a contest yet."
      : "Create a contest in the Admin Console to get started.");
  }

  const remembered = Number(localStorage.getItem("unblockedContestId"));
  const initial = state.contests.find((ct) => ct.id === remembered) || state.contests[0];
  await loadContest(initial.id);

  const hashView = window.location.hash.replace("#", "");
  if (hashView && hashView !== state.view) activateView(hashView);
}

window.addEventListener("hashchange", () => {
  const view = window.location.hash.replace("#", "");
  if (view && view !== state.view) activateView(view);
});

init();
