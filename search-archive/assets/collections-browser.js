(() => {
  "use strict";

  const catalogue = window.IsaacKoiCatalogue;
  if (!catalogue) return;

  const statsElement = document.getElementById("collection-browser-stats");
  const queryInput = document.getElementById("collection-browser-query");
  const kindInput = document.getElementById("collection-kind-filter");
  const sortInput = document.getElementById("collection-sort");
  const statusElement = document.getElementById("collection-browser-status");
  const resultsElement = document.getElementById("collection-browser-results");
  const loadMoreButton = document.getElementById("load-more-collections");
  const errorElement = document.getElementById("collection-browser-error");

  let collections = [];
  let summaryByCollection = new Map();
  let visibleCount = 12;
  const requestedCollection = new URLSearchParams(window.location.search).get("collection") || "";

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function sectionLabel(collection) {
    const section = String(collection.id || "").split("/")[0] || "other";
    return section.replaceAll("-", " ").replace(/\b\w/g, value => value.toUpperCase());
  }

  function metrics(collection) {
    const series = Array.isArray(collection.series) ? collection.series : [];
    const searchableSeries = series.filter(row => Number(row.indexed_text_pages || 0) > 0);
    const summary = summaryByCollection.get(String(collection.id || "")) || {};
    return {
      issueCount: Number(collection.issue_count || summary.issue_count || 0),
      seriesCount: Number(collection.series_count || series.length),
      searchableSeries: searchableSeries.length,
      searchablePages: searchableSeries.reduce((total, row) => total + Number(row.indexed_text_pages || 0), 0),
      mappedCount: Number(summary.mapped_prn_count || 0),
      sourceLinks: Number(summary.source_link_count || 0),
      indexedAt: Date.parse(collection.indexed_at_utc || "") || 0,
    };
  }

  function readableDate(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed)
      ? new Intl.DateTimeFormat("en-GB", {dateStyle: "medium", timeZone: "UTC"}).format(parsed)
      : "Not recorded";
  }

  function filteredCollections() {
    const query = queryInput.value.trim().toLocaleLowerCase();
    const kind = kindInput.value;
    const rows = collections.filter(collection => {
      if (kind && String(collection.id || "").split("/")[0] !== kind) return false;
      if (requestedCollection && collection.id !== requestedCollection) return false;
      if (!query) return true;
      const seriesText = (collection.series || []).map(series => series.title || series.id || "").join(" ");
      return `${collection.title || ""} ${collection.id || ""} ${seriesText}`.toLocaleLowerCase().includes(query);
    });
    return rows.sort((left, right) => {
      const leftMetrics = metrics(left);
      const rightMetrics = metrics(right);
      if (sortInput.value === "documents") return rightMetrics.issueCount - leftMetrics.issueCount || left.title.localeCompare(right.title);
      if (sortInput.value === "pages") return rightMetrics.searchablePages - leftMetrics.searchablePages || left.title.localeCompare(right.title);
      if (sortInput.value === "mapped") return rightMetrics.mappedCount - leftMetrics.mappedCount || left.title.localeCompare(right.title);
      if (sortInput.value === "recent") return rightMetrics.indexedAt - leftMetrics.indexedAt || left.title.localeCompare(right.title);
      return left.title.localeCompare(right.title);
    });
  }

  function seriesMarkup(collection) {
    const rows = (collection.series || [])
      .slice()
      .sort((left, right) => Number(right.indexed_text_pages || 0) - Number(left.indexed_text_pages || 0) || String(left.title || "").localeCompare(String(right.title || "")));
    const visible = rows.slice(0, 12);
    const overflow = Math.max(0, rows.length - visible.length);
    if (!visible.length) return `<p class="collection-series-empty">No series metadata is currently advertised.</p>`;
    return `<ul>${visible.map(series => `
      <li>
        <span>${escapeHtml(series.title || series.id || "Series")}</span>
        <small>${Number(series.issue_count || 0).toLocaleString()} PDFs · ${Number(series.indexed_text_pages || 0).toLocaleString()} searchable pages</small>
      </li>`).join("")}</ul>${overflow ? `<p>${overflow.toLocaleString()} additional series are available through collection search.</p>` : ""}`;
  }

  function cardMarkup(collection) {
    const rowMetrics = metrics(collection);
    const language = collection.language_label || "";
    return `
      <article class="collection-browser-card" id="collection-${escapeHtml(String(collection.id || "").replace(/[^a-zA-Z0-9_-]/g, "-"))}">
        <div class="collection-card-heading">
          <div><p class="eyebrow">${escapeHtml(sectionLabel(collection))}</p><h2>${escapeHtml(collection.title || collection.id)}</h2></div>
          ${language ? `<span>${escapeHtml(language)}</span>` : ""}
        </div>
        <div class="collection-card-metrics">
          <span><strong>${rowMetrics.issueCount.toLocaleString()}</strong><small>PDFs</small></span>
          <span><strong>${rowMetrics.seriesCount.toLocaleString()}</strong><small>series</small></span>
          <span><strong>${rowMetrics.searchablePages.toLocaleString()}</strong><small>searchable pages</small></span>
          <span><strong>${rowMetrics.mappedCount.toLocaleString()}</strong><small>mapped cases</small></span>
        </div>
        <p class="collection-coverage-line">${rowMetrics.searchableSeries.toLocaleString()} of ${rowMetrics.seriesCount.toLocaleString()} series advertise indexed page text · indexed ${escapeHtml(readableDate(collection.indexed_at_utc))}</p>
        ${collection.public_note ? `<p class="collection-public-note">${escapeHtml(collection.public_note)}</p>` : ""}
        <div class="collection-card-actions">
          <a class="primary-button" href="${escapeHtml(catalogue.searchUrl({collection: collection.id}))}">Search collection</a>
          <a href="${escapeHtml(catalogue.timelineUrl({collection: collection.id}))}">Open timeline</a>
          ${rowMetrics.mappedCount ? `<a href="${escapeHtml(catalogue.mapUrl(collection.title || collection.id))}">Explore mapped evidence</a>` : ""}
        </div>
        <details class="collection-series-details">
          <summary>Browse ${rowMetrics.seriesCount.toLocaleString()} series</summary>
          ${seriesMarkup(collection)}
        </details>
      </article>`;
  }

  function renderStats() {
    const totals = collections.reduce((result, collection) => {
      const row = metrics(collection);
      result.documents += row.issueCount;
      result.series += row.seriesCount;
      result.searchablePages += row.searchablePages;
      result.mapped += row.mappedCount;
      return result;
    }, {documents: 0, series: 0, searchablePages: 0, mapped: 0});
    statsElement.innerHTML = [
      [collections.length, "collections"],
      [new Set(collections.map(collection => String(collection.id || "").split("/")[0])).size, "archive sections"],
      [totals.documents, "public PDFs"],
      [totals.series, "series"],
      [totals.searchablePages, "searchable pages"],
    ].map(([value, label]) => `<span><strong>${Number(value).toLocaleString()}</strong><small>${escapeHtml(label)}</small></span>`).join("");
  }

  function render() {
    const rows = filteredCollections();
    const visible = rows.slice(0, visibleCount);
    resultsElement.innerHTML = visible.length
      ? visible.map(cardMarkup).join("")
      : `<p class="empty-state">No collections match these filters.</p>`;
    statusElement.textContent = requestedCollection
      ? `${visible.length ? "Showing" : "Could not find"} the requested collection.`
      : `Showing ${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} matching collections.`;
    loadMoreButton.hidden = visible.length >= rows.length;
  }

  function populateKinds() {
    const sections = [...new Set(collections.map(collection => String(collection.id || "").split("/")[0]).filter(Boolean))].sort();
    kindInput.insertAdjacentHTML("beforeend", sections.map(section => `<option value="${escapeHtml(section)}">${escapeHtml(sectionLabel({id: section}))}</option>`).join(""));
  }

  function showError(error) {
    document.documentElement.dataset.collectionBrowserState = "error";
    statusElement.textContent = "";
    resultsElement.innerHTML = "";
    errorElement.hidden = false;
    errorElement.querySelector("p").textContent = error.message || "The public collection catalogue could not be loaded.";
  }

  [queryInput, kindInput, sortInput].forEach(input => {
    input.addEventListener(input === queryInput ? "input" : "change", () => {
      visibleCount = 12;
      render();
    });
  });
  loadMoreButton.addEventListener("click", () => {
    visibleCount += 12;
    render();
  });

  catalogue.load().then(payload => {
    collections = payload.collections;
    summaryByCollection = payload.summaryByCollection;
    populateKinds();
    renderStats();
    render();
    document.documentElement.dataset.collectionBrowserState = "ready";
  }).catch(showError);
})();
