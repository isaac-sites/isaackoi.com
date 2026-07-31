"use strict";

const AFU_PUBLIC_SEARCH_DATA_BASE = "https://files.afu.se/Downloads/search/";
const searchDataMeta = document.querySelector('meta[name="afu-search-data-base"]')?.content.trim();
const searchUiMeta = document.querySelector('meta[name="afu-search-ui-base"]')?.content.trim();
const mapUiMeta = document.querySelector('meta[name="afu-map-ui-base"]')?.content.trim();
const scriptBase = document.currentScript?.src
  ? new URL("../", document.currentScript.src)
  : new URL("../", window.location.href);
const SEARCH_UI_BASE_URL = new URL(searchUiMeta || scriptBase.href, window.location.href);
const MAP_UI_BASE_URL = new URL(mapUiMeta || "/Downloads/mapview/", window.location.href);

function isLocalPreview() {
  return window.location.protocol === "file:"
    || ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname.toLocaleLowerCase());
}

const urlParams = new URLSearchParams(window.location.search);
const publicDataPreview = urlParams.get("publicData") === "1";
const SEARCH_DATA_ROOT_URL = isLocalPreview() && !publicDataPreview
  ? new URL(SEARCH_UI_BASE_URL)
  : new URL(searchDataMeta || AFU_PUBLIC_SEARCH_DATA_BASE, window.location.href);
let searchDataBaseUrl = SEARCH_DATA_ROOT_URL;
let currentIssue = null;
let currentCollection = null;
let currentRegistryEntry = null;
let currentSeries = null;
let currentCitation = "";
let currentDetailUrl = "";

const titleElement = document.getElementById("document-title");
const summaryElement = document.getElementById("document-summary");
const badgesElement = document.getElementById("document-badges");
const actionsElement = document.getElementById("document-actions");
const statusElement = document.getElementById("document-status");
const contentElement = document.getElementById("document-detail-content");
const fieldsElement = document.getElementById("document-fields");
const pdfLinkElement = document.getElementById("document-pdf-link");
const searchLinkElement = document.getElementById("document-search-link");
const mapLinkElement = document.getElementById("document-map-link");
const citationButton = document.getElementById("copy-document-citation");
const researchButton = document.getElementById("document-research-add");
const searchForm = document.getElementById("document-search-form");
const queryInput = document.getElementById("document-query");
const rangeForm = document.getElementById("document-range-form");
const pageStartInput = document.getElementById("document-page-start");
const pageEndInput = document.getElementById("document-page-end");
const privateNoteInput = document.getElementById("document-private-note");
const rangeStatusElement = document.getElementById("document-range-status");
const previewElement = document.getElementById("document-preview");
const accessNoteElement = document.getElementById("document-access-note");
const readerFrame = document.getElementById("document-reader-frame");
const readerStateElement = document.getElementById("document-reader-state");
const loadReaderButton = document.getElementById("load-document-reader");
const unloadReaderButton = document.getElementById("unload-document-reader");
const errorElement = document.getElementById("document-detail-error");
const errorMessageElement = document.getElementById("document-detail-error-message");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""), searchDataBaseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function validatedReleaseDataUrl(pointer) {
  if (pointer?.schema_version !== 1 || pointer?.package_kind !== "search" || !pointer?.release_id) return null;
  const dataPath = String(pointer.data_path || "");
  if (!dataPath || dataPath.startsWith("/") || dataPath.includes("..") || !dataPath.endsWith("/")) return null;
  const resolved = new URL(dataPath, SEARCH_DATA_ROOT_URL);
  if (resolved.origin !== SEARCH_DATA_ROOT_URL.origin || !resolved.href.startsWith(SEARCH_DATA_ROOT_URL.href)) return null;
  return resolved;
}

