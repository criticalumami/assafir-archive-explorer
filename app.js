(() => {
  const API_BASE = "https://archive.assafir.com/api/entities";

  // State
  const state = {
    query: "",
    fromDate: "",
    toDate: "",
    pageSize: 24,
    pageNumber: 1,
    mode: "articles", // "articles" | "manifest"
    totalCount: 0,
    currentArticles: [],
    currentManifest: [],
  };

  // In-memory LRU-like cache for instant 0ms repeat queries
  const responseCache = new Map();
  let activeController = null;

  // DOM Elements
  const searchForm = document.getElementById("searchForm");
  const queryInput = document.getElementById("queryInput");
  const fromDateInput = document.getElementById("fromDate");
  const toDateInput = document.getElementById("toDate");
  const pageSizeSelect = document.getElementById("pageSizeSelect");
  const modeSelect = document.getElementById("modeSelect");
  const resetBtn = document.getElementById("resetBtn");
  const exportUrlsBtn = document.getElementById("exportUrlsBtn");

  const quickIssueDate = document.getElementById("quickIssueDate");
  const quickZipBtn = document.getElementById("quickZipBtn");
  const quickPage1Btn = document.getElementById("quickPage1Btn");

  const statusText = document.getElementById("statusText");
  const latencyBadge = document.getElementById("latencyBadge");
  const resultsContainer = document.getElementById("resultsContainer");

  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const pageIndicator = document.getElementById("pageIndicator");
  const paginationBottom = document.getElementById("paginationBottom");
  const prevPageBottomBtn = document.getElementById("prevPageBottomBtn");
  const nextPageBottomBtn = document.getElementById("nextPageBottomBtn");
  const pageIndicatorBottom = document.getElementById("pageIndicatorBottom");

  // Preview Dialog Elements
  const previewDialog = document.getElementById("previewDialog");
  const closeDialogBtn = document.getElementById("closeDialogBtn");
  const dialogTitle = document.getElementById("dialogTitle");
  const dialogMeta = document.getElementById("dialogMeta");
  const dialogDownloadPdf = document.getElementById("dialogDownloadPdf");
  const dialogDownloadZip = document.getElementById("dialogDownloadZip");
  const dialogEntities = document.getElementById("dialogEntities");
  const dialogContent = document.getElementById("dialogContent");
  const dialogScanImg = document.getElementById("dialogScanImg");
  const dialogOpenImage = document.getElementById("dialogOpenImage");

  // Export Dialog Elements
  const exportDialog = document.getElementById("exportDialog");
  const closeExportBtn = document.getElementById("closeExportBtn");
  const copyExportBtn = document.getElementById("copyExportBtn");
  const exportTextarea = document.getElementById("exportTextarea");

  // Light-dismiss fallback for browsers without native <dialog closedby="any"> support
  function attachLightDismissFallback(dialogEl) {
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialogEl.addEventListener("click", (event) => {
        if (event.target !== dialogEl) return;
        const rect = dialogEl.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialogEl.close();
      });
    }
  }
  attachLightDismissFallback(previewDialog);
  attachLightDismissFallback(exportDialog);

  closeDialogBtn.addEventListener("click", () => previewDialog.close());
  closeExportBtn.addEventListener("click", () => exportDialog.close());

  // Helpers for PDF / ZIP / Image URLs
  function getPdfFilename(article) {
    if (article.newPdfPath && article.newPdfPath.trim().length > 0) {
      return article.newPdfPath.trim();
    }
    if (article.oldPdfPath && article.oldPdfPath.trim().length > 0) {
      return article.oldPdfPath.trim();
    }
    return null;
  }

  function getPagePdfUrl(pdfName) {
    return `${API_BASE}/articles/raw/${encodeURIComponent(pdfName)}`;
  }

  function getIssueZipUrl(pdfName) {
    return `${API_BASE}/articles/raw-zip/${encodeURIComponent(pdfName)}`;
  }

  function getPageThumbUrl(pdfName, res = 400) {
    return `${API_BASE}/images/raw/${encodeURIComponent(pdfName)}/${res}`;
  }

  function formatPdfFilenameMeta(pdfName) {
    if (/^\d{10}\.pdf$/i.test(pdfName)) {
      const y = pdfName.slice(0, 4);
      const m = pdfName.slice(4, 6);
      const d = pdfName.slice(6, 8);
      const p = parseInt(pdfName.slice(8, 10), 10);
      return { dateStr: `${y}-${m}-${d}`, page: p };
    }
    return { dateStr: pdfName, page: null };
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightQuery(text, query) {
    const safe = escapeHtml(text);
    const trimmed = (query || "").trim();
    if (!trimmed) return safe;
    const words = trimmed
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return safe;
    const regex = new RegExp(`(${words.join("|")})`, "gi");
    return safe.replace(regex, "<mark>$1</mark>");
  }

  // Build Query String for API
  function buildApiUrl() {
    const params = new URLSearchParams();
    params.set("pageSize", state.mode === "manifest" ? "1" : String(state.pageSize));
    params.set("pageNumber", state.mode === "manifest" ? "1" : String(state.pageNumber));

    if (state.fromDate) params.set("fromDate", state.fromDate);
    if (state.toDate) params.set("toDate", state.toDate);

    const q = state.query.trim();
    if (state.mode === "manifest") {
      if (q) {
        return `${API_BASE}/articles/basic-elastic-search-with-grouping/${encodeURIComponent(q)}/newPdfPath/10000?${params.toString()}`;
      }
      return `${API_BASE}/articles/basic-elastic-search-with-grouping-no-val/newPdfPath/10000?${params.toString()}`;
    } else {
      if (q) {
        return `${API_BASE}/articles/basic-elastic-search-with-counts/${encodeURIComponent(q)}?${params.toString()}`;
      }
      return `${API_BASE}/articles/basic-elastic-search-with-counts-no-val?${params.toString()}`;
    }
  }

  // Execute Search
  async function executeSearch() {
    const url = buildApiUrl();

    if (activeController) {
      activeController.abort();
    }
    activeController = new AbortController();

    statusText.textContent = "Searching As-Safir archive...";
    latencyBadge.hidden = true;

    const t0 = performance.now();
    try {
      let data;
      let fromCache = false;

      if (responseCache.has(url)) {
        data = responseCache.get(url);
        fromCache = true;
      } else {
        const resp = await fetch(url, { signal: activeController.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        data = await resp.json();
        if (responseCache.size > 60) {
          const oldestKey = responseCache.keys().next().value;
          responseCache.delete(oldestKey);
        }
        responseCache.set(url, data);
      }

      const elapsed = Math.round(performance.now() - t0);
      latencyBadge.textContent = fromCache ? `0 ms (cached)` : `${elapsed} ms`;
      latencyBadge.hidden = false;

      if (state.mode === "manifest") {
        renderManifestResults(data);
      } else {
        renderArticleResults(data);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      statusText.textContent = `Error communicating with archive API: ${err.message}`;
      resultsContainer.innerHTML = "";
    }
  }

  // Render Detailed Article Cards
  function renderArticleResults(data) {
    const articles = Array.isArray(data.payload) ? data.payload : [];
    const globalCount = Number(data.globalCount || 0);
    state.totalCount = globalCount;
    state.currentArticles = articles;
    state.currentManifest = [];

    const totalPages = Math.max(1, Math.ceil(globalCount / state.pageSize));
    statusText.textContent = `Found ${globalCount.toLocaleString()} matching articles`;

    updatePaginationUI(totalPages, true);

    if (!articles.length) {
      resultsContainer.innerHTML = `<div class="result-card"><p>No articles found matching your criteria.</p></div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    articles.forEach((article, idx) => {
      const pdfName = getPdfFilename(article);
      const card = document.createElement("article");
      // Only defer rendering for off-screen cards outside the initial fold viewport (idx >= 6)
      card.className = idx >= 6 ? "result-card deferred-card" : "result-card";

      const dateFormatted = article.year && article.month && article.day
        ? `${article.year}-${String(article.month).padStart(2, "0")}-${String(article.day).padStart(2, "0")}`
        : (article.date ? article.date.split(",")[0] : "Unknown Date");

      const pageBadge = article.page ? `<span class="meta-pill">Page ${article.page}</span>` : "";
      const editionBadge = article.edition ? `<span class="meta-pill">Issue #${article.edition}</span>` : "";
      const topicBadge = article.topicName && article.topicName !== "UNKNOWN"
        ? `<span class="meta-pill" dir="auto">${escapeHtml(article.topicName)}</span>`
        : "";
      const authorBadge = article.authorName && article.authorName !== "UNKNOWN"
        ? `<span class="meta-pill" dir="auto">✍ ${escapeHtml(article.authorName)}</span>`
        : "";

      const snippetRaw = (article.content || "").slice(0, 260);
      const snippetHtml = highlightQuery(snippetRaw, state.query);
      const titleHtml = highlightQuery(article.title || "Untitled Article", state.query);

      const thumbHtml = pdfName
        ? `<div class="card-thumb-wrap" data-preview-idx="${idx}" title="Click to preview full text & newspaper scan">
             <img class="card-thumb" src="${getPageThumbUrl(pdfName, 400)}" alt="Page ${article.page || ""} thumbnail" loading="${idx < 6 ? "eager" : "lazy"}" />
           </div>`
        : "";

      const actionsHtml = pdfName
        ? `<div class="card-actions">
             <button type="button" class="btn btn-ghost btn-sm" data-preview-idx="${idx}">Read / Scan</button>
             <a href="${getPagePdfUrl(pdfName)}" class="btn btn-primary btn-sm" target="_blank" rel="noopener" title="Download this page PDF (${pdfName})">
               ⬇ Page PDF
             </a>
             <a href="${getIssueZipUrl(pdfName)}" class="btn btn-secondary btn-sm" target="_blank" rel="noopener" title="Download full daily newspaper issue as ZIP">
               ⬇ Issue ZIP
             </a>
           </div>`
        : `<span class="pdf-filename">No PDF linked</span>`;

      card.innerHTML = `
        <div class="card-top">
          ${thumbHtml}
          <div class="card-body">
            <div class="card-meta-badges">
              <span class="meta-pill date-pill">${escapeHtml(dateFormatted)}</span>
              ${pageBadge}
              ${editionBadge}
              ${topicBadge}
              ${authorBadge}
            </div>
            <h3 class="card-title" dir="auto" data-preview-idx="${idx}">${titleHtml}</h3>
            <p class="card-snippet" dir="auto">${snippetHtml}</p>
          </div>
        </div>
        <div class="card-footer">
          <span class="pdf-filename">${pdfName ? escapeHtml(pdfName) : ""}</span>
          ${actionsHtml}
        </div>
      `;

      fragment.appendChild(card);
    });

    resultsContainer.replaceChildren(fragment);
  }

  // Render Fast PDF Manifest Mode (Up to 10,000 unique PDFs from Elasticsearch aggregation)
  function renderManifestResults(data) {
    const buckets =
      data?.payload?.aggregations?.["sterms#newPdfPath"]?.buckets || [];
    const validBuckets = buckets
      .filter((b) => b && b.key)
      .sort((a, b) => b.key.localeCompare(a.key));

    state.currentManifest = validBuckets;
    state.currentArticles = [];
    state.totalCount = validBuckets.length;

    // Count unique daily issues
    const uniqueDates = new Set(
      validBuckets.map((b) => b.key.slice(0, 8)).filter((d) => /^\d{8}$/.test(d))
    );

    statusText.textContent = `Loaded ${validBuckets.length.toLocaleString()} unique Page PDFs across ${uniqueDates.size.toLocaleString()} daily issues (Click "Export URLs" for bulk CLI download)`;
    updatePaginationUI(1, false);

    if (!validBuckets.length) {
      resultsContainer.innerHTML = `<div class="result-card"><p>No PDF pages found for this filter.</p></div>`;
      return;
    }

    // Render top 400 in DOM for instant interactivity; full 10,000 available in Export URLs
    const displayBuckets = validBuckets.slice(0, 400);
    const fragment = document.createDocumentFragment();

    displayBuckets.forEach((b, idx) => {
      const pdfName = b.key;
      const { dateStr, page } = formatPdfFilenameMeta(pdfName);
      const card = document.createElement("div");
      card.className = idx >= 12 ? "manifest-card deferred-card" : "manifest-card";

      card.innerHTML = `
        <div class="manifest-info">
          <span class="manifest-date">${escapeHtml(dateStr)} ${page ? `&bull; Page ${page}` : ""}</span>
          <span class="manifest-sub">${escapeHtml(pdfName)} &bull; ${b.doc_count} matching article(s)</span>
        </div>
        <div class="card-actions">
          <a href="${getPagePdfUrl(pdfName)}" class="btn btn-primary btn-sm" target="_blank" rel="noopener">
            ⬇ PDF
          </a>
          <a href="${getIssueZipUrl(pdfName)}" class="btn btn-secondary btn-sm" target="_blank" rel="noopener">
            ⬇ Issue ZIP
          </a>
        </div>
      `;
      fragment.appendChild(card);
    });

    resultsContainer.replaceChildren(fragment);
  }

  function updatePaginationUI(totalPages, showPagination) {
    if (!showPagination) {
      prevPageBtn.disabled = true;
      nextPageBtn.disabled = true;
      pageIndicator.textContent = "Manifest (All)";
      paginationBottom.hidden = true;
      return;
    }

    const canPrev = state.pageNumber > 1;
    const canNext = state.pageNumber < totalPages;

    prevPageBtn.disabled = !canPrev;
    nextPageBtn.disabled = !canNext;
    prevPageBottomBtn.disabled = !canPrev;
    nextPageBottomBtn.disabled = !canNext;

    const label = `Page ${state.pageNumber.toLocaleString()} of ${totalPages.toLocaleString()}`;
    pageIndicator.textContent = label;
    pageIndicatorBottom.textContent = label;
    paginationBottom.hidden = totalPages <= 1;
  }

  // Open Article & Scan Preview Modal
  function openArticlePreview(idx) {
    const article = state.currentArticles[idx];
    if (!article) return;

    const pdfName = getPdfFilename(article);
    dialogTitle.textContent = article.title || "Untitled Article";

    const dateFormatted = article.year && article.month && article.day
      ? `${article.year}-${String(article.month).padStart(2, "0")}-${String(article.day).padStart(2, "0")}`
      : (article.date || "");

    const metaParts = [
      dateFormatted,
      article.edition ? `Issue #${article.edition}` : "",
      article.page ? `Page ${article.page}` : "",
      article.authorName && article.authorName !== "UNKNOWN" ? `Author: ${article.authorName}` : "",
      pdfName ? `File: ${pdfName}` : "",
    ].filter(Boolean);
    dialogMeta.textContent = metaParts.join("  •  ");

    if (pdfName) {
      dialogDownloadPdf.href = getPagePdfUrl(pdfName);
      dialogDownloadZip.href = getIssueZipUrl(pdfName);
      dialogDownloadPdf.hidden = false;
      dialogDownloadZip.hidden = false;

      const highResScan = getPageThumbUrl(pdfName, 1200);
      dialogScanImg.src = highResScan;
      dialogOpenImage.href = highResScan;
    } else {
      dialogDownloadPdf.hidden = true;
      dialogDownloadZip.hidden = true;
      dialogScanImg.removeAttribute("src");
    }

    // Entities
    const entities = Array.isArray(article.entities) ? article.entities : [];
    dialogEntities.innerHTML = entities
      .slice(0, 12)
      .map((e) => `<span class="meta-pill" dir="auto">${escapeHtml(e.name)}</span>`)
      .join("");

    dialogContent.innerHTML = highlightQuery(article.content || "No OCR text available.", state.query);
    previewDialog.showModal();
  }

  // Delegate clicks on result cards for preview modal
  resultsContainer.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-preview-idx]");
    if (!trigger) return;
    const idx = Number(trigger.getAttribute("data-preview-idx"));
    openArticlePreview(idx);
  });

  // Form & Filter Event Listeners
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    state.query = queryInput.value;
    state.fromDate = fromDateInput.value;
    state.toDate = toDateInput.value;
    state.pageSize = Number(pageSizeSelect.value);
    state.mode = modeSelect.value;
    state.pageNumber = 1;
    executeSearch();
  });

  [fromDateInput, toDateInput, pageSizeSelect, modeSelect].forEach((el) => {
    el.addEventListener("change", () => {
      state.query = queryInput.value;
      state.fromDate = fromDateInput.value;
      state.toDate = toDateInput.value;
      state.pageSize = Number(pageSizeSelect.value);
      state.mode = modeSelect.value;
      state.pageNumber = 1;
      executeSearch();
    });
  });

  resetBtn.addEventListener("click", () => {
    queryInput.value = "";
    fromDateInput.value = "";
    toDateInput.value = "";
    pageSizeSelect.value = "24";
    modeSelect.value = "articles";
    state.query = "";
    state.fromDate = "";
    state.toDate = "";
    state.pageSize = 24;
    state.mode = "articles";
    state.pageNumber = 1;
    executeSearch();
  });

  // Preset Chips
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      queryInput.value = chip.dataset.query || "";
      fromDateInput.value = chip.dataset.from || "";
      toDateInput.value = chip.dataset.to || "";
      state.query = queryInput.value;
      state.fromDate = fromDateInput.value;
      state.toDate = toDateInput.value;
      state.pageNumber = 1;
      executeSearch();
    });
  });

  // Pagination Buttons
  function changePage(delta) {
    state.pageNumber = Math.max(1, state.pageNumber + delta);
    executeSearch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  prevPageBtn.addEventListener("click", () => changePage(-1));
  nextPageBtn.addEventListener("click", () => changePage(1));
  prevPageBottomBtn.addEventListener("click", () => changePage(-1));
  nextPageBottomBtn.addEventListener("click", () => changePage(1));

  // Quick Direct Date Issue Downloader in Topbar
  function getQuickDatePrefix() {
    const val = quickIssueDate.value;
    if (!val) return null;
    return val.replace(/-/g, "");
  }

  quickZipBtn.addEventListener("click", () => {
    const ymd = getQuickDatePrefix();
    if (!ymd) return;
    window.open(getIssueZipUrl(`${ymd}01.pdf`), "_blank", "noopener");
  });

  quickPage1Btn.addEventListener("click", () => {
    const ymd = getQuickDatePrefix();
    if (!ymd) return;
    window.open(getPagePdfUrl(`${ymd}01.pdf`), "_blank", "noopener");
  });

  // Bulk URL Export Dialog
  function updateExportTextarea() {
    const exportType = document.querySelector('input[name="exportType"]:checked')?.value || "pdf";
    let pdfNames = [];

    if (state.mode === "manifest" && state.currentManifest.length) {
      pdfNames = state.currentManifest.map((b) => b.key);
    } else if (state.currentArticles.length) {
      pdfNames = [...new Set(state.currentArticles.map(getPdfFilename).filter(Boolean))];
    }

    if (exportType === "zip") {
      const byDate = new Map();
      for (const name of pdfNames) {
        const prefix = name.slice(0, 8);
        if (/^\d{8}$/.test(prefix) && !byDate.has(prefix)) {
          byDate.set(prefix, getIssueZipUrl(name));
        }
      }
      exportTextarea.value = [...byDate.values()].join("\n");
    } else {
      exportTextarea.value = pdfNames.map((n) => getPagePdfUrl(n)).join("\n");
    }
  }

  exportUrlsBtn.addEventListener("click", () => {
    updateExportTextarea();
    exportDialog.showModal();
  });

  document.querySelectorAll('input[name="exportType"]').forEach((radio) => {
    radio.addEventListener("change", updateExportTextarea);
  });

  copyExportBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(exportTextarea.value);
    const orig = copyExportBtn.textContent;
    copyExportBtn.textContent = "✓ Copied!";
    setTimeout(() => {
      copyExportBtn.textContent = orig;
    }, 1500);
  });

  // Initial load
  executeSearch();
})();
