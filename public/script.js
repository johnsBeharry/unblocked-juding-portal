const ownershipSubmissions = [
  {
    id: "OWN-001",
    title: "The Locked Garden",
    artist: "Elena Moretti",
    country: "Italy",
    age: 29,
    className: "ownership-01",
    rationale: "A private garden is drawn as a public promise sealed behind a lock. The poster questions whether beauty can be owned when the community is kept outside its walls."
  },
  {
    id: "OWN-002",
    title: "Terms & Conditions",
    artist: "Jonas Weber",
    country: "Germany",
    age: 34,
    className: "ownership-02",
    rationale: "A receipt-like composition turns platform language into a visual contract. The work asks how much we really own when every file, profile, and memory depends on permission."
  },
  {
    id: "OWN-003",
    title: "Borrowed Identity",
    artist: "Maya Okonkwo",
    country: "Nigeria",
    age: 26,
    className: "ownership-03",
    rationale: "The face is split by data marks and a surveillance eye. It frames identity as something both deeply personal and constantly extracted by systems we do not control."
  },
  {
    id: "OWN-004",
    title: "Keys Without Doors",
    artist: "Nora El-Amin",
    country: "Egypt",
    age: 31,
    className: "ownership-04",
    rationale: "A chain of oversized keys points toward no entrance. The poster explores symbolic possession: having access tokens, passwords, and proof without real agency."
  },
  {
    id: "OWN-005",
    title: "The Receipt",
    artist: "Theo Grant",
    country: "United Kingdom",
    age: 37,
    className: "ownership-05",
    rationale: "A stamped circle floats over a receipt that cannot name what was bought. It studies ownership as paperwork, proof, and the fragile rituals around value."
  },
  {
    id: "OWN-006",
    title: "Not Yours Anymore",
    artist: "Clara Park",
    country: "South Korea",
    age: 24,
    className: "ownership-06",
    rationale: "Streaming bars and a red cancel mark turn entertainment into disappearance. The work critiques subscription culture and the quiet replacement of ownership with temporary access."
  },
  {
    id: "OWN-007",
    title: "Inheritance Loop",
    artist: "Sofia Alvarez",
    country: "Mexico",
    age: 32,
    className: "ownership-07",
    rationale: "The poster uses circular family-map forms to ask what can be inherited: land, language, debt, memory, or obligation. Ownership becomes a loop rather than a transaction."
  },
  {
    id: "OWN-008",
    title: "Seed Phrase",
    artist: "Mila Novak",
    country: "Serbia",
    age: 27,
    className: "ownership-08",
    rationale: "Fragmented words form a private key around a sealed circle. The poster treats self-custody as both liberation and burden: if you own it, you must protect it."
  },
  {
    id: "OWN-009",
    title: "Museum of Deleted Things",
    artist: "Ari Chen",
    country: "Canada",
    age: 30,
    className: "ownership-09",
    rationale: "Stacked white blocks become an archive with missing labels. The poster asks who owns digital memory when platforms can erase, compress, or rename the past."
  },
  {
    id: "OWN-010",
    title: "Landline",
    artist: "Leah Mensah",
    country: "Ghana",
    age: 28,
    className: "ownership-10",
    rationale: "A map-grid and dashed circle collide to question land, borders, and belonging. The work presents ownership as a political line drawn over lived relationships."
  }
];

const storageKey = "unblockedJudgePortalStateV6";
const roundTwoCategories = ["Theme Relevance", "Concept", "Execution", "Creativity"];

