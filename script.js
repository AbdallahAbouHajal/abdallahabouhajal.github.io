// script.js — full drop-in

document.addEventListener("DOMContentLoaded", () => {
  // ====== Existing UI logic ======
  const hamburger = document.querySelector(".hamburger");
  const navMenu = document.querySelector(".nav-menu");
  const readMoreLinks = document.querySelectorAll(".read-more");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const closeLightboxButton = document.querySelector(".lightbox .close");

  // why: guard in case elements are missing on some pages
  if (hamburger && navMenu) {
    hamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      navMenu.classList.toggle("show");
      hamburger.classList.toggle("active");
    });
    document.addEventListener("click", (e) => {
      if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) {
        navMenu.classList.remove("show");
        hamburger.classList.remove("active");
      }
    });
  }

  readMoreLinks.forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      const longDescription = this.previousElementSibling;
      if (longDescription.style.display === "none" || longDescription.style.display === "") {
        longDescription.style.display = "block";
        this.textContent = "Read less";
      } else {
        longDescription.style.display = "none";
        this.textContent = "Read more";
      }
    });
  });

  // Lightbox (kept global opener)
  window.openLightbox = function (imgElement) {
    if (!lightbox || !lightboxImg || !lightboxCaption) return;
    lightboxImg.src = imgElement.src;
    if (imgElement.classList.contains("gallery-pic")) {
      const captionText = imgElement.nextElementSibling ? imgElement.nextElementSibling.textContent : "";
      lightboxCaption.textContent = captionText;
      lightboxCaption.style.display = "block";
    } else {
      lightboxCaption.style.display = "none";
    }
    lightbox.style.display = "block";
  };
  if (closeLightboxButton && lightbox) {
    closeLightboxButton.addEventListener("click", () => (lightbox.style.display = "none"));
    lightbox.addEventListener("click", (e) => {
      if (e.target !== lightboxImg) lightbox.style.display = "none";
    });
  }

  // ====== NEW: citation badges + totals ======

  // inject tiny CSS (why: avoid editing styles.css)
  (function injectCiteBadgeCSS() {
    const css = `
      .cite-badge{display:inline-flex;align-items:center;font-size:.85rem;padding:.15rem .45rem;border:1px solid #e5e7eb;border-radius:999px;margin-left:.5rem}
      .cite-badge .dot{width:.4rem;height:.4rem;border-radius:50%;display:inline-block;margin-right:.35rem}
    `;
    const tag = document.createElement("style");
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  function extractDOI(url) {
    try {
      const u = new URL(url);
      if (u.hostname === "doi.org" || u.hostname.endsWith(".doi.org")) {
        return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
      }
      const doiParam = u.searchParams.get("doi") || u.searchParams.get("DOI");
      if (doiParam) return decodeURIComponent(doiParam);
      const m = url.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
      return m ? m[0] : null;
    } catch {
      return null;
    }
  }

  async function fetchOpenAlexCitations(doi) {
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("OpenAlex error");
    const j = await r.json();
    if (j && typeof j.cited_by_count === "number") return j.cited_by_count;
    throw new Error("OpenAlex missing count");
  }

  async function fetchSemanticScholarCitations(doi) {
    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(
      doi
    )}?fields=citationCount`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("SemScholar error");
    const j = await r.json();
    if (j && typeof j.citationCount === "number") return j.citationCount;
    throw new Error("SemScholar missing count");
  }

  async function getCitations(doi) {
    try {
      return await fetchOpenAlexCitations(doi);
    } catch {
      try {
        return await fetchSemanticScholarCitations(doi);
      } catch {
        return null; // graceful fail
      }
    }
  }

  function computeHIndex(counts) {
    const sorted = counts.slice().sort((a, b) => b - a);
    let h = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] >= i + 1) h = i + 1;
      else break;
    }
    return h;
  }

  function addBadge(container, count) {
    const badge = document.createElement("span");
    badge.className = "cite-badge";
    const dot = document.createElement("span");
    dot.className = "dot";
    // why: simple visual cue
    const c = Math.min(1, (count || 0) / 50);
    const gray = Math.round(200 - 120 * c);
    dot.style.background = `rgb(${gray},${gray},${gray})`;
    badge.appendChild(dot);
    badge.appendChild(
      document.createTextNode(count == null ? "Citations: N/A" : `Citations: ${count}`)
    );

    const h3 = container.querySelector("h3");
    if (h3) h3.appendChild(badge);
    else container.appendChild(badge);
  }

  async function hydratePublications() {
    const blocks = Array.from(document.querySelectorAll(".publication-container"));
    if (!blocks.length) return;

    const counts = [];
    for (const block of blocks) {
      const btn = block.querySelector("a.publication-button");
      if (!btn) {
        addBadge(block, null);
        continue;
      }
      const doi = extractDOI(btn.href);
      if (!doi) {
        addBadge(block, null);
        continue;
      }
      let count = null;
      try {
        count = await getCitations(doi);
      } catch {
        count = null;
      }
      addBadge(block, count);
      if (typeof count === "number") counts.push(count);
    }

    // Optional totals (add spans with these IDs anywhere, e.g., on index.html)
    const totalPublications = blocks.length;
    const totalCitations = counts.reduce((a, b) => a + b, 0);
    const hIndex = computeHIndex(counts);

    const elPubs = document.getElementById("total-publications");
    const elCites = document.getElementById("total-citations");
    const elH = document.getElementById("h-index");
    if (elPubs) elPubs.textContent = String(totalPublications);
    if (elCites) elCites.textContent = String(totalCitations);
    if (elH) elH.textContent = String(hIndex);
  }

  // Run on every page; no-ops if no publications
  hydratePublications();
});
