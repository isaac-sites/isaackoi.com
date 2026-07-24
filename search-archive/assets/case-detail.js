"use strict";

const AFU_PUBLIC_MAP_DATA_BASE = "https://files.afu.se/Downloads/mapview/";
const CASE_DISCOVERY_BUNDLE_PATH = "data/case_discovery_public.json.gz";
const MAP_EVIDENCE_BUNDLE_PATH = "data/search_map_evidence_public.json.gz";
const INCIDENT_CLUSTERS_PATH = "data/incident_clusters_public.json.gz";
const CASE_SEARCH_WORKER_PATH = "assets/case-search-worker.js?v=3";
const CASE_DETAIL_CACHE_PREFIX = "isaac-koi-map-data-v1-";
const CASE_FIELDS = [
  "id", "collection", "title", "date", "year", "location", "region",
  "country", "type", "classification", "source_count", "source_labels", "evidence_url",
];
const CASE_FIELD = Object.freeze(Object.fromEntries(CASE_FIELDS.map((field, index) => [field, index])));
const COLLECTION_LABELS = {
  "blue-book": "Project Blue Book / Fold3",
  ufocat: "UFOCAT",
  "source-first": "Publication-extracted event",
  geipan: "GEIPAN",
  lac: "Library and Archives Canada UFO files",
};

const searchUiMeta = document.querySelector('meta[name="afu-search-ui-base"]')?.content.trim();
const mapUiMeta = document.querySelector('meta[name="afu-map-ui-base"]')?.content.trim();
const mapDataMeta = document.querySelector('meta[name="afu-map-data-base"]')?.content.trim();
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
const MAP_DATA_ROOT_URL = isLocalPreview() && !publicDataPreview
  ? new URL(MAP_UI_BASE_URL)
  : new URL(mapDataMeta || AFU_PUBLIC_MAP_DATA_BASE, window.location.href);
let mapDataBaseUrl = MAP_DATA_ROOT_URL;
let activeMapRelease = "";
let detailCacheName = "";
let caseWorker = null;
let workerRequestId = 0;
const workerRequests = new Map();
let currentRow = null;
let currentCitation = "";
let currentDetailUrl = "";
let currentMapUrl = "";

const titleElement = document.getElementById("case-title");
const summaryElement = document.getElementById("case-summary");
const badgesElement = document.getElementById("case-badges");
const actionsElement = document.getElementById("case-actions");
const statusElement = document.getElementById("case-status");
const contentElement = document.getElementById("case-detail-content");
const fieldsElement = document.getElementById("case-fields");
const evidenceCountElement = document.getElementById("evidence-count");
const evidenceListElement = document.getElementById("case-evidence-list");
const sourceNeighborCountElement = document.getElementById("source-neighbor-count");
const sourceNeighborListElement = document.getElementById("source-neighbor-list");
const relatedCountElement = document.getElementById("related-count");
const relatedListElement = document.getElementById("related-case-list");
const mapLinkElement = document.getElementById("case-map-link");
const searchLinkElement = document.getElementById("case-search-link");
const citationButton = document.getElementById("copy-case-citation");
const researchButton = document.getElementById("case-research-add");
const loadMapButton = document.getElementById("load-case-map");
const unloadMapButton = document.getElementById("unload-case-map");
const mapFrame = document.getElementById("case-map-frame");
const errorElement = document.getElementById("case-detail-error");
const errorMessageElement = document.getElementById("case-detail-error-message");
const errorSearchLink = document.getElementById("case-error-search-link");
const previewPanel = document.getElementById("case-evidence-preview");
const previewTitle = document.getElementById("case-preview-title");
const previewMeta = document.getElementById("case-preview-meta");
const previewExternal = document.getElementById("case-preview-external");
const previewFrame = document.getElementById("case-preview-frame");
const closePreviewButton = document.getElementById("close-case-preview");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function caseField(row, name) {
  return String(row?.record?.[CASE_FIELD[name]] ?? "");
}