async function initializeSearchRelease() {
  if (isLocalPreview() && !publicDataPreview && urlParams.get("releaseData") !== "1") return;
  try {
    const response = await fetch(new URL("release.json", SEARCH_DATA_ROOT_URL), {
      mode: "cors",
      credentials: "omit",
      cache: "no-cache",
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Search release pointer returned HTTP ${response.status}`);
    const pointer = await response.json();
    const releaseUrl = validatedReleaseDataUrl(pointer);
    if (!releaseUrl) throw new Error("Search release pointer is malformed or unsafe.");
    searchDataBaseUrl = releaseUrl;
    document.documentElement.dataset.documentDetailRelease = String(pointer.release_id);
  } catch (error) {
    console.warn("Versioned search data unavailable; using the compatible data root.", error);
  }
}

async function readJson(path) {
  const resolvedUrl = new URL(path, searchDataBaseUrl).href;
  const response = await fetch(resolvedUrl, {mode: "cors", credentials: "omit"});
  if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
  return response.json();
}

async function readGzipJson(path) {
  if (!("DecompressionStream" in window)) throw new Error("This browser cannot read the compressed catalogue.");
  const resolvedUrl = new URL(path, searchDataBaseUrl).href;
  const response = await fetch(resolvedUrl, {mode: "cors", credentials: "omit"});
  if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
  const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(decompressed).text());
}

function issueMatches(issue, requestedId, allowNumericId = false) {
  if (String(issue?.document_id || "") === requestedId) return true;
  return allowNumericId && String(issue?.id ?? "") === requestedId;
}

function seriesForIssue(collection, issue) {
  const rows = Array.isArray(collection?.series) ? collection.series : [];
  return rows.find(row =>
    String(row.id || "") === String(issue.series_slug || "")
    || String(row.title || "") === String(issue.series || "")
  ) || null;
}

function normalizeRecord(entry, collection, issue) {
  return {
    entry,
    collection,
    issue: {
      ...issue,
      collection_id: issue.collection_id || entry.id,
      collection_title: issue.collection_title || collection.title || entry.title || entry.id,
    },
    series: seriesForIssue(collection, issue),
  };
}

async function loadCollectionRecord(entry, requestedId, allowNumericId = false) {
  const [collection, issues] = await Promise.all([
    readJson(`${entry.path}/collection.json`),
    readJson(`${entry.path}/issues.json`),
  ]);
  const issue = issues.find(row => issueMatches(row, requestedId, allowNumericId));
  return issue ? normalizeRecord(entry, collection, issue) : null;
}

async function loadDocumentRecord(requestedId, requestedCollection) {
  const registry = await readJson("collections.json");
  if (!Array.isArray(registry)) throw new Error("The collection registry is malformed.");

  const requestedEntry = requestedCollection
    ? registry.find(entry => String(entry.id || "") === requestedCollection)
    : null;
  if (requestedEntry) {
    const targeted = await loadCollectionRecord(requestedEntry, requestedId, true);
    if (targeted) return targeted;
  }

  const descriptor = registry.find(entry => entry?.catalogue_bundle?.path)?.catalogue_bundle;
  if (descriptor?.path) {
    try {
      const payload = await readGzipJson(descriptor.path);
      if (payload?.schema_version !== 1 || !Array.isArray(payload.collections)) {
        throw new Error("The compact catalogue has an unsupported schema.");
      }
      for (const row of payload.collections) {
        const entry = registry.find(candidate => String(candidate.id || "") === String(row?.id || ""));
        if (!entry || !row?.collection || !Array.isArray(row?.issues)) continue;
        const issue = row.issues.find(candidate => issueMatches(candidate, requestedId));
        if (issue) return normalizeRecord(entry, row.collection, issue);
      }
    } catch (error) {
      console.warn("Compact catalogue lookup failed; checking collection catalogues.", error);
    }
  }

  for (const entry of registry) {
    if (requestedEntry && entry.id === requestedEntry.id) continue;
    try {
      const record = await loadCollectionRecord(entry, requestedId);
      if (record) return record;
    } catch (error) {
      console.warn(`Skipping unavailable collection ${entry.id || entry.path}.`, error);
    }
  }
  return null;
}

function detailUrl(issue, {pageStart = null, pageEnd = null, query = ""} = {}) {
  const url = new URL("document/", SEARCH_UI_BASE_URL);
  url.searchParams.set("id", issue.document_id || issue.id);
  if (issue.collection_id) url.searchParams.set("collection", issue.collection_id);
  if (pageStart) url.searchParams.set("page_start", String(pageStart));
  if (pageEnd && pageEnd !== pageStart) url.searchParams.set("page_end", String(pageEnd));
  if (query) url.searchParams.set("q", query);
  if (isLocalPreview() && publicDataPreview && url.origin === window.location.origin) {
    url.searchParams.set("publicData", "1");
  }
  return url.href;
}

function documentSearchUrl(issue, query = "") {
  const url = new URL(SEARCH_UI_BASE_URL);
  url.searchParams.set("issue", issue.document_id || issue.id);
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("fulltext", "1");
  url.searchParams.set("autorun", "1");
  if (isLocalPreview() && publicDataPreview && url.origin === window.location.origin) {
    url.searchParams.set("publicData", "1");
  }
  return url.href;
}

function documentMapUrl(issue) {
  const url = new URL(MAP_UI_BASE_URL);
  url.searchParams.set("source_doc", issue.document_id || issue.id);
  url.searchParams.set("evidence", "1");
  if (isLocalPreview() && publicDataPreview && url.origin === window.location.origin) {
    url.searchParams.set("publicData", "1");
  }
  return url.href;
}

function viewerUrl(issue, page = null) {
  const pdfUrl = safeHttpUrl(issue.pdf_url);
  if (!pdfUrl) return "";
  const viewer = new URL("pdfjs/web/viewer.html", SEARCH_UI_BASE_URL);
  viewer.searchParams.set("file", pdfUrl);
  const hash = new URLSearchParams();
  if (page) hash.set("page", String(page));
  hash.set("phrase", "true");
  viewer.hash = hash.toString();
  return viewer.href;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["bytes", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** power);
  return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
}

function readableDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat("en-GB", {dateStyle: "medium", timeZone: "UTC"}).format(parsed);
}

function citationFor(issue) {
  const details = [
    issue.series,
    issue.date ? `catalogue date ${issue.date}` : issue.year ? `catalogue year ${issue.year}` : "",
    issue.collection_title,
    `document ${issue.document_id || issue.id}`,
  ].filter(Boolean).join(". ");
  return `Isaac Koi Archive. "${issue.title || issue.filename || "Archive document"}." ${details}. ${currentDetailUrl}`;
}

function renderRecord(record) {
  currentIssue = record.issue;
  currentCollection = record.collection;
  currentRegistryEntry = record.entry;
  currentSeries = record.series;
  const issue = currentIssue;
  const title = issue.title || issue.filename || String(issue.document_id || issue.id);
  const pdfUrl = safeHttpUrl(issue.pdf_url);
  const hasIndexedText = Boolean(issue.has_local_text_source && currentSeries?.text_shard_available);
  currentDetailUrl = detailUrl(issue);
  currentCitation = citationFor(issue);

  document.title = `${title} | Isaac Koi Archive`;
  document.documentElement.dataset.documentDetailState = "ready";
  document.documentElement.dataset.documentDetailId = String(issue.document_id || issue.id);
  titleElement.textContent = title;
  summaryElement.textContent = [issue.collection_title, issue.series].filter(Boolean).join(" · ");

  const badges = [
    "Source metadata",
    issue.document_id ? "Stable document ID" : "",
    pdfUrl ? "Public source PDF" : "Catalogue record",
    hasIndexedText ? "OCR / extracted text finding aid" : "",
  ].filter(Boolean);
  badgesElement.innerHTML = badges.map(value => `<span>${escapeHtml(value)}</span>`).join("");

  const fields = [
    ["Stable document ID", issue.document_id || issue.id],
    ["Collection", issue.collection_title],
    ["Series", issue.series],
    ["Catalogue date", issue.date],
    ["Catalogue year", issue.year],
    ["Archive file modified", readableDate(issue.modified_utc)],
    ["Collection indexed", readableDate(currentRegistryEntry.indexed_at_utc || currentCollection.indexed_at_utc)],
    ["Language", issue.language_label || currentCollection.language_label],
    ["File name", issue.filename],
    ["Pages", issue.pages || issue.page_count],
    ["File size", formatBytes(issue.size)],
    ["Indexed page text", hasIndexedText ? "Available as a finding aid" : "Not currently advertised for this document"],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  fieldsElement.innerHTML = fields
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");

  pdfLinkElement.hidden = !pdfUrl;
  if (pdfUrl) pdfLinkElement.href = pdfUrl;
  searchLinkElement.href = documentSearchUrl(issue);
  mapLinkElement.href = documentMapUrl(issue);
  loadReaderButton.hidden = !pdfUrl;
  accessNoteElement.textContent = pdfUrl
    ? "The original PDF is publicly hosted by Archives for the Unexplained."
    : "No public PDF URL is present in this catalogue record.";
  queryInput.value = String(urlParams.get("q") || "");
  const requestedPageStart = Number.parseInt(urlParams.get("page_start") || urlParams.get("page") || "", 10);
  const requestedPageEnd = Number.parseInt(urlParams.get("page_end") || "", 10);
  if (Number.isInteger(requestedPageStart) && requestedPageStart > 0) {
    pageStartInput.value = String(requestedPageStart);
    pageEndInput.value = String(
      Number.isInteger(requestedPageEnd) && requestedPageEnd >= requestedPageStart
        ? requestedPageEnd
        : requestedPageStart
    );
  }
  const advertisedPages = Number(issue.pages || issue.page_count || 0);
  if (advertisedPages > 0) {
    pageStartInput.max = String(advertisedPages);
    pageEndInput.max = String(advertisedPages);
  }

  if (issue.thumbnail_url && safeHttpUrl(issue.thumbnail_url)) {
    previewElement.innerHTML = `<img src="${escapeHtml(safeHttpUrl(issue.thumbnail_url))}" alt="First-page preview for ${escapeHtml(title)}" loading="lazy">`;
  } else {
    previewElement.innerHTML = `<div class="document-detail-preview-fallback"><strong>PDF</strong><span>${escapeHtml(issue.series || issue.collection_title || "Archive document")}</span></div>`;
  }

  researchButton.dataset.researchId = `document:${issue.document_id || issue.id}`;
  researchButton.dataset.researchType = "archive-document";
  researchButton.dataset.researchTitle = title;
  researchButton.dataset.researchSubtitle = issue.series || "";
  researchButton.dataset.researchUrl = currentDetailUrl;
  researchButton.dataset.researchCitation = currentCitation;
  researchButton.dataset.researchDate = issue.date || issue.year || "";
  researchButton.dataset.researchCollection = issue.collection_title || issue.collection_id || "";
  researchButton.dataset.researchDocumentId = issue.document_id || "";
  researchButton.dataset.researchSourceFamilies = "";
  researchButton.dataset.researchSourceCount = "0";
  researchButton.dataset.researchEvidenceStatus = hasIndexedText
    ? "Public archive document with indexed text finding aid"
    : pdfUrl ? "Public archive document" : "Catalogue metadata record";

  actionsElement.hidden = false;
  contentElement.hidden = false;
  statusElement.textContent = "Public catalogue record loaded. Source and derived layers remain explicitly separated.";
  window.IsaacKoiResearch?.render();
}

function showError(message) {
  document.documentElement.dataset.documentDetailState = "error";
  titleElement.textContent = "Document record unavailable";
  summaryElement.textContent = "The requested stable document record could not be loaded.";
  statusElement.textContent = "";
  actionsElement.hidden = true;
  contentElement.hidden = true;
  errorMessageElement.textContent = message;
  errorElement.hidden = false;
}

async function copyCitation() {
  if (!currentCitation) return;
  await navigator.clipboard.writeText(currentCitation);
  citationButton.textContent = "Citation copied";
  window.setTimeout(() => { citationButton.textContent = "Copy citation"; }, 1800);
}

function loadReader() {
  if (!currentIssue) return;
  const requestedPage = Number.parseInt(pageStartInput.value || "", 10);
  const url = viewerUrl(currentIssue, Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : null);
  if (!url) return;
  readerFrame.src = url;
  readerStateElement.textContent = "Loaded";
  loadReaderButton.hidden = true;
  unloadReaderButton.hidden = false;
}

function unloadReader() {
  readerFrame.removeAttribute("src");
  readerStateElement.textContent = "Not loaded";
  loadReaderButton.hidden = false;
  unloadReaderButton.hidden = true;
}

function evidenceRangeCitation(issue, pageStart, pageEnd, rangeUrl) {
  const title = issue.title || issue.filename || "Archive document";
  const pageLabel = pageStart === pageEnd
    ? `evidence PDF page ${pageStart}`
    : `evidence PDF pages ${pageStart}–${pageEnd}`;
  const details = [
    issue.series,
    issue.date ? `catalogue date ${issue.date}` : issue.year ? `catalogue year ${issue.year}` : "",
    issue.collection_title,
    pageLabel,
  ].filter(Boolean).join(". ");
  return `Isaac Koi Archive. "${title}." ${details}. ${rangeUrl}`;
}

function saveEvidenceRange() {
  if (!currentIssue || !window.IsaacKoiResearch) return;
  const pageStart = Number.parseInt(pageStartInput.value || "", 10);
  const requestedEnd = Number.parseInt(pageEndInput.value || "", 10);
  const pageEnd = Number.isInteger(requestedEnd) && requestedEnd > 0 ? requestedEnd : pageStart;
  const advertisedPages = Number(currentIssue.pages || currentIssue.page_count || 0);
  if (!Number.isInteger(pageStart) || pageStart < 1) {
    rangeStatusElement.textContent = "Enter the first PDF page.";
    pageStartInput.focus();
    return;
  }
  if (!Number.isInteger(pageEnd) || pageEnd < pageStart) {
    rangeStatusElement.textContent = "The last PDF page must be the same as or later than the first.";
    pageEndInput.focus();
    return;
  }
  if (advertisedPages > 0 && pageEnd > advertisedPages) {
    rangeStatusElement.textContent = `This catalogue record advertises ${advertisedPages} PDF pages.`;
    pageEndInput.focus();
    return;
  }
  const query = queryInput.value.trim();
  const rangeUrl = detailUrl(currentIssue, {pageStart, pageEnd, query});
  const pageLabel = pageStart === pageEnd ? `PDF page ${pageStart}` : `PDF pages ${pageStart}–${pageEnd}`;
  const documentId = String(currentIssue.document_id || currentIssue.id);
  const saved = window.IsaacKoiResearch.add({
    id: `document:${documentId}:pages:${pageStart}-${pageEnd}`,
    type: "archive-document",
    title: currentIssue.title || currentIssue.filename || "Archive document",
    subtitle: [currentIssue.series, pageLabel].filter(Boolean).join(" · "),
    url: rangeUrl,
    citation: evidenceRangeCitation(currentIssue, pageStart, pageEnd, rangeUrl),
    date: currentIssue.date || currentIssue.year || "",
    collection: currentIssue.collection_title || currentIssue.collection_id || "",
    document_id: documentId,
    source_families: [],
    source_count: 0,
    evidence_status: safeHttpUrl(currentIssue.pdf_url)
      ? "Page-resolved public archive document"
      : "Page-resolved catalogue metadata record",
    page_start: pageStart,
    page_end: pageEnd,
    finding_query: query,
    private_note: privateNoteInput.value.trim(),
  });
  rangeStatusElement.textContent = saved
    ? `Saved ${pageLabel}. Private notes will not be included in share links.`
    : "The page range could not be saved in this browser.";
}

searchForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!currentIssue) return;
  window.location.href = documentSearchUrl(currentIssue, queryInput.value.trim());
});
rangeForm.addEventListener("submit", event => {
  event.preventDefault();
  saveEvidenceRange();
});
citationButton.addEventListener("click", () => {
  copyCitation().catch(error => {
    statusElement.textContent = `Citation could not be copied: ${error.message}`;
  });
});
loadReaderButton.addEventListener("click", loadReader);
unloadReaderButton.addEventListener("click", unloadReader);

(async function initialize() {
  const requestedId = String(urlParams.get("id") || "").trim();
  const requestedCollection = String(urlParams.get("collection") || "").trim();
  if (!requestedId) {
    showError("No document identifier was supplied.");
    return;
  }
  try {
    await initializeSearchRelease();
    const record = await loadDocumentRecord(requestedId, requestedCollection);
    if (!record) throw new Error(`No public catalogue record was found for ${requestedId}.`);
    renderRecord(record);
  } catch (error) {
    console.error(error);
    showError(error.message || "The public catalogue record could not be loaded.");
  }
}());
