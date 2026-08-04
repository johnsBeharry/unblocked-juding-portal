import { escapeHtml } from "./util.js";

/* <ub-poster-thumb src file-type title variant art-seed>
   Renders the image/video/PDF-link/generative-art frame used everywhere a
   poster appears. variant is a sizing hook: "thumb" (dashboard/admin card),
   "queue" (small ranking-row thumb), or "stage" (full review poster). */
class UbPosterThumb extends HTMLElement {
  static get observedAttributes() {
    return ["src", "file-type", "title", "variant", "art-seed"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const src = this.getAttribute("src") || "";
    const fileType = this.getAttribute("file-type") || "";
    const title = this.getAttribute("title") || "";
    const variant = this.getAttribute("variant") || "thumb";
    const seed = Number(this.getAttribute("art-seed") || 0);

    this.className = `a-poster-thumb a-poster-thumb--${variant}`;

    if (src && fileType.startsWith("image/")) {
      this.classList.add("a-poster-thumb--photo");
      this.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" loading="lazy">`;
      return;
    }
    if (src && fileType === "video/mp4") {
      this.classList.add("a-poster-thumb--photo");
      this.innerHTML = `<video src="${escapeHtml(src)}" controls muted playsinline></video>`;
      return;
    }
    if (src && fileType === "application/pdf") {
      this.classList.add("a-poster-thumb--pdf");
      this.innerHTML = `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">Open PDF<span>${escapeHtml(title)}</span></a>`;
      return;
    }
    const artClass = `ownership-${String((((seed % 10) + 10) % 10) + 1).padStart(2, "0")}`;
    this.classList.add("a-poster-thumb--art", artClass);
    this.innerHTML = `<span class="a-poster-thumb__label">${escapeHtml(title)}</span>`;
  }
}

customElements.define("ub-poster-thumb", UbPosterThumb);