function initJudgePortal() {
  if (!document.body.classList.contains("judge-portal-page")) {
    return;
  }

  if (document.body.dataset.portalReady === "true") {
    return;
  }

  document.body.dataset.portalReady = "true";

  if (new URLSearchParams(window.location.search).has("reset")) {
    localStorage.removeItem(storageKey);
  }

  const views = document.querySelectorAll("[data-view]");
  const submissionGrid = document.querySelector("[data-submission-grid]");
  const roundTwoContent = document.querySelector("[data-round-two-content]");
  const finalistsContent = document.querySelector("[data-finalists-content]");
  const deliberationContent = document.querySelector("[data-deliberation-content]");
  const resultsContent = document.querySelector("[data-results-content]");
  const deliberationMarkup = deliberationContent.innerHTML;
  const state = loadState();

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      if (stored && typeof stored === "object") {
        return {
          activeView: stored.activeView || "dashboard",
          activeIndex: Number(stored.activeIndex) || 0,
          roundTwoIndex: Number(stored.roundTwoIndex) || 0,
          roundOne: stored.roundOne || {},
          roundTwo: stored.roundTwo || {},
          roundOnePromptDismissed: Boolean(stored.roundOnePromptDismissed),
          roundOneLocked: Boolean(stored.roundOneLocked)
        };
      }
    } catch (error) {
      localStorage.removeItem(storageKey);
    }

    return {
      activeView: "dashboard",
      activeIndex: 0,
      roundTwoIndex: 0,
      roundOne: {},
      roundTwo: {},
      roundOnePromptDismissed: false,
      roundOneLocked: false
    };
  }

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function roundOneCount() {
    return Object.keys(state.roundOne).length;
  }

  function isRoundOneComplete() {
    return roundOneCount() === ownershipSubmissions.length;
  }

  function advancingIndexes() {
    return ownershipSubmissions
      .map((_, index) => index)
      .filter((index) => state.roundOne[index]?.decision === "yes");
  }

  function isRoundTwoOpen() {
    return isRoundOneComplete() && advancingIndexes().length > 0;
  }

  function isRoundTwoComplete() {
    const advancing = advancingIndexes();
    return advancing.length > 0 && advancing.every((index) => Boolean(state.roundTwo[index]));
  }

  function enterRoundTwo() {
    if (!isRoundTwoOpen()) {
      activateView("dashboard");
      return;
    }

    state.roundOneLocked = true;
    state.roundOnePromptDismissed = true;
    state.roundTwoIndex = 0;
    saveState();
    activateView("round-two");
  }

  function firstOpenRoundOneIndex() {
    const next = ownershipSubmissions.findIndex((_, index) => !state.roundOne[index]);
    return next === -1 ? ownershipSubmissions.length - 1 : next;
  }

  function canOpenRoundOne(index) {
    return isRoundOneComplete() || Boolean(state.roundOne[index]) || Number(index) <= firstOpenRoundOneIndex();
  }

  function posterMarkup(submission, extraClass = "") {
    return `<div class="poster-art ${extraClass} ${submission.className}"><span>${submission.title}</span></div>`;
  }

  function roundTwoAverage(index) {
    const rating = state.roundTwo[index];
    if (!rating) {
      return null;
    }

    const total = roundTwoCategories.reduce((sum, category) => sum + Number(rating[category] || 0), 0);
    return total / roundTwoCategories.length;
  }

  function rankedSubmissions() {
    return advancingIndexes()
      .map((index) => ({
        ...ownershipSubmissions[index],
        index,
        average: roundTwoAverage(index)
      }))
      .filter((submission) => submission.average !== null)
      .sort((a, b) => b.average - a.average);
  }

  function requiresLockedView(viewName) {
    if (viewName === "round-two") {
      return !isRoundTwoOpen();
    }

    if (["finalists", "deliberation", "results"].includes(viewName)) {
      return !isRoundTwoComplete();
    }

    return false;
  }

  function activateView(viewName, options = {}) {
    if (requiresLockedView(viewName)) {
      showLockNotice(viewName);
      viewName = "dashboard";
    }

    if (viewName === "round-two") {
      state.roundOneLocked = true;
      state.roundOnePromptDismissed = true;
    }

    state.activeView = viewName;
    saveState();

    views.forEach((view) => {
      view.classList.toggle("is-active", view.dataset.view === viewName);
    });

    document.querySelectorAll(".portal-nav button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
    });

    const nextUrl = `#${viewName}`;
    if (!options.skipHistory && window.location.hash !== nextUrl) {
      history.replaceState(null, "", nextUrl);
    }

    renderAll();
  }

  function showLockNotice(viewName) {
    let notice = document.querySelector("[data-lock-notice]");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "lock-notice";
      notice.dataset.lockNotice = "true";
      document.querySelector(".portal-workspace").prepend(notice);
    }

    if (viewName === "round-two") {
      notice.textContent = isRoundOneComplete()
        ? "Round 2 needs at least one Yes from Round 1."
        : `Round 2 opens after all 10 Yes/No decisions. ${ownershipSubmissions.length - roundOneCount()} remaining.`;
      return;
    }

    notice.textContent = "Final ranking unlocks after every Round 2 poster has 10-star category ratings.";
  }

  function clearLockNotice() {
    document.querySelector("[data-lock-notice]")?.remove();
  }

  function renderDashboardStatus() {
    const roundOneDone = isRoundOneComplete();
    const roundTwoDone = isRoundTwoComplete();
    const roundTwoOpen = isRoundTwoOpen();
    const yesCount = advancingIndexes().length;
    document.querySelector("[data-current-round]").textContent = roundTwoDone
      ? "Results Ready"
      : state.roundOneLocked && roundTwoOpen
        ? "Round 2 Active"
        : roundTwoOpen
          ? "Round 2 Ready"
          : roundOneDone
            ? "Round 1 Complete"
            : "Round 1 Active";
    document.querySelector("[data-current-round-note]").textContent = roundOneDone
      ? yesCount > 0
        ? state.roundOneLocked
          ? `${yesCount} poster${yesCount === 1 ? "" : "s"} advanced. Round 1 decisions are now locked.`
          : `${yesCount} poster${yesCount === 1 ? "" : "s"} received Yes. You can still revise decisions before starting Round 2.`
        : "No posters received Yes. Change a Round 1 decision to open Round 2."
      : "Swipe left for No or right for Yes. Your Yes decisions move to Round 2.";
    document.querySelector("[data-round-two-status]").textContent = roundTwoOpen ? (state.roundOneLocked ? "Open" : "Ready") : "Locked";
    document.querySelector("[data-round-two-note]").textContent = roundTwoOpen
      ? "Rate each advancing poster with 10-star categories."
      : roundOneDone
        ? "Round 2 needs at least one Yes decision."
        : `Complete ${ownershipSubmissions.length - roundOneCount()} more Round 1 decisions to open ratings.`;
    document.querySelector("[data-results-status]").textContent = roundTwoDone ? "Calculated" : "Hidden";
    document.querySelector("[data-results-note]").textContent = roundTwoDone
      ? "Final ranking is based on Round 2 category star ratings."
      : "Results appear only after all Round 2 ratings are submitted.";
  }

  function renderLocks() {
    document.querySelectorAll("[data-requires-complete]").forEach((button) => {
      const locked = requiresLockedView(button.dataset.viewTarget);
      button.classList.toggle("is-locked", locked);
      button.setAttribute("aria-disabled", String(locked));
    });
  }

  function renderSubmissionGrid() {
    submissionGrid.innerHTML = ownershipSubmissions.map((submission, index) => {
      const locked = !canOpenRoundOne(index);
      const decision = state.roundOne[index]?.decision;
      const status = decision ? (state.roundOneLocked ? (decision === "yes" ? "Yes locked" : "No locked") : decision === "yes" ? "Yes" : "No") : locked ? "Locked" : "Ready";
      return `
        <article class="submission-card ${decision ? "is-reviewed" : ""} ${locked ? "is-locked" : ""} ${state.activeIndex === index ? "is-active" : ""}">
          <button type="button" data-open-submission="${index}" ${locked ? "disabled" : ""}>
            ${posterMarkup(submission, "poster-thumb")}
            <span class="submission-card-body">
              <strong>${submission.title}</strong>
              <span>${submission.artist}, ${submission.country}</span>
              <span class="mini-status">${status}</span>
            </span>
          </button>
        </article>
      `;
    }).join("");
  }

  function renderRoundOnePanel() {
    if (!canOpenRoundOne(state.activeIndex)) {
      state.activeIndex = firstOpenRoundOneIndex();
      saveState();
    }

    const submission = ownershipSubmissions[state.activeIndex];
    const decision = state.roundOne[state.activeIndex]?.decision;
    document.querySelector("[data-position-label]").textContent = `${state.activeIndex + 1} of ${ownershipSubmissions.length}`;
    document.querySelector("[data-review-title]").textContent = submission.title;
    document.querySelector("[data-poster-title]").textContent = submission.title;
    document.querySelector("[data-poster-art]").className = `poster-art ${submission.className}`;
    document.querySelector("[data-swipe-card]").classList.toggle("swiped-left", decision === "no");
    document.querySelector("[data-swipe-card]").classList.toggle("swiped-right", decision === "yes");
    document.querySelector("[data-prev-submission]").disabled = state.activeIndex === 0;
    document.querySelector("[data-next-submission]").disabled = !canOpenRoundOne(state.activeIndex + 1);
    document.querySelector("[data-swipe-left]").disabled = state.roundOneLocked;
    document.querySelector("[data-swipe-right]").disabled = state.roundOneLocked;
    const workflowNote = document.querySelector("[data-workflow-note]");
    workflowNote.hidden = isRoundOneComplete() && !state.roundOneLocked;
    workflowNote.textContent = state.roundOneLocked
      ? "Round 1 is locked because Round 2 has started. You can still review your decisions."
      : isRoundOneComplete()
        ? ""
        : `Swipe poster ${firstOpenRoundOneIndex() + 1}. Left is No; right is Yes.`;
  }

  function renderReviewedCounts() {
    document.querySelectorAll("[data-reviewed-count]").forEach((node) => {
      node.textContent = roundOneCount();
    });
  }

  function renderRoundTwo() {
    if (!isRoundOneComplete()) {
      roundTwoContent.innerHTML = lockedPanel("Round 2 is closed", "Complete all 10 Yes/No decisions in Round 1 first.");
      return;
    }

    const advancing = advancingIndexes();
    if (advancing.length === 0) {
      roundTwoContent.innerHTML = lockedPanel("No posters advanced", "Round 2 needs at least one Yes decision.");
      return;
    }

    const activeAdvancingIndex = Math.max(0, Math.min(state.roundTwoIndex, advancing.length - 1));
    state.roundTwoIndex = activeAdvancingIndex;
    const submissionIndex = advancing[activeAdvancingIndex];
    const submission = ownershipSubmissions[submissionIndex];
    const ratings = state.roundTwo[submissionIndex] || {};

    roundTwoContent.innerHTML = `
      <div class="review-header">
        <div>
          <p class="eyebrow">Round 2</p>
          <h1>Category Ratings</h1>
        </div>
        <div class="review-tools">
          <button class="ghost-button" type="button" data-round-two-prev ${activeAdvancingIndex === 0 ? "disabled" : ""}>Previous</button>
          <strong>${activeAdvancingIndex + 1} of ${advancing.length}</strong>
          <button class="ghost-button" type="button" data-round-two-next ${activeAdvancingIndex === advancing.length - 1 ? "disabled" : ""}>Next</button>
        </div>
      </div>
      <article class="round-two-rating-panel">
        <div class="poster-stage">${posterMarkup(submission, "")}</div>
        <form class="star-rating-form" data-round-two-form data-submission-index="${submissionIndex}">
          <div class="submission-meta">
            <span>${submission.id}</span>
            <h2>${submission.title}</h2>
            <p>Round 2 ratings only. Rate each category out of 10 stars.</p>
          </div>
          <div class="designer-context" aria-label="Designer and poster context">
            <div>
              <span class="context-kicker">Designer</span>
              <div class="designer-summary">
                <p><span>Name</span><strong>${submission.artist}</strong></p>
                <p><span>Country</span><strong>${submission.country}</strong></p>
                <p><span>Age</span><strong>${submission.age}</strong></p>
              </div>
            </div>
            <div class="poster-description">
              <span class="context-kicker">Poster description</span>
              <p>${submission.rationale}</p>
            </div>
          </div>
          <div class="star-category-list">
            ${roundTwoCategories.map((category) => starCategoryMarkup(category, ratings[category] || 0)).join("")}
          </div>
          <button class="primary-button" type="submit">Submit ratings</button>
        </form>
      </article>
    `;
  }

  function starCategoryMarkup(category, selected) {
    return `
      <fieldset class="star-category" data-star-category="${category}">
        <legend>${category}</legend>
        <div class="star-buttons">
          ${Array.from({ length: 10 }, (_, index) => {
            const value = index + 1;
            return `<button class="star-button ${value <= selected ? "is-selected" : ""}" type="button" data-star-value="${value}" aria-label="${category} ${value} out of 10">${value <= selected ? "★" : "☆"}</button>`;
          }).join("")}
        </div>
      </fieldset>
    `;
  }

  function renderFinalists() {
    if (!isRoundTwoComplete()) {
      finalistsContent.innerHTML = lockedPanel("Finalists are hidden", "Submit all Round 2 star ratings to calculate the ranking.");
      return;
    }

    finalistsContent.innerHTML = `<div class="ranking-list">${rankingMarkup()}</div>`;
  }

  function renderDeliberation() {
    if (!isRoundTwoComplete()) {
      deliberationContent.innerHTML = lockedPanel("Deliberation is locked", "Finish every Round 2 category rating first.");
      return;
    }

    deliberationContent.innerHTML = deliberationMarkup;
  }

  function renderResults() {
    if (!isRoundTwoComplete()) {
      resultsContent.innerHTML = lockedPanel("Results are not available yet", "Results calculate after every Round 2 poster has category star ratings.");
      return;
    }

    const winners = rankedSubmissions().slice(0, 3);
    resultsContent.innerHTML = `
      <div class="winner-grid">
        ${winners.map((submission, index) => `
          <article>
            <span>${ordinal(index + 1)} Place</span>
            <strong>${submission.title}</strong>
            <small>${submission.artist}, ${submission.country} · ${submission.average.toFixed(1)}/10</small>
          </article>
        `).join("")}
      </div>
      <section class="archive-card">
        <h2>Calculated Ranking</h2>
        <p>These results come from Round 2 star ratings across Theme Relevance, Concept, Execution, and Creativity.</p>
        <button class="ghost-button" type="button" data-view-target="finalists">View full ranking</button>
      </section>
    `;
  }

  function renderRoundOnePopup() {
    const existingPopup = document.querySelector("[data-round-one-popup]");
    const shouldShow = state.activeView === "round-one" && isRoundOneComplete() && !state.roundOneLocked && !state.roundOnePromptDismissed;

    if (!shouldShow) {
      existingPopup?.remove();
      return;
    }

    const yesCount = advancingIndexes().length;
    const popup = existingPopup || document.createElement("div");
    popup.className = "portal-popup-backdrop";
    popup.dataset.roundOnePopup = "true";
    popup.innerHTML = `
      <article class="portal-popup" role="dialog" aria-modal="true" aria-labelledby="round-one-complete-title">
        <span>Round 1 complete</span>
        <h2 id="round-one-complete-title">${yesCount > 0 ? "Round 2 is ready" : "No posters advanced"}</h2>
        <p>${yesCount > 0
          ? `${yesCount} poster${yesCount === 1 ? "" : "s"} received Yes and ${yesCount === 1 ? "is" : "are"} ready for 10-star category ratings.`
          : "All posters received No, so Round 2 will stay closed for now."}</p>
        <div class="popup-actions">
          <button class="ghost-button" type="button" data-dismiss-round-one-popup>Stay here</button>
          <button class="primary-button" type="button" data-start-round-two>${yesCount > 0 ? "Start Round 2" : "Back to dashboard"}</button>
        </div>
      </article>
    `;

    if (!existingPopup) {
      document.querySelector(".portal-workspace").append(popup);
    }
  }

  function rankingMarkup() {
    return rankedSubmissions().map((submission, index) => `
      <article class="ranking-row">
        <span>${String(index + 1).padStart(2, "0")}</span>
        ${posterMarkup(submission, "queue-thumb")}
        <div>
          <strong>${submission.title}</strong>
          <p>${submission.artist}, ${submission.country}</p>
        </div>
        <strong class="ranking-score">${submission.average.toFixed(1)}</strong>
      </article>
    `).join("");
  }

  function lockedPanel(title, text) {
    return `
      <article class="locked-panel">
        <span>Locked</span>
        <h2>${title}</h2>
        <p>${text}</p>
        <button class="primary-button" type="button" data-view-target="round-one">Continue Round 1</button>
      </article>
    `;
  }

  function ordinal(number) {
    return number === 1 ? "1st" : number === 2 ? "2nd" : "3rd";
  }

  function openSubmission(index) {
    const submissionIndex = Number(index);
    if (!canOpenRoundOne(submissionIndex)) {
      showLockNotice("round-one");
      return;
    }

    clearLockNotice();
    state.activeIndex = submissionIndex;
    saveState();
    activateView("round-one");
  }

  function moveSubmission(direction) {
    const targetIndex = state.activeIndex + direction;
    if (targetIndex < 0 || targetIndex >= ownershipSubmissions.length || !canOpenRoundOne(targetIndex)) {
      return;
    }

    openSubmission(targetIndex);
  }

  function submitRoundOneDecision(decision) {
    if (state.roundOneLocked) {
      return;
    }

    const wasRoundOneComplete = isRoundOneComplete();
    state.roundOne[state.activeIndex] = { decision };
    const card = document.querySelector("[data-swipe-card]");
    card.classList.toggle("swiped-left", decision === "no");
    card.classList.toggle("swiped-right", decision === "yes");

    const next = ownershipSubmissions.findIndex((_, index) => !state.roundOne[index]);
    state.activeIndex = next === -1 ? state.activeIndex : next;
    if (!wasRoundOneComplete && next === -1) {
      state.roundOnePromptDismissed = false;
    }
    saveState();

    if (isRoundOneComplete()) {
      state.roundTwoIndex = 0;
      activateView("round-one");
    } else {
      activateView("round-one");
    }
  }

  function setupSwipeGestures() {
    const card = document.querySelector("[data-swipe-card]");
    let startX = 0;
    let currentX = 0;
    let dragging = false;

    card.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      currentX = 0;
      card.setPointerCapture?.(event.pointerId);
      card.classList.add("is-dragging");
    });

    card.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }

      currentX = event.clientX - startX;
      const rotate = Math.max(-8, Math.min(8, currentX / 18));
      card.style.transform = `translateX(${currentX}px) rotate(${rotate}deg)`;
    });

    card.addEventListener("pointerup", () => {
      if (!dragging) {
        return;
      }

      dragging = false;
      card.classList.remove("is-dragging");
      card.style.transform = "";

      if (currentX <= -90) {
        submitRoundOneDecision("no");
      } else if (currentX >= 90) {
        submitRoundOneDecision("yes");
      }
    });

    card.addEventListener("pointercancel", () => {
      dragging = false;
      card.classList.remove("is-dragging");
      card.style.transform = "";
    });
  }

  function renderAll() {
    renderDashboardStatus();
    renderLocks();
    renderSubmissionGrid();
    renderRoundOnePanel();
    renderReviewedCounts();
    renderRoundTwo();
    renderFinalists();
    renderDeliberation();
    renderResults();
    renderRoundOnePopup();

    if (isRoundTwoComplete()) {
      clearLockNotice();
    }
  }

  document.addEventListener("click", (event) => {
    const resetButton = event.target.closest("[data-reset-portal]");
    if (resetButton) {
      localStorage.removeItem(storageKey);
      state.activeView = "dashboard";
      state.activeIndex = 0;
      state.roundTwoIndex = 0;
      state.roundOne = {};
      state.roundTwo = {};
      state.roundOnePromptDismissed = false;
      state.roundOneLocked = false;
      clearLockNotice();
      activateView("dashboard");
      return;
    }

    const viewButton = event.target.closest("[data-view-target]");
    if (viewButton) {
      event.preventDefault();
      activateView(viewButton.dataset.viewTarget);
      return;
    }

    const submissionButton = event.target.closest("[data-open-submission]");
    if (submissionButton) {
      openSubmission(submissionButton.dataset.openSubmission);
      return;
    }

    if (event.target.closest("[data-prev-submission]")) {
      moveSubmission(-1);
      return;
    }

    if (event.target.closest("[data-next-submission]")) {
      moveSubmission(1);
      return;
    }

    if (event.target.closest("[data-swipe-left]")) {
      submitRoundOneDecision("no");
      return;
    }

    if (event.target.closest("[data-swipe-right]")) {
      submitRoundOneDecision("yes");
      return;
    }

    const starButton = event.target.closest("[data-star-value]");
    if (starButton) {
      const fieldset = starButton.closest("[data-star-category]");
      fieldset.dataset.selected = starButton.dataset.starValue;
      fieldset.querySelectorAll("[data-star-value]").forEach((button) => {
        const selected = Number(button.dataset.starValue) <= Number(starButton.dataset.starValue);
        button.classList.toggle("is-selected", selected);
        button.textContent = selected ? "★" : "☆";
      });
      return;
    }

    if (event.target.closest("[data-round-two-prev]")) {
      state.roundTwoIndex = Math.max(0, state.roundTwoIndex - 1);
      saveState();
      renderRoundTwo();
      return;
    }

    if (event.target.closest("[data-round-two-next]")) {
      state.roundTwoIndex = Math.min(advancingIndexes().length - 1, state.roundTwoIndex + 1);
      saveState();
      renderRoundTwo();
      return;
    }

    if (event.target.closest("[data-dismiss-round-one-popup]")) {
      state.roundOnePromptDismissed = true;
      saveState();
      renderRoundOnePopup();
      return;
    }

    if (event.target.closest("[data-start-round-two]")) {
      enterRoundTwo();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.querySelector("[data-round-one-popup]")) {
      return;
    }

    state.roundOnePromptDismissed = true;
    saveState();
    renderRoundOnePopup();
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-round-two-form]");
    if (!form) {
      return;
    }

    event.preventDefault();
    const submissionIndex = Number(form.dataset.submissionIndex);
    const ratings = {};
    let complete = true;
    form.querySelectorAll("[data-star-category]").forEach((fieldset) => {
      const selected = Number(fieldset.dataset.selected || 0);
      if (!selected) {
        complete = false;
      }
      ratings[fieldset.dataset.starCategory] = selected;
    });

    if (!complete) {
      showLockNotice("results");
      return;
    }

    state.roundTwo[submissionIndex] = ratings;
    const nextUnrated = advancingIndexes().findIndex((index) => !state.roundTwo[index]);
    state.roundTwoIndex = nextUnrated === -1 ? state.roundTwoIndex : nextUnrated;
    saveState();

    if (isRoundTwoComplete()) {
      activateView("finalists");
    } else {
      activateView("round-two");
    }
  });

  function syncViewFromHash() {
    const hashView = window.location.hash.replace("#", "");
    if (hashView && document.querySelector(`[data-view="${hashView}"]`)) {
      activateView(hashView, { skipHistory: true });
    } else {
      activateView(state.activeView || "dashboard", { skipHistory: true });
    }
  }

  renderAll();
  setupSwipeGestures();
  syncViewFromHash();
  window.addEventListener("hashchange", syncViewFromHash);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initJudgePortal);
} else {
  initJudgePortal();
}
