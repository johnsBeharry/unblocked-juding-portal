/* Registers every UNBLOCKED (ub-*) custom element. Side-effect-only import —
   load this before portal.js/admin.js (classic scripts) so the tags they
   emit via innerHTML are upgraded automatically by the browser. */
import "./poster-thumb.js";
import "./status-tile.js";
import "./star-rating.js";
import "./nav-link.js";
import "./criteria-bar.js";
import "./header-bar.js";
import "./drawer.js";
import "./warning-modal.js";