function caseNumberField(row, name) {
  return Number(row?.record?.[CASE_FIELD[name]] || 0);
}

function cleanPublicUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function validatedReleaseDataUrl(pointer) {
  if (pointer?.schema_version !== 1 || pointer?.package_kind !== "map" || !pointer?.release_id) return null;
  const dataPath = String(pointer.data_path || "");
  if (!dataPath || dataPath.startsWith("/") || dataPath.includes("..") || !dataPath.endsWith("/")) return null;
  const resolved = new URL(dataPath, MAP_DATA_ROOT_URL);
  if (resolved.origin !== MAP_DATA_ROOT_URL.origin || !resolved.href.startsWith(MAP_DATA_ROOT_URL.href)) return null;
  return resolved;
}

async function activateDetailCache() {
  if (!activeMapRelease || !("caches" in window)) return;
  const releaseKey = activeMapRelease.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80);
  detailCacheName = `${CASE_DETAIL_CACHE_PREFIX}${releaseKey}`;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(CASE_DETAIL_CACHE_PREFIX) && name !== detailCacheName)
        .map(name => caches.delete(name))
    );
    document.documentElement.dataset.caseDetailCache = "enabled";
  } catch (error) {
    detailCacheName = "";
    document.documentElement.dataset.caseDetailCache = "unavailable";
  }
}

