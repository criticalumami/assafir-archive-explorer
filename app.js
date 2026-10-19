(() => {
  const API_BASE = "https://archive.assafir.com/api/entities";

  // State
  const state = {
    query: "",
    fromDate: "",
    toDate: "",
    sortBy: "relevance",
    order: "DESC",
    view: "thumbs", // "thumbs" | "cards"
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
  const sortSelect = document.getElementById("sortSelect");
  const viewSelect = document.getElementById("viewSelect");
  const viewThumbsBtn = document.getElementById("viewThumbsBtn");
  const viewCardsBtn = document.getElementById("viewCardsBtn");
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

  function getPageThumbUrl(pdfName, res = 600) {
    return `${API_BASE}/images/raw/${encodeURIComponent(pdfName)}/${res}`;
  }

  /**
   * Opens a PDF inline in a new browser tab instead of downloading it.
   */
  async function openPdfInNewTab(pdfName) {
    const rawUrl = getPagePdfUrl(pdfName);
    const tab = window.open("", "_blank");
    if (!tab) {
      window.open(rawUrl, "_blank", "noopener");
      return;
    }

    tab.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(pdfName)} // saf(1)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0c0c0c;
      color: #d8d8d8;
      font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
      font-size: 13px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .bar {
      background: #141414;
      border-bottom: 1px solid #2e2e2e;
      height: 28px;
      padding: 0 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .tag { background: #d8d8d8; color: #0c0c0c; font-weight: 700; padding: 1px 6px; margin-right: 8px; }
    .btn {
      color: #d8d8d8;
      background: #0c0c0c;
      border: 1px solid #2e2e2e;
      padding: 1px 8px;
      text-decoration: none;
      font-size: 12px;
    }
    .btn:hover { background: #d8d8d8; color: #0c0c0c; }
    #viewer { flex: 1; width: 100%; border: 0; background: #1a1a1a; }
    #loader { padding: 24px; color: #999; }
  </style>
</head>
<body>
  <div class="bar">
    <div><span class="tag">pdf</span><span>${escapeHtml(pdfName)}</span> <span id="prog" style="color:#7a7a7a;margin-left:8px;">streaming...</span></div>
    <div><a id="dlLink" class="btn" href="${escapeHtml(rawUrl)}" download="${escapeHtml(pdfName)}">[save.pdf]</a></div>
  </div>
  <div id="loader">fetching ${escapeHtml(pdfName)} from archive.assafir.com...</div>
</body>
</html>`);
    tab.document.close();

    try {
      const resp = await fetch(rawUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body ? resp.body.getReader() : null;
      const progEl = tab.document.getElementById("prog");
      let blob;

      if (reader) {
        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (progEl) {
            progEl.textContent = `${(received / (1024 * 1024)).toFixed(2)} MB`;
          }
        }
        blob = new Blob(chunks, { type: "application/pdf" });
      } else {
        const buf = await resp.arrayBuffer();
        if (progEl) {
          progEl.textContent = `${(buf.byteLength / (1024 * 1024)).toFixed(2)} MB`;
        }
        blob = new Blob([buf], { type: "application/pdf" });
      }

      const blobUrl = URL.createObjectURL(blob);
      const dlLink = tab.document.getElementById("dlLink");
      if (dlLink) dlLink.href = blobUrl;

      const loader = tab.document.getElementById("loader");
      if (loader) loader.remove();

      const embed = tab.document.createElement("embed");
      embed.id = "viewer";
      embed.type = "application/pdf";
      embed.src = blobUrl;
      tab.document.body.appendChild(embed);
    } catch (err) {
      const loader = tab.document.getElementById("loader");
      if (loader) {
        loader.textContent = `err loading inline pdf (${err.message}). redirecting to direct stream...`;
      }
      tab.location.href = rawUrl;
    }
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

  // Sync View Toggle UI
  function syncViewToggleUI() {
    viewSelect.value = state.view;
    if (state.view === "thumbs") {
      viewThumbsBtn.classList.add("btn-invert");
      viewCardsBtn.classList.remove("btn-invert");
      resultsContainer.className = "results-thumbs";
    } else {
      viewCardsBtn.classList.add("btn-invert");
      viewThumbsBtn.classList.remove("btn-invert");
      resultsContainer.className = "results-list";
    }
  }

  function parseSortSelection() {
    const raw = sortSelect.value || "relevance:DESC";
    const [sortBy, order] = raw.split(":");
    state.sortBy = sortBy || "relevance";
    state.order = order || "DESC";
  }

  // Build Query String for API
  function buildApiUrl() {
    const params = new URLSearchParams();
    params.set("pageSize", state.mode === "manifest" ? "1" : String(state.pageSize));
    params.set("pageNumber", state.mode === "manifest" ? "1" : String(state.pageNumber));
    params.set("sortBy", state.sortBy);
    params.set("order", state.order);

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
    parseSortSelection();
    syncViewToggleUI();
    const url = buildApiUrl();

    if (activeController) {
      activeController.abort();
    }
    activeController = new AbortController();

    statusText.textContent = "querying index...";
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
      latencyBadge.textContent = fromCache ? `0ms [cache]` : `${elapsed}ms`;
      latencyBadge.hidden = false;

      if (state.mode === "manifest") {
        const buckets =
          data?.payload?.aggregations?.["sterms#newPdfPath"]?.buckets || [];
        state.currentManifest = buckets.filter((b) => b && b.key);
        state.currentArticles = [];
        renderCurrentState();
      } else {
        state.currentArticles = Array.isArray(data.payload) ? data.payload : [];
        state.totalCount = Number(data.globalCount || 0);
        state.currentManifest = [];
        renderCurrentState();
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      statusText.textContent = `err: ${err.message}`;
      resultsContainer.innerHTML = "";
    }
  }

  // Re-render current results in 0ms when toggling between Thumbnails and Cards
  function renderCurrentState() {
    syncViewToggleUI();
    if (state.mode === "manifest") {
      renderManifestResults();
    } else if (state.view === "thumbs") {
      renderArticleThumbnails();
    } else {
      renderArticleCards();
    }
  }

  // Render View 1: Thumbnail Gallery Grid (Default)
  function renderArticleThumbnails() {
    const articles = state.currentArticles;
    const globalCount = state.totalCount;

    const totalPages = Math.max(1, Math.ceil(globalCount / state.pageSize));
    statusText.textContent = `hits: ${globalCount.toLocaleString()}`;
    updatePaginationUI(totalPages, true);

    if (!articles.length) {
      resultsContainer.innerHTML = `<div class="result-card"><p>0 results.</p></div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    articles.forEach((article, idx) => {
      const pdfName = getPdfFilename(article);
      const tile = document.createElement("article");
      tile.className = idx >= 10 ? "thumb-tile deferred-card" : "thumb-tile";

      const dateFormatted = article.year && article.month && article.day
        ? `${article.year}-${String(article.month).padStart(2, "0")}-${String(article.day).padStart(2, "0")}`
        : (article.date ? article.date.split(",")[0] : "n/a");

      const pageStr = article.page ? `p.${String(article.page).padStart(2, "0")}` : "";
      const editionStr = article.edition ? `#${article.edition}` : "";
      const metaRight = [pageStr, editionStr].filter(Boolean).join(" ");
      const titleText = article.title || pdfName || "untitled";

      const imgHtml = pdfName
        ? `<div class="thumb-tile-img-wrap" data-preview-idx="${idx}" title="${escapeHtml(titleText)}">
             <img class="thumb-tile-img" src="${getPageThumbUrl(pdfName, 600)}" alt="${escapeHtml(dateFormatted)} ${escapeHtml(pageStr)}" loading="${idx < 10 ? "eager" : "lazy"}" />
           </div>`
        : `<div class="thumb-tile-img-wrap" data-preview-idx="${idx}"><div style="padding:12px;color:#7a7a7a">no scan</div></div>`;

      const footerHtml = pdfName
        ? `<div class="thumb-tile-footer">
             <button type="button" class="btn" data-preview-idx="${idx}">[read]</button>
             <a href="${getPagePdfUrl(pdfName)}" data-open-pdf="${escapeHtml(pdfName)}" class="btn btn-invert" target="_blank" rel="noopener" title="Open ${escapeHtml(pdfName)} in new tab">[page.pdf]</a>
             <a href="${getIssueZipUrl(pdfName)}" class="btn" target="_blank" rel="noopener" title="Download full daily issue as ZIP">[issue.zip]</a>
           </div>`
        : `<div class="thumb-tile-footer"><span class="pdf-filename">no-pdf</span></div>`;

      tile.innerHTML = `
        <div class="thumb-tile-header">
          <span class="thumb-tile-date">${escapeHtml(dateFormatted)}</span>
          <span class="thumb-tile-page">${escapeHtml(metaRight)}</span>
        </div>
        ${imgHtml}
        <div class="thumb-tile-caption" dir="auto" data-preview-idx="${idx}" title="${escapeHtml(titleText)}">${highlightQuery(titleText, state.query)}</div>
        ${footerHtml}
      `;

      fragment.appendChild(tile);
    });

    resultsContainer.replaceChildren(fragment);
  }

  // Render View 2: Detailed Article Cards
  function renderArticleCards() {
    const articles = state.currentArticles;
    const globalCount = state.totalCount;

    const totalPages = Math.max(1, Math.ceil(globalCount / state.pageSize));
    statusText.textContent = `hits: ${globalCount.toLocaleString()}`;
    updatePaginationUI(totalPages, true);

    if (!articles.length) {
      resultsContainer.innerHTML = `<div class="result-card"><p>0 results.</p></div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    articles.forEach((article, idx) => {
      const pdfName = getPdfFilename(article);
      const card = document.createElement("article");
      card.className = idx >= 6 ? "result-card deferred-card" : "result-card";

      const dateFormatted = article.year && article.month && article.day
        ? `${article.year}-${String(article.month).padStart(2, "0")}-${String(article.day).padStart(2, "0")}`
        : (article.date ? article.date.split(",")[0] : "n/a");

      const pageBadge = article.page ? `<span class="meta-pill">p.${String(article.page).padStart(2, "0")}</span>` : "";
      const editionBadge = article.edition ? `<span class="meta-pill">#${article.edition}</span>` : "";
      const topicBadge = article.topicName && article.topicName !== "UNKNOWN"
        ? `<span class="meta-pill" dir="auto">${escapeHtml(article.topicName)}</span>`
        : "";
      const authorBadge = article.authorName && article.authorName !== "UNKNOWN"
        ? `<span class="meta-pill" dir="auto">${escapeHtml(article.authorName)}</span>`
        : "";

      const snippetRaw = (article.content || "").slice(0, 380);
      const snippetHtml = highlightQuery(snippetRaw, state.query);
      const titleHtml = highlightQuery(article.title || "untitled", state.query);

      const thumbHtml = pdfName
        ? `<div class="card-thumb-wrap" data-preview-idx="${idx}" title="view scan &amp; ocr">
             <img class="card-thumb" src="${getPageThumbUrl(pdfName, 600)}" alt="p.${article.page || ""}" loading="${idx < 6 ? "eager" : "lazy"}" />
           </div>`
        : "";

      const actionsHtml = pdfName
        ? `<div class="card-actions">
             <button type="button" class="btn" data-preview-idx="${idx}">[read]</button>
             <a href="${getPagePdfUrl(pdfName)}" data-open-pdf="${escapeHtml(pdfName)}" class="btn btn-invert" target="_blank" rel="noopener" title="Open page PDF (${pdfName}) in a new tab">[page.pdf]</a>
             <a href="${getIssueZipUrl(pdfName)}" class="btn" target="_blank" rel="noopener" title="Download full daily issue as ZIP">[issue.zip]</a>
           </div>`
        : `<span class="pdf-filename">no-pdf</span>`;

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

  // Render Fast PDF Manifest Mode (Supports both Thumbs & List)
  function renderManifestResults() {
    const validBuckets = [...state.currentManifest];

    if (state.sortBy === "date") {
      validBuckets.sort((a, b) =>
        state.order === "ASC"
          ? a.key.localeCompare(b.key)
          : b.key.localeCompare(a.key)
      );
    } else {
      validBuckets.sort((a, b) => b.doc_count - a.doc_count);
    }

    state.totalCount = validBuckets.length;

    const uniqueDates = new Set(
      validBuckets.map((b) => b.key.slice(0, 8)).filter((d) => /^\d{8}$/.test(d))
    );

    statusText.textContent = `manifest: ${validBuckets.length.toLocaleString()} pdfs / ${uniqueDates.size.toLocaleString()} issues (use [export-urls] for full list)`;
    updatePaginationUI(1, false);

    if (!validBuckets.length) {
      resultsContainer.innerHTML = `<div class="result-card"><p>0 pdfs found.</p></div>`;
      return;
    }

    const displayBuckets = validBuckets.slice(0, state.view === "thumbs" ? 120 : 400);
    const fragment = document.createDocumentFragment();

    displayBuckets.forEach((b, idx) => {
      const pdfName = b.key;
      const { dateStr, page } = formatPdfFilenameMeta(pdfName);

      if (state.view === "thumbs") {
        const tile = document.createElement("div");
        tile.className = idx >= 10 ? "thumb-tile deferred-card" : "thumb-tile";
        tile.innerHTML = `
          <div class="thumb-tile-header">
            <span class="thumb-tile-date">${escapeHtml(dateStr)}</span>
            <span class="thumb-tile-page">${page ? `p.${String(page).padStart(2, "0")}` : ""} (${b.doc_count})</span>
          </div>
          <div class="thumb-tile-img-wrap" data-open-pdf="${escapeHtml(pdfName)}" title="Open ${escapeHtml(pdfName)} in new tab">
            <img class="thumb-tile-img" src="${getPageThumbUrl(pdfName, 600)}" alt="${escapeHtml(pdfName)}" loading="${idx < 10 ? "eager" : "lazy"}" />
          </div>
          <div class="thumb-tile-footer">
            <a href="${getPagePdfUrl(pdfName)}" data-open-pdf="${escapeHtml(pdfName)}" class="btn btn-invert" target="_blank" rel="noopener">[page.pdf]</a>
            <a href="${getIssueZipUrl(pdfName)}" class="btn" target="_blank" rel="noopener">[issue.zip]</a>
          </div>
        `;
        fragment.appendChild(tile);
      } else {
        const card = document.createElement("div");
        card.className = idx >= 12 ? "manifest-card deferred-card" : "manifest-card";
        card.innerHTML = `
          <div class="manifest-info">
            <span class="manifest-date">${escapeHtml(dateStr)} ${page ? `// p.${String(page).padStart(2, "0")}` : ""}</span>
            <span class="manifest-sub">${escapeHtml(pdfName)} (${b.doc_count} articles)</span>
          </div>
          <div class="card-actions">
            <a href="${getPagePdfUrl(pdfName)}" data-open-pdf="${escapeHtml(pdfName)}" class="btn btn-invert" target="_blank" rel="noopener">[page.pdf]</a>
            <a href="${getIssueZipUrl(pdfName)}" class="btn" target="_blank" rel="noopener">[issue.zip]</a>
          </div>
        `;
        fragment.appendChild(card);
      }
    });

    resultsContainer.replaceChildren(fragment);
  }

  function updatePaginationUI(totalPages, showPagination) {
    if (!showPagination) {
      prevPageBtn.disabled = true;
      nextPageBtn.disabled = true;
      pageIndicator.textContent = "all";
      paginationBottom.hidden = true;
      return;
    }

    const canPrev = state.pageNumber > 1;
    const canNext = state.pageNumber < totalPages;

    prevPageBtn.disabled = !canPrev;
    nextPageBtn.disabled = !canNext;
    prevPageBottomBtn.disabled = !canPrev;
    nextPageBottomBtn.disabled = !canNext;

    const label = `${state.pageNumber}/${totalPages.toLocaleString()}`;
    pageIndicator.textContent = label;
    pageIndicatorBottom.textContent = label;
    paginationBottom.hidden = totalPages <= 1;
  }

  // Open Article & Scan Preview Modal
  function openArticlePreview(idx) {
    const article = state.currentArticles[idx];
    if (!article) return;

    const pdfName = getPdfFilename(article);
    dialogTitle.textContent = article.title || "untitled";

    const dateFormatted = article.year && article.month && article.day
      ? `${article.year}-${String(article.month).padStart(2, "0")}-${String(article.day).padStart(2, "0")}`
      : (article.date || "");

    const metaParts = [
      dateFormatted,
      article.edition ? `#${article.edition}` : "",
      article.page ? `p.${article.page}` : "",
      article.authorName && article.authorName !== "UNKNOWN" ? article.authorName : "",
      pdfName || "",
    ].filter(Boolean);
    dialogMeta.textContent = metaParts.join(" | ");

    if (pdfName) {
      dialogDownloadPdf.href = getPagePdfUrl(pdfName);
      dialogDownloadPdf.setAttribute("data-open-pdf", pdfName);
      dialogDownloadZip.href = getIssueZipUrl(pdfName);
      dialogDownloadPdf.hidden = false;
      dialogDownloadZip.hidden = false;

      const highResScan = getPageThumbUrl(pdfName, 1200);
      dialogScanImg.src = highResScan;
      dialogOpenImage.href = highResScan;
    } else {
      dialogDownloadPdf.hidden = true;
      dialogDownloadZip.hidden = true;
      dialogDownloadPdf.removeAttribute("data-open-pdf");
      dialogScanImg.removeAttribute("src");
    }

    const entities = Array.isArray(article.entities) ? article.entities : [];
    dialogEntities.innerHTML = entities
      .slice(0, 12)
      .map((e) => `<span class="meta-pill" dir="auto">${escapeHtml(e.name)}</span>`)
      .join("");

    dialogContent.innerHTML = highlightQuery(article.content || "no ocr text.", state.query);
    previewDialog.showModal();
  }

  // Delegate clicks on result cards for preview modal & inline PDF tab viewer
  document.addEventListener("click", (e) => {
    const pdfTrigger = e.target.closest("[data-open-pdf]");
    if (pdfTrigger) {
      e.preventDefault();
      const pdfName = pdfTrigger.getAttribute("data-open-pdf");
      if (pdfName) openPdfInNewTab(pdfName);
      return;
    }

    const previewTrigger = e.target.closest("[data-preview-idx]");
    if (previewTrigger && resultsContainer.contains(previewTrigger)) {
      const idx = Number(previewTrigger.getAttribute("data-preview-idx"));
      openArticlePreview(idx);
    }
  });

  // View Switching (0ms client-side re-render, no network fetch needed)
  function setViewMode(newView) {
    if (state.view === newView) return;
    state.view = newView;
    renderCurrentState();
  }

  viewSelect.addEventListener("change", () => setViewMode(viewSelect.value));
  viewThumbsBtn.addEventListener("click", () => setViewMode("thumbs"));
  viewCardsBtn.addEventListener("click", () => setViewMode("cards"));

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

  [fromDateInput, toDateInput, sortSelect, pageSizeSelect, modeSelect].forEach((el) => {
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
    sortSelect.value = "relevance:DESC";
    viewSelect.value = "thumbs";
    pageSizeSelect.value = "24";
    modeSelect.value = "articles";
    state.query = "";
    state.fromDate = "";
    state.toDate = "";
    state.sortBy = "relevance";
    state.order = "DESC";
    state.view = "thumbs";
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
    window.scrollTo({ top: 0, behavior: "instant" });
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
    openPdfInNewTab(`${ymd}01.pdf`);
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
    copyExportBtn.textContent = "[yanked]";
    setTimeout(() => {
      copyExportBtn.textContent = orig;
    }, 1200);
  });

  // Initial load
  executeSearch();
})();
