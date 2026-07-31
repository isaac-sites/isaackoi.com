(() => {
  "use strict";

  const catalogue = window.IsaacKoiCatalogue;
  if (!catalogue) return;

  const statsElement = document.getElementById("timeline-stats");
  const explanationElement = document.getElementById("timeline-explanation");
  const modeInput = document.getElementById("timeline-mode");
  const collectionInput = document.getElementById("timeline-collection");
  const decadeInput = document.getElementById("timeline-decade");
  const queryInput = document.getElementById("timeline-query");
  const statusElement = document.getElementById("timeline-status");
  const resultsElement = document.getElementById("timeline-results");
  const loadMoreButton = document.getElementById("load-more-timeline");
  const errorElement = document.getElementById("timeline-error");

  let collections = [];
  let issues = [];
  let documentRows = [];
  let visibleCount = 120;
  const initialParams = new URLSearchParams(window.location.search);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function collectionYear(collection) {
    const parsed = Date.parse(collection.indexed_at_utc || "");
    return Number.isFinite(parsed) ? new Date(parsed).getUTCFullYear() : null;
  }

  function rowsForMode() {
    if (modeInput.value === "indexing") {
      return collections.map(collection => {
        const year = collectionYear(collection);
        return year ? {year, collection, provenance: "exact_indexing_date"} : null;
      }).filter(Boolean);
    }
    return documentRows;
  }

  function filteredRows() {
    const collectionId = collectionInput.value;
    const decade = Number.parseInt(decadeInput.value || "", 10);
    const query = queryInput.value.trim().toLocaleLowerCase();
    return rowsForMode()
      .filter(row => {
        const rowCollection = row.issue?.collection_id || row.collection?.id || "";
        if (collectionId && rowCollection !== collectionId) return false;
        if (Number.isInteger(decade) && Math.floor(row.year / 10) * 10 !== decade) return false;
        if (!query) return true;
        const text = row.issue
          ? `${row.issue.title || ""} ${row.issue.series || ""} ${row.issue.collection_title || ""}`
          : `${row.collection.title || ""} ${row.collection.id || ""}`;
        return text.toLocaleLowerCase().includes(query);
      })
      .sort((left, right) => right.year - left.year
        || String(left.issue?.title || left.collection?.title || "").localeCompare(String(right.issue?.title || right.collection?.title || "")));
  }

  function documentEntry(row) {
    const issue = row.issue;
    const provenance = row.provenance === "catalogue_field"
      ? "Explicit catalogue document year"
      : "Year parsed from title or filename";
    return `<article class="timeline-entry">
      <div><span class="timeline-provenance">${escapeHtml(provenance)}</span><h3><a href="${escapeHtml(catalogue.documentUrl(issue))}">${escapeHtml(issue.title || issue.filename || issue.document_id)}</a></h3></div>
      <p>${escapeHtml([issue.collection_title, issue.series].filter(Boolean).join(" · "))}</p>
      <div class="timeline-entry-actions"><a href="${escapeHtml(catalogue.documentUrl(issue))}">Document details</a><a href="${escapeHtml(catalogue.searchUrl({collection: issue.collection_id, query: issue.title || ""}))}">Find in search</a></div>
    </article>`;
  }

  function indexingEntry(row) {
    const collection = row.collection;
    const date = new Intl.DateTimeFormat("en-GB", {dateStyle: "long", timeZone: "UTC"}).format(new Date(collection.indexed_at_utc));
    return `<article class="timeline-entry">
      <div><span class="timeline-provenance exact-date">Exact collection-indexing date</span><h3><a href="${escapeHtml(catalogue.collectionsUrl(collection.id))}">${escapeHtml(collection.title || collection.id)}</a></h3></div>
      <p>${escapeHtml(date)} · ${Number(collection.issue_count || 0).toLocaleString()} PDFs · ${Number(collection.series_count || collection.series?.length || 0).toLocaleString()} series</p>
      <div class="timeline-entry-actions"><a href="${escapeHtml(catalogue.collectionsUrl(collection.id))}">Browse collection</a><a href="${escapeHtml(catalogue.searchUrl({collection: collection.id}))}">Search collection</a></div>
    </article>`;
  }

  function renderRows(rows) {
    const groups = new Map();
    rows.forEach(row => {
      if (!groups.has(row.year)) groups.set(row.year, []);
      groups.get(row.year).push(row);
    });
    return [...groups.entries()].map(([year, yearRows]) => `
      <section class="timeline-year" aria-labelledby="timeline-year-${year}">
        <div class="timeline-year-heading"><h2 id="timeline-year-${year}">${year}</h2><span>${yearRows.length.toLocaleString()} entr${yearRows.length === 1 ? "y" : "ies"}</span></div>
        <div class="timeline-year-entries">${yearRows.map(modeInput.value === "indexing" ? indexingEntry : documentEntry).join("")}</div>
      </section>`).join("");
  }

  function renderStats() {
    const datedDocuments = documentRows.length;
    const explicitDocuments = documentRows.filter(row => row.provenance === "catalogue_field").length;
    const parsedDocuments = datedDocuments - explicitDocuments;
    const undated = Math.max(0, issues.length - datedDocuments);
    const indexedCollections = collections.filter(collection => collectionYear(collection)).length;
    statsElement.innerHTML = [
      [datedDocuments, "documents with a usable year"],
      [parsedDocuments, "title/filename-derived"],
      [explicitDocuments, "explicit document years"],
      [undated, "documents without a usable year"],
      [indexedCollections, "collections with indexing dates"],
    ].map(([value, label]) => `<span><strong>${Number(value).toLocaleString()}</strong><small>${escapeHtml(label)}</small></span>`).join("");
  }

  function populateFilters() {
    collectionInput.insertAdjacentHTML("beforeend", collections
      .slice()
      .sort((left, right) => left.title.localeCompare(right.title))
      .map(collection => `<option value="${escapeHtml(collection.id)}">${escapeHtml(collection.title)}</option>`).join(""));
    const decades = [...new Set([
      ...documentRows.map(row => Math.floor(row.year / 10) * 10),
      ...collections.map(collectionYear).filter(Boolean).map(year => Math.floor(year / 10) * 10),
    ])]
      .sort((left, right) => right - left);
    decadeInput.insertAdjacentHTML("beforeend", decades.map(decade => `<option value="${decade}">${decade}s</option>`).join(""));
    modeInput.value = initialParams.get("mode") === "indexing" ? "indexing" : "documents";
    const requestedCollection = initialParams.get("collection") || "";
    if ([...collectionInput.options].some(option => option.value === requestedCollection)) collectionInput.value = requestedCollection;
    const requestedDecade = initialParams.get("decade") || "";
    if ([...decadeInput.options].some(option => option.value === requestedDecade)) decadeInput.value = requestedDecade;
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    if (modeInput.value !== "documents") url.searchParams.set("mode", modeInput.value);
    if (collectionInput.value) url.searchParams.set("collection", collectionInput.value);
    if (decadeInput.value) url.searchParams.set("decade", decadeInput.value);
    window.history.replaceState({}, "", url);
  }

  function render() {
    const rows = filteredRows();
    const visible = rows.slice(0, visibleCount);
    resultsElement.innerHTML = visible.length ? renderRows(visible) : `<p class="empty-state">No timeline entries match these filters.</p>`;
    loadMoreButton.hidden = visible.length >= rows.length;
    statusElement.textContent = `Showing ${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} matching ${modeInput.value === "documents" ? "documents" : "collection indexing events"}.`;
    explanationElement.textContent = modeInput.value === "documents"
      ? "Document years are parsed from catalogue titles or filenames unless an explicit document-year field exists. They are not incident dates."
      : "These are exact dates when collection packages were indexed for the public search catalogue. They are not document, publication, release, or incident dates.";
    updateUrl();
  }

  function showError(error) {
    document.documentElement.dataset.archiveTimelineState = "error";
    statusElement.textContent = "";
    resultsElement.innerHTML = "";
    errorElement.hidden = false;
    errorElement.querySelector("p").textContent = error.message || "The public archive timeline could not be loaded.";
  }

  [modeInput, collectionInput, decadeInput].forEach(input => input.addEventListener("change", () => {
    visibleCount = 120;
    render();
  }));
  queryInput.addEventListener("input", () => {
    visibleCount = 120;
    render();
  });
  loadMoreButton.addEventListener("click", () => {
    visibleCount += 120;
    render();
  });

  catalogue.load().then(payload => {
    collections = payload.collections;
    issues = payload.issues;
    documentRows = issues.map(issue => {
      const year = catalogue.documentYear(issue);
      return year ? {...year, issue} : null;
    }).filter(Boolean);
    populateFilters();
    renderStats();
    render();
    document.documentElement.dataset.archiveTimelineState = "ready";
  }).catch(showError);
})();