async function initializeMapRelease() {
  if (isLocalPreview() && !publicDataPreview && urlParams.get("releaseData") !== "1") return;
  try {
    const response = await fetch(new URL("release.json", MAP_DATA_ROOT_URL), {
      mode: "cors",
      credentials: "omit",
      cache: "no-cache",
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Map release pointer returned HTTP ${response.status}`);
    const pointer = await response.json();
    const releaseUrl = validatedReleaseDataUrl(pointer);
    if (!releaseUrl) throw new Error("Map release pointer is malformed or unsafe.");
    mapDataBaseUrl = releaseUrl;
    activeMapRelease = String(pointer.release_id);
    document.documentElement.dataset.caseDetailRelease = activeMapRelease;
    await activateDetailCache();
  } catch (error) {
    console.warn("Versioned map data unavailable; using the compatible data root.", error);
  }
}

async function fetchCompressed(path) {
  const resolvedUrl = new URL(path, mapDataBaseUrl).href;
  const request = new Request(resolvedUrl, {mode: "cors", credentials: "omit"});
  if (!detailCacheName || !("caches" in window)) {
    const response = await fetch(request);
    if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  let cache;
  try {
    cache = await caches.open(detailCacheName);
    const cached = await cache.match(request);
    if (cached) {
      document.documentElement.dataset.caseDetailCache = "hit";
      return cached.arrayBuffer();
    }
  } catch (error) {
    document.documentElement.dataset.caseDetailCache = "unavailable";
    const response = await fetch(request);
    if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const response = await fetch(request);
  if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
  try {
    await cache.put(request, response.clone());
  } catch (error) {
    document.documentElement.dataset.caseDetailCache = "unavailable";
  }
  return response.arrayBuffer();
}

function workerCall(type, payload, transfer = []) {
  if (!caseWorker) return Promise.reject(new Error("The mapped-case worker is unavailable."));
  workerRequestId += 1;
  const id = workerRequestId;
  return new Promise((resolve, reject) => {
    workerRequests.set(id, {resolve, reject});
    caseWorker.postMessage({id, type, payload}, transfer);
  });
}

function initializeWorker() {
  if (!("Worker" in window) || !("DecompressionStream" in window)) {
    throw new Error("This page needs a current browser with worker and gzip-stream support.");
  }
  caseWorker = new Worker(new URL(CASE_SEARCH_WORKER_PATH, scriptBase));
  caseWorker.addEventListener("message", event => {
    const request = workerRequests.get(event.data?.id);
    if (!request) return;
    workerRequests.delete(event.data.id);
    if (event.data.ok) request.resolve(event.data.result);
    else request.reject(new Error(event.data.error || "The mapped-case worker failed."));
  });
  caseWorker.addEventListener("error", event => {
    const error = new Error(event.message || "The mapped-case worker stopped unexpectedly.");
    for (const request of workerRequests.values()) request.reject(error);
    workerRequests.clear();
  });
}

function caseDetailUrl(recordId, collection) {
  const url = new URL("case/", SEARCH_UI_BASE_URL);
  url.searchParams.set("id", recordId);
  if (collection) url.searchParams.set("collection", collection);
  if (isLocalPreview() && publicDataPreview && url.origin === window.location.origin) {
    url.searchParams.set("publicData", "1");
  }
  return url.href;
}

function caseMapUrl(recordId) {
  const url = new URL(MAP_UI_BASE_URL);
  url.searchParams.set("prn", recordId);
  url.searchParams.set("evidence", "1");
  if (isLocalPreview() && publicDataPreview && url.origin === window.location.origin) {
    url.searchParams.set("publicData", "1");
  }
  return url.href;
}

function archiveSearchUrl(query) {
  const url = new URL(SEARCH_UI_BASE_URL);
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("fulltext", "1");
  url.searchParams.set("autorun", "1");
  return url.href;
}

function archiveRecordUrl(source) {
  const documentId = String(source.afu_document_id || source.online_source_document_id || "").trim();
  if (!documentId) return "";
  const url = new URL(SEARCH_UI_BASE_URL);
  url.searchParams.set("issue", documentId);
  const query = String(source.search_anchor_term || source.online_source_search_term || "").trim();
  if (query) url.searchParams.set("q", query);
  const page = String(source.online_source_page || source.search_hit_page || "").trim();
  if (page) url.searchParams.set("page", page);
  url.searchParams.set("fulltext", "1");
  url.searchParams.set("autorun", "1");
  return url.href;
}

function evidenceUrl(source) {
  const raw = String(
    source.evidence_url
    || source.online_source_url
    || source.pdf_url
    || source.source_url
    || source.official_source_url
    || ""
  ).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, mapDataBaseUrl);
    if (url.protocol === "http:" && /(^|\.)fold3\.com$/i.test(url.hostname)) url.protocol = "https:";
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function evidencePreviewUrl(value) {
  const publicUrl = cleanPublicUrl(value);
  if (!publicUrl) return "";
  const source = new URL(publicUrl);
  if (source.origin !== "https://files.afu.se") return "";
  let fileUrl = "";
  let hash = "";
  if (source.pathname === "/Downloads/search/pdfjs/web/viewer.html") {
    fileUrl = cleanPublicUrl(source.searchParams.get("file") || "");
    hash = source.hash;
  } else if (source.pathname.startsWith("/Downloads/") && /\.pdf$/i.test(decodeURIComponent(source.pathname))) {
    fileUrl = source.href;
  }
  if (!fileUrl) return "";
  const viewer = new URL("pdfjs/web/viewer.html", SEARCH_UI_BASE_URL);
  viewer.searchParams.set("v", "20260723-case-detail-1");
  viewer.searchParams.set("file", fileUrl);
  if (isLocalPreview() && publicDataPreview) viewer.searchParams.set("publicData", "1");
  viewer.hash = hash || "phrase=true";
  return viewer.href;
}

function readableStatus(source) {
  const raw = String(
    source.validation_status
    || source.page_mapping_status
    || source.link_confidence
    || source.link_status
    || ""
  ).trim();
  return raw.replaceAll("_", " ");
}

function sourceLabel(source) {
  return String(
    source.online_source_label
    || source.issue_label
    || source.source_label
    || source.document_filename
    || source.pdf_filename
    || source.source_code
    || "Public source"
  ).trim();
}

function uniqueEvidenceSources(row, sources) {
  const unique = new Map();
  for (const source of sources || []) {
    const url = evidenceUrl(source);
    if (!url) continue;
    const page = String(source.online_source_page || source.search_hit_page || "").trim();
    const key = `${url}|${source.source_code || ""}|${page}`;
    if (!unique.has(key)) unique.set(key, {...source, _evidence_url: url});
  }
  const representative = cleanPublicUrl(caseField(row, "evidence_url"));
  if (representative && ![...unique.values()].some(source => source._evidence_url === representative)) {
    unique.set(`${representative}|representative|`, {
      source_label: caseField(row, "source_labels") || COLLECTION_LABELS[caseField(row, "collection")] || "Public source",
      link_status: "representative public link",
      _evidence_url: representative,
    });
  }
  return [...unique.values()].sort((left, right) =>
    Number(String(right.citation_role || "").toLocaleLowerCase() === "primary")
      - Number(String(left.citation_role || "").toLocaleLowerCase() === "primary")
    || sourceLabel(left).localeCompare(sourceLabel(right))
  );
}

function citationFor(row) {
  const parts = [
    caseField(row, "title"),
    caseField(row, "date") ? `date ${caseField(row, "date")}` : "",
    caseField(row, "location") ? `location ${caseField(row, "location")}` : "",
    `${COLLECTION_LABELS[caseField(row, "collection")] || caseField(row, "collection")} record ${caseField(row, "id")}`,
    currentDetailUrl,
  ].filter(Boolean);
  return parts.join(". ");
}

function renderRecord(row) {
  currentRow = row;
  const recordId = caseField(row, "id");
  const collection = caseField(row, "collection");
  const collectionLabel = COLLECTION_LABELS[collection] || collection;
  const title = caseField(row, "title") || recordId;
  currentDetailUrl = caseDetailUrl(recordId, collection);
  currentMapUrl = caseMapUrl(recordId);
  currentCitation = citationFor(row);
  document.title = `${title} | Isaac Koi Archive`;
  document.documentElement.dataset.caseDetailState = "record-ready";
  document.documentElement.dataset.caseDetailRecordId = recordId;
  titleElement.textContent = title;
  summaryElement.textContent = [
    caseField(row, "date"),
    caseField(row, "location"),
    caseField(row, "region"),
    caseField(row, "country"),
  ].filter(Boolean).join(" · ") || "Public mapped-case metadata";
  const badges = [
    collectionLabel,
    caseField(row, "type"),
    caseField(row, "classification") ? `Class ${caseField(row, "classification")}` : "",
    `${caseNumberField(row, "source_count")} linked source${caseNumberField(row, "source_count") === 1 ? "" : "s"}`,
  ].filter(Boolean);
  badgesElement.innerHTML = badges.map(value => `<span>${escapeHtml(value)}</span>`).join("");
  const fields = [
    ["Record ID", recordId],
    ["Collection", collectionLabel],
    ["Date", caseField(row, "date")],
    ["Year", caseField(row, "year")],
    ["Location", caseField(row, "location")],
    ["Region", caseField(row, "region")],
    ["Country", caseField(row, "country")],
    ["Type", caseField(row, "type")],
    ["Classification", caseField(row, "classification")],
    ["Source families", caseField(row, "source_labels")],
  ].filter(([, value]) => value);
  fieldsElement.innerHTML = fields
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  mapLinkElement.href = currentMapUrl;
  const relatedQuery = [caseField(row, "location"), caseField(row, "year")].filter(Boolean).join(" ");
  searchLinkElement.href = archiveSearchUrl(relatedQuery);
  researchButton.dataset.researchId = `case:${recordId}`;
  researchButton.dataset.researchType = "mapped-case";
  researchButton.dataset.researchTitle = title;
  researchButton.dataset.researchSubtitle = `${collectionLabel} record ${recordId}`;
  researchButton.dataset.researchUrl = currentDetailUrl;
  researchButton.dataset.researchCitation = currentCitation;
  researchButton.dataset.researchDate = caseField(row, "date");
  researchButton.dataset.researchLocation = caseField(row, "location");
  researchButton.dataset.researchCollection = collection;
  researchButton.dataset.researchRecordId = recordId;
  researchButton.dataset.researchSourceFamilies = caseField(row, "source_labels");
  researchButton.dataset.researchSourceCount = String(caseNumberField(row, "source_count"));
  researchButton.dataset.researchEvidenceStatus = caseField(row, "evidence_url") ? "linked" : "mapped";
  actionsElement.hidden = false;
  contentElement.hidden = false;
  window.IsaacKoiResearch?.render();
}

function renderEvidence(row, sources) {
  const rows = uniqueEvidenceSources(row, sources);
  evidenceCountElement.textContent = `${rows.length.toLocaleString()} public link${rows.length === 1 ? "" : "s"}`;
  document.documentElement.dataset.caseDetailEvidenceLinks = String(rows.length);
  if (!rows.length) {
    evidenceListElement.innerHTML = `<p class="case-detail-empty">No public source/file link is currently attached to this mapped record.</p>`;
    return;
  }
  evidenceListElement.innerHTML = rows.map((source, index) => {
    const url = source._evidence_url;
    const previewUrl = evidencePreviewUrl(url);
    const archiveUrl = archiveRecordUrl(source);
    const page = String(source.online_source_page || source.search_hit_page || "").trim();
    const badges = [
      source.citation_role,
      page ? `page ${page}` : "",
      readableStatus(source),
    ].filter(Boolean);
    return `<article>
      <div class="case-evidence-source-heading">
        <strong>${escapeHtml(sourceLabel(source))}</strong>
        ${badges.length ? `<span>${badges.map(value => escapeHtml(value)).join(" · ")}</span>` : ""}
      </div>
      ${source.citation_raw ? `<p>Catalogue citation: ${escapeHtml(source.citation_raw)}</p>` : ""}
      <div class="case-evidence-source-actions">
        ${previewUrl ? `<button type="button" data-evidence-preview="${index}">Preview evidence</button>` : ""}
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open evidence</a>
        ${archiveUrl ? `<a href="${escapeHtml(archiveUrl)}">Open archive record</a>` : ""}
      </div>
    </article>`;
  }).join("");
  evidenceListElement.querySelectorAll("[data-evidence-preview]").forEach(button => {
    button.addEventListener("click", () => {
      const source = rows[Number(button.dataset.evidencePreview)];
      openEvidencePreview(source);
    });
  });
}

function renderRelated(related) {
  const matches = Array.isArray(related?.matches) ? related.matches : [];
  relatedCountElement.textContent = matches.length
    ? `${Number(related.member_count || matches.length + 1).toLocaleString()} records`
    : "No suggestions";
  document.documentElement.dataset.caseDetailRelatedRecords = String(matches.length);
  if (!matches.length) {
    relatedListElement.innerHTML = `<p class="case-detail-empty">No cross-collection incident suggestion currently meets the public matching threshold.</p>`;
    return;
  }
  relatedListElement.innerHTML = matches.map(match => {
    const href = caseDetailUrl(String(match.record_id || ""), String(match.collection_id || ""));
    const reasons = (match.reasons || []).join(" · ");
    return `<article>
      <p class="eyebrow">${escapeHtml(match.collection || match.collection_id || "Mapped collection")}</p>
      <h3><a href="${escapeHtml(href)}">${escapeHtml(match.title || match.location || match.record_id)}</a></h3>
      <p>${escapeHtml([match.date, match.location].filter(Boolean).join(" · "))}</p>
      <p>${escapeHtml([match.confidence, `${Number(match.distance_km || 0).toLocaleString()} km`, reasons].filter(Boolean).join(" · "))}</p>
      <div><a href="${escapeHtml(href)}">Open related case</a><a href="${escapeHtml(caseMapUrl(String(match.record_id || "")))}">Locate on map</a></div>
    </article>`;
  }).join("");
}

function renderSharedPublications(sharedPublications) {
  const rows = Array.isArray(sharedPublications?.rows) ? sharedPublications.rows : [];
  const availableCount = Number(sharedPublications?.available_count || 0);
  const documentCount = Number(sharedPublications?.document_count || 0);
  sourceNeighborCountElement.textContent = availableCount
    ? `${availableCount.toLocaleString()} other case${availableCount === 1 ? "" : "s"}`
    : "No shared cases";
  document.documentElement.dataset.caseDetailSourceNeighbors = String(availableCount);
  document.documentElement.dataset.caseDetailSourceNeighborRows = String(rows.length);
  if (!rows.length) {
    sourceNeighborListElement.innerHTML = `<p class="case-detail-empty">No other mapped cases are currently connected through this record's stable archive document IDs.</p>`;
    return;
  }
  sourceNeighborListElement.innerHTML = rows.map(row => {
    const recordId = caseField(row, "id");
    const collection = caseField(row, "collection");
    const href = caseDetailUrl(recordId, collection);
    const documents = Array.isArray(row.shared_documents) ? row.shared_documents : [];
    const labels = documents.map(document => document.label).filter(Boolean);
    const archiveUrl = documents.length
      ? archiveRecordUrl({afu_document_id: documents[0].document_id})
      : "";
    return `<article>
      <p class="eyebrow">${escapeHtml(COLLECTION_LABELS[collection] || collection || "Mapped collection")}</p>
      <h3><a href="${escapeHtml(href)}">${escapeHtml(caseField(row, "title") || recordId)}</a></h3>
      <p>${escapeHtml([caseField(row, "date"), caseField(row, "location"), caseField(row, "country")].filter(Boolean).join(" Â· "))}</p>
      <p class="source-neighbor-context">${escapeHtml(labels.length ? `Also cited in ${labels.join("; ")}` : `${Number(row.shared_source_count || 1).toLocaleString()} shared publication`)}</p>
      <div>
        <a href="${escapeHtml(href)}">Open full case</a>
        ${archiveUrl ? `<a href="${escapeHtml(archiveUrl)}">Open shared publication</a>` : ""}
      </div>
    </article>`;
  }).join("");
  if (availableCount > rows.length) {
    sourceNeighborListElement.insertAdjacentHTML(
      "beforeend",
      `<p class="case-detail-empty">${(availableCount - rows.length).toLocaleString()} additional source-connected case${availableCount - rows.length === 1 ? "" : "s"} omitted from this compact view. Search the linked publications to continue exploring.</p>`
    );
  }
  sourceNeighborCountElement.title = `${availableCount.toLocaleString()} other mapped case${availableCount === 1 ? "" : "s"} across ${documentCount.toLocaleString()} linked publication${documentCount === 1 ? "" : "s"}`;
}

function openEvidencePreview(source) {
  const url = evidenceUrl(source);
  const previewUrl = evidencePreviewUrl(url);
  if (!previewUrl) return;
  previewTitle.textContent = sourceLabel(source);
  previewMeta.textContent = [
    source.online_source_page || source.search_hit_page ? `Page ${source.online_source_page || source.search_hit_page}` : "",
    readableStatus(source),
  ].filter(Boolean).join(" · ");
  previewExternal.href = url;
  previewFrame.src = previewUrl;
  previewPanel.hidden = false;
  document.body.classList.add("case-preview-open");
}

function closeEvidencePreview() {
  previewPanel.hidden = true;
  previewFrame.removeAttribute("src");
  previewExternal.href = "#";
  document.body.classList.remove("case-preview-open");
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      // Fall through to the selection-based browser fallback.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

function showError(message, recordId = "") {
  document.documentElement.dataset.caseDetailState = "error";
  contentElement.hidden = true;
  actionsElement.hidden = true;
  errorElement.hidden = false;
  errorMessageElement.textContent = message;
  if (recordId) {
    const url = new URL(SEARCH_UI_BASE_URL);
    url.searchParams.set("q", recordId);
    url.searchParams.set("intent", "cases");
    url.searchParams.set("autorun", "1");
    errorSearchLink.href = url.href;
  }
  statusElement.textContent = message;
}

async function start() {
  const recordId = String(urlParams.get("id") || "").trim();
  const collection = String(urlParams.get("collection") || "").trim();
  if (!recordId) {
    showError("This address does not include a mapped-case record ID.");
    return;
  }
  try {
    initializeWorker();
    await initializeMapRelease();
    statusElement.textContent = "Loading the compact public case index…";
    const caseBuffer = await fetchCompressed(CASE_DISCOVERY_BUNDLE_PATH);
    const initialized = await workerCall("init", {compressedBuffer: caseBuffer}, [caseBuffer]);
    document.documentElement.dataset.caseDetailIndexRecords = String(initialized.recordCount || 0);
    const lookup = await workerCall("lookup", {recordId, collection});
    if (!lookup.record) {
      showError(`No mapped case with record ID ${recordId} was found in the active public release.`, recordId);
      return;
    }
    renderRecord(lookup.record);
    renderEvidence(lookup.record, []);
    renderSharedPublications(null);
    renderRelated(null);
    statusElement.textContent = "Case metadata ready. Loading public evidence and related-record context…";
    const [evidenceBuffer, incidentBuffer] = await Promise.all([
      fetchCompressed(MAP_EVIDENCE_BUNDLE_PATH),
      fetchCompressed(INCIDENT_CLUSTERS_PATH),
    ]);
    const detail = await workerCall("detail", {
      recordId,
      collection: caseField(lookup.record, "collection"),
      compressedEvidenceBuffer: evidenceBuffer,
      compressedIncidentBuffer: incidentBuffer,
    }, [evidenceBuffer, incidentBuffer]);
    renderEvidence(lookup.record, detail.sources);
    renderSharedPublications(detail.shared_publications);
    renderRelated(detail.related);
    document.documentElement.dataset.caseDetailState = "ready";
    statusElement.textContent = `Loaded the current public record, ${Number(document.documentElement.dataset.caseDetailEvidenceLinks || 0).toLocaleString()} evidence link${document.documentElement.dataset.caseDetailEvidenceLinks === "1" ? "" : "s"}, ${Number(document.documentElement.dataset.caseDetailSourceNeighbors || 0).toLocaleString()} source-connected case${document.documentElement.dataset.caseDetailSourceNeighbors === "1" ? "" : "s"}, and related-record context from AFU.`;
  } catch (error) {
    if (currentRow) {
      document.documentElement.dataset.caseDetailState = "partial";
      statusElement.textContent = `Case metadata is available, but progressive evidence enrichment could not load: ${error.message}`;
      return;
    }
    showError(`Mapped-case data could not be loaded: ${error.message}`, recordId);
  }
}

citationButton?.addEventListener("click", async () => {
  if (!currentCitation) return;
  try {
    await writeClipboardText(currentCitation);
    citationButton.textContent = "Citation copied";
    statusElement.textContent = "Copied the stable mapped-case citation.";
    window.setTimeout(() => { citationButton.textContent = "Copy citation"; }, 1600);
  } catch (error) {
    statusElement.textContent = "Could not access the clipboard for this citation.";
  }
});

loadMapButton?.addEventListener("click", () => {
  if (!currentMapUrl) return;
  mapFrame.src = currentMapUrl;
  loadMapButton.hidden = true;
  unloadMapButton.hidden = false;
  document.documentElement.dataset.caseDetailMap = "loaded";
});

unloadMapButton?.addEventListener("click", () => {
  mapFrame.removeAttribute("src");
  loadMapButton.hidden = false;
  unloadMapButton.hidden = true;
  document.documentElement.dataset.caseDetailMap = "unloaded";
});

closePreviewButton?.addEventListener("click", closeEvidencePreview);
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !previewPanel.hidden) closeEvidencePreview();
});

start();
