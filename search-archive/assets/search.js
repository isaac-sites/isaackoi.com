let collections = [];
let allSeries = [];
let issues = [];
const pagesBySeries = new Map();
const indexBySeries = new Map();
const termManifestByCollection = new Map();
const termManifestShardByCollection = new Map();
const globalTermRouterShardCache = new Map();
const hybridMetadataByCollection = new Map();
const hybridShardByCollection = new Map();
const localLinksByDocumentId = new Map();
const mapSourcesByDocumentId = new Map();
const mapSourcesByRecordId = new Map();
const pageIntelligenceByIssue = new Map();
const caseDossierByRecordId = new Map();
let geipanSourceRecords = [];
let lacUfoSourceRecords = [];
let catalogueLoadMode = "per-collection";
let unavailableCatalogueEntries = [];

const AFU_PUBLIC_SEARCH_DATA_BASE = "https://files.afu.se/Downloads/search/";
const AFU_PUBLIC_MAP_DATA_BASE = "https://files.afu.se/Downloads/mapview/";

function isLocalArchivePreview() {
  return window.location.protocol === "file:"
    || ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname.toLocaleLowerCase());
}

function configuredSearchDataBase() {
  const publicDataPreview = new URLSearchParams(window.location.search).get("publicData") === "1";
  if (isLocalArchivePreview() && !publicDataPreview) return new URL("./", window.location.href);
  const configured = document.querySelector('meta[name="afu-search-data-base"]')?.content.trim();
  return new URL(configured || AFU_PUBLIC_SEARCH_DATA_BASE, window.location.href);
}

function configuredMapEvidenceDataBase() {
  const publicDataPreview = new URLSearchParams(window.location.search).get("publicData") === "1";
  if (isLocalArchivePreview() && !publicDataPreview) return new URL("../mapview/", window.location.href);
  const configured = document.querySelector('meta[name="afu-map-data-base"]')?.content.trim();
  return new URL(configured || AFU_PUBLIC_MAP_DATA_BASE, window.location.href);
}

const SEARCH_DATA_ROOT_URL = configuredSearchDataBase();
let SEARCH_DATA_BASE_URL = SEARCH_DATA_ROOT_URL;
let activeDataRelease = "";
const SEARCH_RUNTIME_CACHE_PREFIX = "isaac-koi-search-data-v1-";
const SEARCH_RUNTIME_CACHE_MAX_ENTRIES = 96;
let searchRuntimeCacheName = "";
const MAP_EVIDENCE_DATA_ROOT_URL = configuredMapEvidenceDataBase();
let MAP_EVIDENCE_DATA_BASE_URL = MAP_EVIDENCE_DATA_ROOT_URL;
let activeMapEvidenceRelease = "";
const MAP_EVIDENCE_CACHE_PREFIX = "isaac-koi-map-data-v1-";
const MAP_EVIDENCE_CACHE_MAX_ENTRIES = 24;
const MAP_EVIDENCE_BUNDLE_PATH = "data/search_map_evidence_public.json";
const CASE_DISCOVERY_BUNDLE_PATH = "data/case_discovery_public.json";
const CASE_SEARCH_WORKER_PATH = "assets/case-search-worker.js?v=2";
const CASE_DISCOVERY_FIELDS = [
  "id", "collection", "title", "date", "year", "location", "region",
  "country", "type", "classification", "source_count", "source_labels", "evidence_url",
];
const CASE_FIELD = Object.freeze(Object.fromEntries(CASE_DISCOVERY_FIELDS.map((field, index) => [field, index])));
const CASE_COLLECTION_LABELS = Object.freeze({
  "blue-book": "Project Blue Book / Fold3",
  ufocat: "UFOCAT",
  "source-first": "Source-first research records",
  geipan: "GEIPAN",
  lac: "Library and Archives Canada",
});
let mapEvidenceCacheName = "";
document.documentElement.dataset.archiveDataOrigin = SEARCH_DATA_ROOT_URL.origin;
document.documentElement.dataset.mapEvidenceDataOrigin = MAP_EVIDENCE_DATA_ROOT_URL.origin;

function configuredInterfaceBase(metaName, fallback) {
  const configured = document.querySelector(`meta[name="${metaName}"]`)?.content.trim();
  return new URL(configured || fallback, window.location.href);
}

const SEARCH_UI_BASE_URL = configuredInterfaceBase("afu-search-ui-base", "./");
const MAP_UI_BASE_URL = configuredInterfaceBase("afu-map-ui-base", "../mapview/");
const SEARCH_ASSET_BASE_URL = document.currentScript?.src
  ? new URL("../", document.currentScript.src)
  : new URL("./", window.location.href);
document.documentElement.dataset.archiveUiOrigin = SEARCH_UI_BASE_URL.origin;

function interfaceUrl(value, legacyPrefix, baseUrl) {
  const raw = String(value || "").trim();
  if (!raw) return baseUrl.href;
  if (raw === legacyPrefix || raw.startsWith(`${legacyPrefix}/`) || raw.startsWith(`${legacyPrefix}?`)) {
    return new URL(raw.slice(legacyPrefix.length).replace(/^\//, ""), baseUrl).href;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.origin === "https://files.afu.se" && (parsed.pathname === legacyPrefix || parsed.pathname.startsWith(`${legacyPrefix}/`))) {
      const suffix = parsed.pathname.slice(legacyPrefix.length).replace(/^\//, "");
      const resolved = new URL(suffix, baseUrl);
      resolved.search = parsed.search;
      resolved.hash = parsed.hash;
      return resolved.href;
    }
  } catch (error) {
    // Relative URLs are resolved below.
  }
  return new URL(raw, baseUrl).href;
}

function searchUiUrl(value = "") {
  return interfaceUrl(value, "/Downloads/search", SEARCH_UI_BASE_URL);
}

function mapUiUrl(value = "") {
  return interfaceUrl(value, "/Downloads/mapview", MAP_UI_BASE_URL);
}

function archiveDataUrl(value) {
  return new URL(value, SEARCH_DATA_BASE_URL).href;
}

function mapEvidenceDataUrl(value) {
  return new URL(value, MAP_EVIDENCE_DATA_BASE_URL).href;
}

function runtimeCacheReleaseKey() {
  return String(activeDataRelease || "").toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80);
}

function isPersistentlyCacheableArchiveUrl(value) {
  if (!searchRuntimeCacheName || !activeDataRelease || !("caches" in window)) return false;
  const url = new URL(value);
  if (url.origin !== SEARCH_DATA_BASE_URL.origin || !url.href.startsWith(SEARCH_DATA_BASE_URL.href)) return false;
  const path = url.pathname.toLocaleLowerCase();
  return path.endsWith("/collections.json")
    || path.includes("/catalogue/")
    || path.includes("/global-term-router/")
    || path.includes("/term-manifest/")
    || path.includes("/hybrid/");
}

async function trimSearchRuntimeCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - SEARCH_RUNTIME_CACHE_MAX_ENTRIES;
  if (overflow > 0) {
    await Promise.all(keys.slice(0, overflow).map(request => cache.delete(request)));
  }
  document.documentElement.dataset.archivePersistentCacheEntries = String(
    Math.min(keys.length, SEARCH_RUNTIME_CACHE_MAX_ENTRIES)
  );
}

async function activateSearchRuntimeCache() {
  if (!activeDataRelease || !("caches" in window)) return;
  searchRuntimeCacheName = `${SEARCH_RUNTIME_CACHE_PREFIX}${runtimeCacheReleaseKey()}`;
  document.documentElement.dataset.archivePersistentCache = "enabled";
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(SEARCH_RUNTIME_CACHE_PREFIX) && name !== searchRuntimeCacheName)
        .map(name => caches.delete(name))
    );
    const cache = await caches.open(searchRuntimeCacheName);
    document.documentElement.dataset.archivePersistentCacheEntries = String((await cache.keys()).length);
  } catch (error) {
    document.documentElement.dataset.archivePersistentCache = "unavailable";
    console.warn("Persistent search cache cleanup was unavailable.", error);
  }
}

async function fetchArchiveResponse(resolvedUrl) {
  const request = new Request(resolvedUrl, {mode: "cors", credentials: "omit"});
  if (!isPersistentlyCacheableArchiveUrl(resolvedUrl)) return fetch(request);
  let cache;
  try {
    cache = await caches.open(searchRuntimeCacheName);
    const cached = await cache.match(request);
    if (cached) {
      document.documentElement.dataset.archivePersistentCache = "hit";
      return cached;
    }
  } catch (error) {
    document.documentElement.dataset.archivePersistentCache = "unavailable";
    console.warn("Persistent search cache read was unavailable.", error);
    return fetch(request);
  }
  const response = await fetch(request);
  if (response.ok) {
    void cache.put(request, response.clone())
      .then(() => trimSearchRuntimeCache(cache))
      .catch(error => {
        document.documentElement.dataset.archivePersistentCache = "unavailable";
        console.warn("Persistent search cache write was unavailable.", error);
      });
  }
  return response;
}

function mapEvidenceCacheReleaseKey() {
  return String(activeMapEvidenceRelease || "").toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80);
}

async function trimMapEvidenceCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAP_EVIDENCE_CACHE_MAX_ENTRIES;
  if (overflow > 0) {
    await Promise.all(keys.slice(0, overflow).map(request => cache.delete(request)));
  }
  document.documentElement.dataset.mapEvidenceCacheEntries = String(
    Math.min(keys.length, MAP_EVIDENCE_CACHE_MAX_ENTRIES)
  );
}

async function activateMapEvidenceCache() {
  if (!activeMapEvidenceRelease || !("caches" in window)) return;
  mapEvidenceCacheName = `${MAP_EVIDENCE_CACHE_PREFIX}${mapEvidenceCacheReleaseKey()}`;
  document.documentElement.dataset.mapEvidenceCache = "enabled";
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(MAP_EVIDENCE_CACHE_PREFIX) && name !== mapEvidenceCacheName)
        .map(name => caches.delete(name))
    );
    const cache = await caches.open(mapEvidenceCacheName);
    document.documentElement.dataset.mapEvidenceCacheEntries = String((await cache.keys()).length);
  } catch (error) {
    document.documentElement.dataset.mapEvidenceCache = "unavailable";
    console.warn("Persistent map-evidence cache cleanup was unavailable.", error);
  }
}

async function fetchMapEvidenceResponse(resolvedUrl) {
  const request = new Request(resolvedUrl, {mode: "cors", credentials: "omit"});
  const url = new URL(resolvedUrl);
  const cacheable = mapEvidenceCacheName
    && activeMapEvidenceRelease
    && "caches" in window
    && url.origin === MAP_EVIDENCE_DATA_BASE_URL.origin
    && url.href.startsWith(MAP_EVIDENCE_DATA_BASE_URL.href)
    && url.pathname.endsWith(".json.gz");
  if (!cacheable) {
    return fetch(request);
  }
  let cache;
  try {
    cache = await caches.open(mapEvidenceCacheName);
    const cached = await cache.match(request);
    if (cached) {
      document.documentElement.dataset.mapEvidenceCache = "hit";
      return cached;
    }
  } catch (error) {
    document.documentElement.dataset.mapEvidenceCache = "unavailable";
    console.warn("Persistent map-evidence cache read was unavailable.", error);
    return fetch(request);
  }
  const response = await fetch(request);
  if (response.ok) {
    void cache.put(request, response.clone())
      .then(() => trimMapEvidenceCache(cache))
      .catch(error => {
        document.documentElement.dataset.mapEvidenceCache = "unavailable";
        console.warn("Persistent map-evidence cache write was unavailable.", error);
      });
  }
  return response;
}

function validatedReleaseDataUrl(pointer, expectedKind, rootUrl) {
  if (pointer?.schema_version !== 1 || pointer?.package_kind !== expectedKind || !pointer?.release_id) return null;
  const dataPath = String(pointer.data_path || "");
  if (!dataPath || dataPath.startsWith("/") || dataPath.includes("..") || !dataPath.endsWith("/")) return null;
  const resolved = new URL(dataPath, rootUrl);
  if (resolved.origin !== rootUrl.origin || !resolved.href.startsWith(rootUrl.href)) return null;
  return resolved;
}

async function initializeSearchDataRelease() {
  const previewParams = new URLSearchParams(window.location.search);
  const publicDataPreview = previewParams.get("publicData") === "1";
  const releaseDataPreview = previewParams.get("releaseData") === "1";
  if (isLocalArchivePreview() && !publicDataPreview && !releaseDataPreview) return;
  try {
    const pointerUrl = new URL("release.json", SEARCH_DATA_ROOT_URL);
    const response = await fetch(pointerUrl, {mode: "cors", credentials: "omit", cache: "no-cache"});
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Release pointer returned HTTP ${response.status}`);
    const pointer = await response.json();
    const releaseUrl = validatedReleaseDataUrl(pointer, "search", SEARCH_DATA_ROOT_URL);
    if (!releaseUrl) throw new Error("Release pointer is malformed or unsafe.");
    SEARCH_DATA_BASE_URL = releaseUrl;
    activeDataRelease = String(pointer.release_id);
    document.documentElement.dataset.archiveDataRelease = activeDataRelease;
    await activateSearchRuntimeCache();
  } catch (error) {
    console.warn("Versioned search release unavailable; using the compatible data root.", error);
  }
}

async function initializeMapEvidenceDataRelease() {
  const previewParams = new URLSearchParams(window.location.search);
  const publicDataPreview = previewParams.get("publicData") === "1";
  const releaseDataPreview = previewParams.get("releaseData") === "1";
  if (isLocalArchivePreview() && !publicDataPreview && !releaseDataPreview) return;
  try {
    const pointerUrl = new URL("release.json", MAP_EVIDENCE_DATA_ROOT_URL);
    const response = await fetch(pointerUrl, {mode: "cors", credentials: "omit", cache: "no-cache"});
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Map release pointer returned HTTP ${response.status}`);
    const pointer = await response.json();
    const releaseUrl = validatedReleaseDataUrl(pointer, "map", MAP_EVIDENCE_DATA_ROOT_URL);
    if (!releaseUrl) throw new Error("Map release pointer is malformed or unsafe.");
    MAP_EVIDENCE_DATA_BASE_URL = releaseUrl;
    activeMapEvidenceRelease = String(pointer.release_id);
    document.documentElement.dataset.mapEvidenceDataRelease = activeMapEvidenceRelease;
    await activateMapEvidenceCache();
  } catch (error) {
    console.warn("Versioned map evidence unavailable; using the compatible map data root.", error);
  }
}

const queryInput = document.getElementById("query");
const allWordsInput = document.getElementById("all-words");
const exactPhraseInput = document.getElementById("exact-phrase");
const anyWordsInput = document.getElementById("any-words");
const noneWordsInput = document.getElementById("none-words");
const yearMinInput = document.getElementById("year-min");
const yearMaxInput = document.getElementById("year-max");
const fullTextInput = document.getElementById("full-text");
const searchIntentInput = document.getElementById("search-intent");
const languageFilterInput = document.getElementById("language-filter");
const resultsElement = document.getElementById("results");
const statusElement = document.getElementById("status");
const scopeStatusElement = document.getElementById("scope-status");
const archiveStatsElement = document.getElementById("archive-stats");
const featuredCollectionsElement = document.getElementById("featured-collections");
const showResultsMapElement = document.getElementById("show-results-map");
const coverageDashboardElement = document.getElementById("coverage-dashboard");
const newlySearchableElement = document.getElementById("newly-searchable");
const collectionSpotlightElement = document.getElementById("collection-spotlight");
const sourceRichBrowserElement = document.getElementById("source-rich-browser");
const browsePreviewElement = document.getElementById("browse-preview");
const seriesList = document.getElementById("series-list");
const collectionList = document.getElementById("collection-list");
const copyLinkButton = document.getElementById("copy-link");
const copyVisibleResultsButton = document.getElementById("copy-visible-results");
const downloadResultsCsvButton = document.getElementById("download-results-csv");
const downloadResultsJsonButton = document.getElementById("download-results-json");
const resultSortInput = document.getElementById("result-sort");
const resultFacetsElement = document.getElementById("result-facets");
const facetDecadeInput = document.getElementById("facet-decade");
const facetEvidenceInput = document.getElementById("facet-evidence");
const facetSourceInput = document.getElementById("facet-source");
const facetPageLinkInput = document.getElementById("facet-page-link");
const clearResultFacetsButton = document.getElementById("clear-result-facets");
const activeResultFacetCountElement = document.getElementById("active-result-facet-count");
const resultFacetStatusElement = document.getElementById("result-facet-status");
const archiveScopePanel = document.getElementById("archive-scope-panel");
const caseResultControls = document.getElementById("case-result-controls");
const caseCollectionFilter = document.getElementById("case-collection-filter");
const caseCountryFilter = document.getElementById("case-country-filter");
const caseEvidenceFilter = document.getElementById("case-evidence-filter");
const clearCaseFiltersButton = document.getElementById("clear-case-filters");
const caseFilterStatus = document.getElementById("case-filter-status");
const resultsLayout = document.getElementById("results-layout");
const resultsMapPanel = document.getElementById("results-map-panel");
const resultsMapFrame = document.getElementById("results-map-frame");
const resultsMapNote = document.getElementById("results-map-note");
const toggleResultsMapButton = document.getElementById("toggle-results-map");
const closeResultsMapButton = document.getElementById("close-results-map");
const openResultsMapLink = document.getElementById("open-results-map");
const pageSize = 25;
const maxStoredPagesPerResult = 20;
const maxSnippetsPerResult = 3;
const maxTextValidationShardLoads = 24;
const featuredSearches = {
  radar: "radar report",
  landings: "landing trace",
  photographs: "photograph photo",
  australia: "Australia",
  congress: "congress hearing",
  hynek: "Hynek",
  "blue-book": "Project Blue Book",
  geipan: "questionnaire",
  france: "ovni lumiere",
  "geipan-class-d": "classification D",
  ldln: "LDLN Lumiere Nuit",
  "french-photos": "photo photographie",
  "french-landings": "atterrissage trace",
};
let currentResults = [];
let facetUniverse = [];
let visibleCount = pageSize;
let currentResultNote = "";
let currentTerms = [];
let requestedIssue = null;
let requestedPage = null;
let requestedMapRecordIds = new Set();
let deepLinkWarnings = [];
let currentCriteria = null;
let catalogueLoaded = false;
let catalogueLoadError = "";
let lastSearchStats = null;
let currentSearchWarnings = [];
let currentSearchRunId = 0;
let collectionLandingSummary = null;
let globalTermRouter = null;
let focusResultsOnNextSearch = false;
let currentSearchTruncated = false;
let pendingResultFacets = {decade: "", evidence: "", source: "", pageLink: ""};
let mapEvidenceLoadPromise = null;
let mapEvidenceLoadState = "idle";
let caseDiscoveryLoadPromise = null;
let caseDiscoveryRecords = [];
let caseDiscoveryRecordCount = 0;
let caseDiscoveryCollectionCount = 0;
let caseUniverse = [];
let caseSearchWorker = null;
let caseSearchWorkerReadyPromise = null;
let caseSearchWorkerRequestId = 0;
let caseSearchRefreshId = 0;
const caseSearchWorkerRequests = new Map();
let caseSearchEngine = "uninitialized";
let currentCaseCriteria = null;
let caseSearchSummary = {
  totalMatches: 0,
  filteredCount: 0,
  collectionCounts: [],
  countryCounts: [],
  durationMs: 0,
};
let currentResultMode = "documents";
let pendingCaseFilters = {collection: "", country: "", evidence: false};
let resultsMapOpen = false;

function requestResultFocus() {
  focusResultsOnNextSearch = true;
}

function focusResultsIfRequested() {
  if (!focusResultsOnNextSearch) return;
  focusResultsOnNextSearch = false;
  const panel = document.querySelector(".results-panel");
  if (!panel) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.requestAnimationFrame(() => panel.scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block: "start"}));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, value => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[value]));
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("Clipboard timed out.")), 900)),
      ]);
      return;
    } catch (error) {
      // Fall through to a selection-based browser fallback.
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

function termsFromQuery(query) {
  return query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function activeSearchMode() {
  return document.querySelector('input[name="search-mode"]:checked')?.value || "basic";
}

function searchCriteria() {
  const yearMin = parseYearInput(yearMinInput?.value);
  const yearMax = parseYearInput(yearMaxInput?.value);
  if (activeSearchMode() === "basic") {
    return {
      all: termsFromQuery(queryInput.value),
      phrase: "",
      phraseTerms: [],
      any: [],
      none: [],
      yearMin,
      yearMax,
    };
  }
  const phrase = exactPhraseInput.value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return {
    all: termsFromQuery(allWordsInput.value),
    phrase,
    phraseTerms: termsFromQuery(phrase),
    any: termsFromQuery(anyWordsInput.value),
    none: termsFromQuery(noneWordsInput.value),
    yearMin,
    yearMax,
  };
}

function positiveTerms(criteria) {
  return [...new Set([...criteria.all, ...criteria.phraseTerms, ...criteria.any])];
}

function hasPositiveCriteria(criteria) {
  return Boolean(criteria.all.length || criteria.phraseTerms.length || criteria.any.length);
}

function parseYearInput(value) {
  const year = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(year) && year >= 1800 && year <= 2100 ? year : null;
}

function issueYear(issue) {
  if (Number.isInteger(issue.publication_year)) return issue.publication_year;
  const haystack = `${issue.title || ""} ${issue.filename || ""} ${issue.remote_path || ""}`;
  const match = haystack.match(/\b(18|19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function issueMatchesYearRange(issue, criteria) {
  if (!criteria.yearMin && !criteria.yearMax) return true;
  const year = issueYear(issue);
  if (!year) return false;
  if (criteria.yearMin && year < criteria.yearMin) return false;
  if (criteria.yearMax && year > criteria.yearMax) return false;
  return true;
}

function textMatchesCriteria(text, criteria) {
  const haystack = String(text || "").toLocaleLowerCase();
  if (criteria.all.some(term => !haystack.includes(term))) return false;
  if (criteria.phrase && !haystack.replace(/\s+/g, " ").includes(criteria.phrase)) return false;
  if (criteria.any.length && !criteria.any.some(term => haystack.includes(term))) return false;
  if (criteria.none.some(term => haystack.includes(term))) return false;
  return true;
}

function needsTextValidation(criteria) {
  return Boolean(criteria.phrase || criteria.none.length);
}

function selectedSeries() {
  return new Set(
    [...document.querySelectorAll(".series-checkbox:checked")].map(input => input.value)
  );
}

function selectedCollections() {
  const checked = [...document.querySelectorAll(".collection-checkbox:checked")].map(input => input.value);
  if (checked.length) return new Set(checked);
  return new Set(collections.map(collection => collection.id));
}

function selectedAccessModes() {
  return new Set(
    [...document.querySelectorAll(".access-filter:checked")].map(input => input.value)
  );
}

function selectedIntelligenceFilters() {
  return new Set(
    [...document.querySelectorAll(".intelligence-filter:checked")].map(input => input.value)
  );
}

function activeResultFacets() {
  return {
    decade: facetDecadeInput?.value || "",
    evidence: facetEvidenceInput?.value || "",
    source: facetSourceInput?.value || "",
    pageLink: facetPageLinkInput?.value || "",
  };
}

function activeResultFacetCount() {
  return Object.values(activeResultFacets()).filter(Boolean).length;
}

function issueDecade(issue) {
  const year = issueYear(issue);
  return year ? String(Math.floor(year / 10) * 10) : "";
}

function sourceFacetCode(source) {
  return String(source.source_code || source.source_label || "").trim();
}

function issueSourceFamilies(issue) {
  return new Set(mapSourcesForIssue(issue).map(sourceFacetCode).filter(Boolean));
}

function issueHasPageResolvedEvidence(issue) {
  return mapSourcesForIssue(issue).some(source =>
    source.validation_status === "mapped_page_valid"
    || source.page_mapping_status === "manually_reviewed"
    || Boolean(source.online_source_page || source.search_hit_page)
  );
}

function issueMatchesResultFacets(issue, facets = activeResultFacets()) {
  if (facets.decade && issueDecade(issue) !== facets.decade) return false;
  const sources = mapSourcesForIssue(issue);
  const sourceFamilies = issueSourceFamilies(issue);
  if (facets.evidence === "mapped" && !sources.length) return false;
  if (facets.evidence === "multi-source" && sourceFamilies.size < 2) return false;
  if (facets.evidence === "dossier" && !caseDossiersForIssue(issue).length) return false;
  if (facets.source && !sourceFamilies.has(facets.source)) return false;
  if (facets.pageLink === "page" && !issueHasPageResolvedEvidence(issue)) return false;
  if (facets.pageLink === "issue" && (!sources.length || issueHasPageResolvedEvidence(issue))) return false;
  return true;
}

function setCountedOptionLabels(select, counts) {
  if (!select) return;
  [...select.options].forEach(option => {
    const label = option.dataset.label;
    if (!label) return;
    const count = Number(counts[option.value] || 0);
    option.textContent = option.value ? `${label} (${count.toLocaleString()})` : label;
  });
}

function renderResultFacetOptions() {
  if (!resultFacetsElement) return;
  const selected = activeResultFacets();
  for (const [key, value] of Object.entries(pendingResultFacets)) {
    if (value) selected[key] = value;
  }
  const decadeCounts = new Map();
  const sourceCounts = new Map();
  const sourceLabels = new Map();
  const evidenceCounts = {mapped: 0, "multi-source": 0, dossier: 0};
  const pageCounts = {page: 0, issue: 0};
  for (const row of facetUniverse) {
    const decade = issueDecade(row.issue);
    if (decade) decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
    const sources = mapSourcesForIssue(row.issue);
    const families = issueSourceFamilies(row.issue);
    for (const source of sources) {
      const code = sourceFacetCode(source);
      if (code && !sourceLabels.has(code)) sourceLabels.set(code, String(source.source_label || source.source_code || code));
    }
    for (const code of families) sourceCounts.set(code, (sourceCounts.get(code) || 0) + 1);
    if (sources.length) evidenceCounts.mapped += 1;
    if (families.size >= 2) evidenceCounts["multi-source"] += 1;
    if (caseDossiersForIssue(row.issue).length) evidenceCounts.dossier += 1;
    if (sources.length) {
      if (issueHasPageResolvedEvidence(row.issue)) pageCounts.page += 1;
      else pageCounts.issue += 1;
    }
  }
  if (facetDecadeInput) {
    const decades = [...decadeCounts].sort((left, right) => Number(left[0]) - Number(right[0]));
    if (selected.decade && !decadeCounts.has(selected.decade)) decades.push([selected.decade, 0]);
    facetDecadeInput.innerHTML = `<option value="">Any decade</option>${decades.map(([decade, count]) => `<option value="${escapeHtml(decade)}">${escapeHtml(decade)}s (${count.toLocaleString()})</option>`).join("")}`;
    facetDecadeInput.value = selected.decade;
  }
  if (facetSourceInput) {
    const sources = [...sourceCounts].sort((left, right) => (sourceLabels.get(left[0]) || left[0]).localeCompare(sourceLabels.get(right[0]) || right[0]));
    if (selected.source && !sourceCounts.has(selected.source)) sources.push([selected.source, 0]);
    const labelCounts = new Map();
    for (const [code] of sources) {
      const label = sourceLabels.get(code) || code;
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }
    facetSourceInput.innerHTML = `<option value="">Any source family</option>${sources.map(([code, count]) => {
      const label = sourceLabels.get(code) || code;
      const displayLabel = labelCounts.get(label) > 1 ? `${label} (${code})` : label;
      return `<option value="${escapeHtml(code)}">${escapeHtml(displayLabel)} (${count.toLocaleString()})</option>`;
    }).join("")}`;
    facetSourceInput.value = selected.source;
  }
  if (facetEvidenceInput) facetEvidenceInput.value = selected.evidence;
  if (facetPageLinkInput) facetPageLinkInput.value = selected.pageLink;
  setCountedOptionLabels(facetEvidenceInput, evidenceCounts);
  setCountedOptionLabels(facetPageLinkInput, pageCounts);
  pendingResultFacets = {decade: "", evidence: "", source: "", pageLink: ""};
  renderResultFacetStatus();
}

function renderResultFacetStatus() {
  if (!resultFacetsElement) return;
  if (currentResultMode === "cases") {
    resultFacetsElement.hidden = true;
    return;
  }
  resultFacetsElement.hidden = !facetUniverse.length;
  const activeCount = activeResultFacetCount();
  if (activeResultFacetCountElement) {
    activeResultFacetCountElement.hidden = !activeCount;
    activeResultFacetCountElement.textContent = `${activeCount} active`;
  }
  if (activeCount) resultFacetsElement.open = true;
  if (resultFacetStatusElement) {
    resultFacetStatusElement.textContent = activeCount
      ? `${currentResults.length.toLocaleString()} of ${facetUniverse.length.toLocaleString()} matches remain.`
      : `${facetUniverse.length.toLocaleString()} matches available to refine.`;
  }
  if (clearResultFacetsButton) clearResultFacetsButton.disabled = !activeCount;
}

function resultCountNote() {
  const shown = Math.min(visibleCount, currentResults.length);
  const prefix = currentSearchTruncated ? "Found at least" : "Found";
  if (currentResultMode === "cases") {
    const total = Number(caseSearchSummary.totalMatches || 0);
    const filtered = Number(caseSearchSummary.filteredCount || 0);
    return `${prefix} ${total.toLocaleString()} matching mapped case${total === 1 ? "" : "s"}; ${filtered.toLocaleString()} ${filtered === 1 ? "remains" : "remain"} after case filters; showing ${shown.toLocaleString()}.`;
  }
  if (activeResultFacetCount()) {
    return `${prefix} ${facetUniverse.length.toLocaleString()} matching record${facetUniverse.length === 1 ? "" : "s"}; ${currentResults.length.toLocaleString()} remain after refinements; showing ${shown.toLocaleString()}.`;
  }
  return `${prefix} ${currentResults.length.toLocaleString()} matching record${currentResults.length === 1 ? "" : "s"}; showing ${shown.toLocaleString()} ranked result${shown === 1 ? "" : "s"}.`;
}

function applyResultFacets() {
  currentResults = facetUniverse.filter(row => issueMatchesResultFacets(row.issue));
  sortCurrentResults();
  visibleCount = pageSize;
  renderResults();
  renderResultFacetStatus();
  currentResultNote = resultCountNote();
  updateStatus(`${currentResultNote}${warningSummary()}`);
  updateShareUrl();
  updateScopeStatus();
  hydrateVisibleSnippets(currentTerms, currentSearchRunId).catch(error => updateStatus(error.message));
}

function selectedLanguageMode() {
  return languageFilterInput?.value || "main";
}

function selectedSearchIntent() {
  return searchIntentInput?.value || "general";
}

function updateResultModePresentation() {
  const caseMode = selectedSearchIntent() === "cases";
  document.body.classList.toggle("case-search-mode", caseMode);
  if (archiveScopePanel) archiveScopePanel.hidden = caseMode;
  if (caseResultControls) caseResultControls.hidden = !caseMode;
  for (const element of [
    document.getElementById("full-text-option"),
    document.querySelector(".language-filter"),
    document.querySelector(".access-filters"),
    document.querySelector(".intelligence-filters"),
    document.querySelector(".quick-filters"),
  ]) {
    if (element) element.hidden = caseMode;
  }
  const searchButton = document.getElementById("search-button");
  if (searchButton) searchButton.textContent = caseMode ? "Search mapped cases" : "Search archive";
  if (queryInput) {
    queryInput.placeholder = caseMode
      ? "Try a place, case ID, date, classification, or source"
      : "Try a person, place, event, publication, or phrase";
    const help = queryInput.nextElementSibling;
    if (help?.classList.contains("field-help")) {
      help.textContent = caseMode
        ? "Search more than 24,000 mapped case records; the compact index loads only after you search."
        : "Search titles, catalogue metadata, and hundreds of thousands of indexed pages.";
    }
  }
  if (caseMode && scopeStatusElement) {
    scopeStatusElement.textContent = caseDiscoveryRecordCount
      ? `${caseDiscoveryRecordCount.toLocaleString()} mapped cases are ready to search. PDF collection and page-text filters do not apply in this mode.`
      : "The compact mapped-case index loads only when you search. PDF collection and page-text filters do not apply in this mode.";
  }
}

function currentSearchRequiresMapEvidence() {
  const facets = activeResultFacets();
  return selectedSearchIntent() === "mapped"
    || requestedMapRecordIds.size > 0
    || Boolean(facets.evidence || facets.source || facets.pageLink);
}

function rerunIfUseful() {
  updateShareUrl();
  updateScopeStatus();
  const criteria = searchCriteria();
  if (
    hasPositiveCriteria(criteria)
    || requestedIssue
    || (selectedSearchIntent() === "cases" && (criteria.yearMin || criteria.yearMax))
  ) runSearch().catch(error => updateStatus(error.message));
}

function setCollectionsByPrefix(prefix) {
  const matching = new Set(collections.filter(collection => String(collection.id || "").startsWith(`${prefix}/`)).map(collection => collection.id));
  document.querySelectorAll(".collection-checkbox").forEach(input => {
    input.checked = matching.has(input.value);
  });
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
  rerunIfUseful();
  renderBrowsePreview();
}

function setCollectionById(collectionId) {
  const exists = collections.some(collection => collection.id === collectionId);
  if (!exists) return false;
  document.querySelectorAll(".collection-checkbox").forEach(input => {
    input.checked = input.value === collectionId;
  });
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
  rerunIfUseful();
  renderBrowsePreview();
  return true;
}

function setCollectionsByPredicate(predicate) {
  const matching = new Set(collections.filter(predicate).map(collection => collection.id));
  if (!matching.size) return false;
  document.querySelectorAll(".collection-checkbox").forEach(input => {
    input.checked = matching.has(input.value);
  });
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
  rerunIfUseful();
  renderBrowsePreview();
  return true;
}

function isFrenchLanguage(row) {
  return row?.language === "fr" || String(row?.language_label || "").toLocaleLowerCase() === "french";
}

function isKnownNonEnglishLanguage(language) {
  const normalized = String(language || "").toLocaleLowerCase();
  return Boolean(normalized) && normalized !== "en" && normalized !== "mixed" && normalized !== "und" && normalized !== "unknown";
}

function isForeignLanguage(row) {
  return Boolean(row?.is_foreign_language_for_site) || isKnownNonEnglishLanguage(row?.language);
}

function normalizedLanguage(row) {
  return String(row?.language || "").toLocaleLowerCase();
}

function languageMatchesMode(row, mode = selectedLanguageMode()) {
  if (mode === "all") return true;
  const language = normalizedLanguage(row);
  if (mode === "main") return !isKnownNonEnglishLanguage(language);
  if (mode === "other") {
    return isKnownNonEnglishLanguage(language) && !["en", "fr", "de", "it", "es", "sv", "ru"].includes(language);
  }
  return language === mode;
}

function issueIntelligenceKey(issue) {
  return `${issue.collection_id}:${issue.id}`;
}

function intelligenceForIssue(issue) {
  return issue.page_intelligence || pageIntelligenceByIssue.get(issueIntelligenceKey(issue)) || null;
}

function issueMatchesIntelligenceFilters(issue, filters = selectedIntelligenceFilters()) {
  if (!filters.size) return true;
  const intelligence = intelligenceForIssue(issue);
  if (!intelligence) return false;
  const flags = new Set(intelligence.flags || []);
  for (const filter of filters) {
    if (!flags.has(filter)) return false;
  }
  return true;
}

function likelySightingPage(issue) {
  const intelligence = intelligenceForIssue(issue);
  const first = Array.isArray(intelligence?.likely_pages) ? intelligence.likely_pages[0] : null;
  return Array.isArray(first) ? Number(first[0]) || null : null;
}

function inferredLanguageMetadata(collectionId, title = "") {
  const id = String(collectionId || "").replace(/\\/g, "/").toLocaleLowerCase();
  const text = String(title || "").toLocaleLowerCase();
  const language = id === "documents/france-geipan" || id === "magazines/france" || id.endsWith("/france") || text.endsWith(" / france")
    ? "fr"
    : "en";
  return {
    language,
    language_label: language === "fr" ? "French" : "English",
    is_foreign_language_for_site: language !== "en",
    language_confidence: "client_collection_inferred",
  };
}

function withLanguageFallback(row, collection = null) {
  const fallback = inferredLanguageMetadata(row?.collection_id || collection?.id, row?.collection_title || collection?.title || "");
  return {
    ...fallback,
    ...row,
    language: row?.language || collection?.language || fallback.language,
    language_label: row?.language_label || collection?.language_label || fallback.language_label,
    is_foreign_language_for_site: row?.is_foreign_language_for_site ?? collection?.is_foreign_language_for_site ?? fallback.is_foreign_language_for_site,
    language_confidence: row?.language_confidence || collection?.language_confidence || fallback.language_confidence,
  };
}

function setFullTextOnly(enabled) {
  const indexed = new Set(allSeries.filter(series => Number(series.indexed_text_pages || 0) > 0).map(series => series.selection_id));
  document.querySelectorAll(".collection-checkbox").forEach(input => { input.checked = true; });
  document.querySelectorAll(".series-checkbox").forEach(input => {
    input.checked = enabled ? indexed.has(input.value) : false;
  });
  rerunIfUseful();
  renderBrowsePreview();
}

function resetQuickScope() {
  document.querySelectorAll(".collection-checkbox").forEach(input => { input.checked = true; });
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
  document.querySelectorAll(".intelligence-filter").forEach(input => { input.checked = false; });
  if (languageFilterInput) languageFilterInput.value = "all";
  rerunIfUseful();
  renderBrowsePreview();
}

function applyFeaturedSearch(key) {
  const query = featuredSearches[key];
  if (!query) return;
  document.querySelector('input[name="search-mode"][value="basic"]').checked = true;
  document.getElementById("basic-search").hidden = false;
  document.getElementById("advanced-search").hidden = true;
  queryInput.value = query;
  fullTextInput.checked = true;
  if ((key === "geipan" || key === "geipan-class-d") && setCollectionById("documents/france-geipan")) return;
  if (key === "ldln" && setCollectionsByPredicate(collection => collection.id === "magazines/france")) {
    const ldlnSeries = new Set(
      allSeries
        .filter(series => series.collection_id === "magazines/france" && /lumi[eè]res?\s+dans\s+la\s+nuit|ldln/i.test(series.title || series.id || ""))
        .map(series => series.selection_id)
    );
    if (ldlnSeries.size) {
      document.querySelectorAll(".series-checkbox").forEach(input => {
        input.checked = ldlnSeries.has(input.value);
      });
      rerunIfUseful();
      renderBrowsePreview();
    }
    return;
  }
  if ((key === "france" || key === "french-photos" || key === "french-landings")
    && setCollectionsByPredicate(collection => collection.id === "documents/france-geipan" || collection.id === "magazines/france")) return;
  resetQuickScope();
}

function updateStatus(message) {
  statusElement.textContent = deepLinkWarnings.length ? `${message} ${deepLinkWarnings.join(" ")}` : message;
}

function warningKey(warning) {
  return `${warning.kind}:${warning.seriesId || ""}:${warning.detail || ""}`;
}

function recordSearchWarning(kind, series, error, detail = "") {
  const warning = {
    kind,
    seriesId: series?.id || "",
    seriesTitle: series?.title || series?.collection_title || "Search data",
    detail: detail || error?.message || String(error || "Unknown search data error"),
  };
  const existing = new Set(currentSearchWarnings.map(warningKey));
  if (!existing.has(warningKey(warning))) currentSearchWarnings.push(warning);
  if (series) series.search_status = kind === "text_shard" ? "metadata_only_fallback" : "validation_failed";
}

function warningSummary() {
  if (!currentSearchWarnings.length) return "";
  const shown = currentSearchWarnings.slice(0, 4)
    .map(warning => `${warning.seriesTitle}: ${warning.detail}`)
    .join("; ");
  const more = currentSearchWarnings.length > 4 ? `; ${currentSearchWarnings.length - 4} more` : "";
  return ` Warnings: ${currentSearchWarnings.length} search data load${currentSearchWarnings.length === 1 ? "" : "s"} failed (${shown}${more}).`;
}

function catalogueMissingMessage(error = "") {
  const detail = error ? ` ${error}` : "";
  return `The generated search catalogue is not loaded.${detail} Run python scripts/serve_search_preview.py and open http://127.0.0.1:8879/, or build the static package and open artifacts/afu-search-site/.`;
}

function showCatalogueLoadFailure(error) {
  catalogueLoaded = false;
  catalogueLoadError = catalogueMissingMessage(error?.message || String(error || ""));
  collections = [];
  allSeries = [];
  issues = [];
  currentResults = [];
  collectionList.innerHTML = "";
  seriesList.innerHTML = "";
  resultsElement.innerHTML = `<p class="empty-state load-error">${escapeHtml(catalogueLoadError)}</p>`;
  if (scopeStatusElement) scopeStatusElement.textContent = "No generated catalogue is loaded.";
  updateStatus(catalogueLoadError);
}

async function loadOptionalGlobalTermRouter(registry) {
  const routerPath = registry.find(entry => entry?.global_term_router?.path)?.global_term_router?.path;
  if (!routerPath) {
    globalTermRouter = null;
    return;
  }
  try {
    globalTermRouter = normalizeGlobalTermRouter(await readJson(routerPath));
  } catch (error) {
    console.warn("Global term router unavailable.", error);
    globalTermRouter = null;
  }
}

function countOccurrences(text, term) {
  if (!term) return 0;
  return (String(text).toLocaleLowerCase().match(new RegExp(escapeRegExp(term), "g")) || []).length;
}

function foldDiacritics(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightedSnippet(text, terms, phrase = "") {
  const normalizedPhrase = String(phrase || "").replace(/\s+/g, " ").trim();
  const source = String(text || "");
  const matches = [];
  if (normalizedPhrase.length >= 3) {
    const pattern = new RegExp(escapeRegExp(normalizedPhrase).replace(/\\ /g, "\\s+"), "gi");
    for (const match of source.matchAll(pattern)) {
      matches.push({start: match.index, end: match.index + match[0].length, phrase: true});
    }
  }
  for (const term of [...new Set(terms)].filter(term => term.length >= 3)) {
    const pattern = new RegExp(escapeRegExp(term), "gi");
    for (const match of source.matchAll(pattern)) {
      matches.push({start: match.index, end: match.index + match[0].length, phrase: false});
    }
  }
  matches.sort((a, b) => a.start - b.start || Number(b.phrase) - Number(a.phrase) || (b.end - b.start) - (a.end - a.start));
  const selected = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    selected.push(match);
    cursor = match.end;
  }
  if (!selected.length) return escapeHtml(source);
  let rendered = "";
  cursor = 0;
  for (const match of selected) {
    rendered += escapeHtml(source.slice(cursor, match.start));
    rendered += `<mark${match.phrase ? ' class="phrase-mark"' : ""}>${escapeHtml(source.slice(match.start, match.end))}</mark>`;
    cursor = match.end;
  }
  rendered += escapeHtml(source.slice(cursor));
  return rendered;
}

function issuePreviewLabel(issue) {
  const series = String(issue.series || issue.collection_title || "PDF").trim();
  return series
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toLocaleUpperCase()
    .slice(0, 4) || "PDF";
}

function documentPreviewMarkup(issue, openPdfUrl, pageCount) {
  if (issue.thumbnail_url && openPdfUrl) {
    return `<a class="thumbnail-link" href="${escapeHtml(openPdfUrl)}" target="_blank" rel="noopener" aria-label="Open PDF">
      <img class="thumbnail" src="${escapeHtml(issue.thumbnail_url)}" alt="" loading="lazy" decoding="async" onerror="const link=this.closest('.thumbnail-link'); const fallback=link?.nextElementSibling; fallback?.classList.remove('fallback-preview'); link?.remove();">
    </a>
    <a class="pdf-preview fallback-preview" href="${escapeHtml(openPdfUrl)}" target="_blank" rel="noopener" aria-label="Open PDF preview">
      <span class="pdf-preview-label">${escapeHtml(issuePreviewLabel(issue))}</span>
      <span class="pdf-preview-type">PDF</span>
      <span class="pdf-preview-pages">${pageCount ? `${pageCount.toLocaleString()} pages` : "full text"}</span>
    </a>`;
  }
  if (!openPdfUrl) return "";
  return `<a class="pdf-preview" href="${escapeHtml(openPdfUrl)}" target="_blank" rel="noopener" aria-label="Open PDF preview">
    <span class="pdf-preview-label">${escapeHtml(issuePreviewLabel(issue))}</span>
    <span class="pdf-preview-type">PDF</span>
    <span class="pdf-preview-pages">${pageCount ? `${pageCount.toLocaleString()} pages` : "full text"}</span>
  </a>`;
}

function pdfOpenUrl(issue, page, terms) {
  const fileUrl = issue.local_pdf_url || issue.pdf_url;
  if (!fileUrl) return "";
  const viewer = new URL("pdfjs/web/viewer.html", window.location.href);
  viewer.searchParams.set("v", "20260607-1");
  viewer.searchParams.set("file", fileUrl);
  const fragments = [];
  if (page) fragments.push(`page=${encodeURIComponent(page)}`);
  if (terms.length) fragments.push(`search=${encodeURIComponent(terms[0])}`);
  fragments.push("phrase=true");
  viewer.hash = fragments.join("&");
  return viewer.href;
}

async function loadOptionalLocalLinks() {
  try {
    const links = await readJson("local-links.json");
    if (!Array.isArray(links)) return;
    localLinksByDocumentId.clear();
    for (const link of links) {
      if (link.document_id && link.local_pdf_url) {
        localLinksByDocumentId.set(String(link.document_id), link);
      }
    }
  } catch (error) {
    localLinksByDocumentId.clear();
  }
}

async function readMapEvidenceJson(path) {
  const resolvedUrl = mapEvidenceDataUrl(path);
  if ("DecompressionStream" in window) {
    const compressedUrl = `${resolvedUrl}.gz`;
    const compressedResponse = await fetchMapEvidenceResponse(compressedUrl);
    if (compressedResponse.ok) {
      const decompressed = compressedResponse.body.pipeThrough(new DecompressionStream("gzip"));
      document.documentElement.dataset.mapEvidenceEncoding = "gzip";
      return JSON.parse(await new Response(decompressed).text());
    }
    if (compressedResponse.status !== 404) {
      throw new Error(`${compressedUrl} returned HTTP ${compressedResponse.status}`);
    }
  }
  const response = await fetchMapEvidenceResponse(resolvedUrl);
  if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
  document.documentElement.dataset.mapEvidenceEncoding = "json-fallback";
  return response.json();
}

function validateCaseDiscoveryPayload(payload) {
  if (payload?.schema_version !== 1 || payload?.package_kind !== "case-discovery") {
    throw new Error("The mapped case index has an unsupported schema.");
  }
  if (!Array.isArray(payload.fields) || payload.fields.join("|") !== CASE_DISCOVERY_FIELDS.join("|")) {
    throw new Error("The mapped case index fields do not match this search interface.");
  }
  if (!Array.isArray(payload.records) || payload.records.some(row => !Array.isArray(row) || row.length !== CASE_DISCOVERY_FIELDS.length)) {
    throw new Error("The mapped case index contains malformed records.");
  }
  return payload.records;
}

function caseSearchWorkerCall(type, payload, transfer = []) {
  if (!caseSearchWorker) return Promise.reject(new Error("The case-search worker is not available."));
  const id = caseSearchWorkerRequestId + 1;
  caseSearchWorkerRequestId = id;
  return new Promise((resolve, reject) => {
    caseSearchWorkerRequests.set(id, {resolve, reject});
    caseSearchWorker.postMessage({id, type, payload}, transfer);
  });
}

function rejectCaseSearchWorkerRequests(error) {
  for (const request of caseSearchWorkerRequests.values()) request.reject(error);
  caseSearchWorkerRequests.clear();
}

async function initializeCaseSearchEngine() {
  if (caseSearchEngine !== "uninitialized") return caseSearchEngine;
  if (caseSearchWorkerReadyPromise) return caseSearchWorkerReadyPromise;
  caseSearchWorkerReadyPromise = (async () => {
    if ("Worker" in window && "DecompressionStream" in window) {
      try {
        await initializeMapEvidenceDataRelease();
        const compressedUrl = `${mapEvidenceDataUrl(CASE_DISCOVERY_BUNDLE_PATH)}.gz`;
        const response = await fetchMapEvidenceResponse(compressedUrl);
        if (!response.ok) throw new Error(`${compressedUrl} returned HTTP ${response.status}`);
        const compressedBuffer = await response.arrayBuffer();
        caseSearchWorker = new Worker(new URL(CASE_SEARCH_WORKER_PATH, SEARCH_ASSET_BASE_URL));
        caseSearchWorker.addEventListener("message", event => {
          const request = caseSearchWorkerRequests.get(event.data?.id);
          if (!request) return;
          caseSearchWorkerRequests.delete(event.data.id);
          if (event.data.ok) request.resolve(event.data.result);
          else request.reject(new Error(event.data.error || "The case-search worker failed."));
        });
        caseSearchWorker.addEventListener("error", event => {
          rejectCaseSearchWorkerRequests(new Error(event.message || "The case-search worker stopped unexpectedly."));
        });
        const summary = await caseSearchWorkerCall(
          "init",
          {compressedBuffer},
          [compressedBuffer]
        );
        caseDiscoveryRecordCount = Number(summary.recordCount || 0);
        caseDiscoveryCollectionCount = Number(summary.collectionCount || 0);
        caseSearchEngine = "worker";
        document.documentElement.dataset.caseDiscoveryLoadMode = "worker-gzip";
        document.documentElement.dataset.caseSearchEngine = "worker";
        document.documentElement.dataset.caseDiscoveryRecords = String(caseDiscoveryRecordCount);
        return caseSearchEngine;
      } catch (error) {
        caseSearchWorker?.terminate();
        caseSearchWorker = null;
        rejectCaseSearchWorkerRequests(error);
        console.warn("Worker-backed case search unavailable; using the compatible main-thread path.", error);
      }
    }
    await loadCaseDiscoveryRecords();
    caseSearchEngine = "main-thread";
    document.documentElement.dataset.caseSearchEngine = "main-thread";
    return caseSearchEngine;
  })().catch(error => {
    caseSearchWorkerReadyPromise = null;
    caseSearchEngine = "uninitialized";
    throw error;
  });
  return caseSearchWorkerReadyPromise;
}

async function loadCaseDiscoveryRecords() {
  if (caseDiscoveryRecords.length) return caseDiscoveryRecords;
  if (caseDiscoveryLoadPromise) return caseDiscoveryLoadPromise;
  caseDiscoveryLoadPromise = (async () => {
    if (!("DecompressionStream" in window)) {
      throw new Error("Mapped case search needs a browser with gzip stream support.");
    }
    await initializeMapEvidenceDataRelease();
    const payload = await readMapEvidenceJson(CASE_DISCOVERY_BUNDLE_PATH);
    caseDiscoveryRecords = validateCaseDiscoveryPayload(payload);
    caseDiscoveryRecordCount = caseDiscoveryRecords.length;
    caseDiscoveryCollectionCount = Object.keys(payload?.counts?.collections || {}).length;
    document.documentElement.dataset.caseDiscoveryLoadMode = "compact-gzip";
    document.documentElement.dataset.caseDiscoveryRecords = String(caseDiscoveryRecordCount);
    return caseDiscoveryRecords;
  })().catch(error => {
    caseDiscoveryLoadPromise = null;
    document.documentElement.dataset.caseDiscoveryLoadMode = "unavailable";
    throw error;
  });
  return caseDiscoveryLoadPromise;
}

function recordsFromPayload(payload) {
  return Array.isArray(payload) ? payload : payload?.records || [];
}

async function loadOptionalMapSources() {
  await initializeMapEvidenceDataRelease();
  mapSourcesByDocumentId.clear();
  mapSourcesByRecordId.clear();
  geipanSourceRecords = [];
  lacUfoSourceRecords = [];

  let records = [];
  try {
    const payload = await readMapEvidenceJson(MAP_EVIDENCE_BUNDLE_PATH);
    if (payload?.schema_version !== 1 || payload?.package_kind !== "search-map-evidence") {
      throw new Error("Map evidence bundle has an unsupported schema.");
    }
    records = Array.isArray(payload.records) ? payload.records : [];
    geipanSourceRecords = Array.isArray(payload.geipan_records) ? payload.geipan_records : [];
    lacUfoSourceRecords = Array.isArray(payload.lac_ufo_records) ? payload.lac_ufo_records : [];
    document.documentElement.dataset.mapEvidenceLoadMode = "compact-bundle";
  } catch (bundleError) {
    const [ufocatPayload, sourceFirstPayload, geipanPayload, lacUfoPayload] = await Promise.all([
      readMapEvidenceJson("data/ufocat_sources_public.json"),
      readMapEvidenceJson("data/source_first_sources_public.json"),
      readMapEvidenceJson("data/geipan_sources_public.json"),
      readMapEvidenceJson("data/lac_ufo_sources_public.json"),
    ]);
    records = [...recordsFromPayload(ufocatPayload), ...recordsFromPayload(sourceFirstPayload)];
    geipanSourceRecords = recordsFromPayload(geipanPayload);
    lacUfoSourceRecords = recordsFromPayload(lacUfoPayload);
    document.documentElement.dataset.mapEvidenceLoadMode = "legacy-sidecars";
  }

  for (const source of [...records, ...geipanSourceRecords, ...lacUfoSourceRecords]) {
    const recordId = String(source.ufocat_prn || source.record_id || source.geipan_case_id || "").trim();
    if (!recordId) continue;
    if (!mapSourcesByRecordId.has(recordId)) mapSourcesByRecordId.set(recordId, []);
    mapSourcesByRecordId.get(recordId).push(source);
  }
  for (const source of records) {
    const documentId = String(source.afu_document_id || source.online_source_document_id || "");
    const recordId = String(source.ufocat_prn || source.record_id || "");
    if (!documentId || !recordId) continue;
    if (!mapSourcesByDocumentId.has(documentId)) mapSourcesByDocumentId.set(documentId, []);
    mapSourcesByDocumentId.get(documentId).push(source);
  }
  return {
    sourceRecords: records.length,
    geipanRecords: geipanSourceRecords.length,
    lacUfoRecords: lacUfoSourceRecords.length,
    caseRecords: mapSourcesByRecordId.size,
  };
}

function normalizedPublicUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return `${url.origin}${decodeURIComponent(url.pathname)}`.toLocaleLowerCase();
  } catch (error) {
    return String(value || "").toLocaleLowerCase();
  }
}

function attachGeipanSourcesToIssues(issueRows) {
  if (!geipanSourceRecords.length) return;
  const issueByUrl = new Map(
    issueRows
      .filter(issue => issue.collection_id === "documents/france-geipan" && issue.pdf_url)
      .map(issue => [normalizedPublicUrl(issue.pdf_url), issue])
  );
  for (const source of geipanSourceRecords) {
    const issue = issueByUrl.get(normalizedPublicUrl(source.source_url || source.online_source_url || ""));
    if (!issue) continue;
    const documentId = String(issue.document_id || "");
    if (!documentId) continue;
    const record = {
      ...source,
      ufocat_prn: source.ufocat_prn || source.record_id || source.geipan_case_id || "",
      afu_document_id: documentId,
      online_source_document_id: documentId,
      evidence_url: source.source_url || source.online_source_url || "",
      online_source_url: source.source_url || source.online_source_url || "",
      search_anchor_term: source.classification ? `classification ${source.classification}` : "GEIPAN",
    };
    if (!mapSourcesByDocumentId.has(documentId)) mapSourcesByDocumentId.set(documentId, []);
    mapSourcesByDocumentId.get(documentId).push(record);
  }
}

function attachLacUfoSourcesToIssues(issueRows) {
  if (!lacUfoSourceRecords.length) return;
  const issueByUrl = new Map(
    issueRows
      .filter(issue => issue.collection_id === "documents/canada-lac-ufo" && issue.pdf_url)
      .map(issue => [normalizedPublicUrl(issue.pdf_url), issue])
  );
  for (const source of lacUfoSourceRecords) {
    const issue = issueByUrl.get(normalizedPublicUrl(source.pdf_url || ""));
    if (!issue) continue;
    const documentId = String(issue.document_id || "");
    const recordId = String(source.record_id || "").trim();
    if (!documentId || !recordId) continue;
    const record = {
      ...source,
      ufocat_prn: recordId,
      afu_document_id: documentId,
      online_source_document_id: documentId,
      evidence_url: source.pdf_url || source.source_url || source.official_source_url || "",
      online_source_url: source.pdf_url || source.source_url || source.official_source_url || "",
      search_anchor_term: issue.title || source.item_record_number || "Canada UFO",
    };
    if (!mapSourcesByDocumentId.has(documentId)) mapSourcesByDocumentId.set(documentId, []);
    mapSourcesByDocumentId.get(documentId).push(record);
  }
}

function refreshMapEvidencePresentation() {
  renderFeaturedCollections();
  renderCoverageDashboard();
  renderSourceRichBrowser();
  renderBrowsePreview();
  if (currentResultMode === "cases") {
    renderResults();
    return;
  }
  if (!facetUniverse.length) return;
  facetUniverse = facetUniverse.map(result => ({...result, score: resultScore(result)}));
  renderResultFacetOptions();
  currentResults = facetUniverse.filter(result => issueMatchesResultFacets(result.issue));
  sortCurrentResults();
  renderResults();
  renderResultFacetStatus();
  currentResultNote = resultCountNote();
  updateStatus(`${currentResultNote}${warningSummary()}`);
}

function startMapEvidenceEnrichment() {
  if (mapEvidenceLoadPromise) return mapEvidenceLoadPromise;
  mapEvidenceLoadState = "loading";
  document.documentElement.dataset.mapEvidenceEnrichment = "loading";
  mapEvidenceLoadPromise = loadOptionalMapSources()
    .then(counts => {
      attachGeipanSourcesToIssues(issues);
      attachLacUfoSourcesToIssues(issues);
      mapEvidenceLoadState = "ready";
      document.documentElement.dataset.mapEvidenceEnrichment = "ready";
      document.documentElement.dataset.mapEvidenceSourceRecords = String(
        counts.sourceRecords + counts.geipanRecords + counts.lacUfoRecords
      );
      document.documentElement.dataset.mapEvidenceCaseRecords = String(counts.caseRecords);
      refreshMapEvidencePresentation();
      return counts;
    })
    .catch(error => {
      mapSourcesByDocumentId.clear();
      mapSourcesByRecordId.clear();
      geipanSourceRecords = [];
      lacUfoSourceRecords = [];
      mapEvidenceLoadState = "unavailable";
      document.documentElement.dataset.mapEvidenceEnrichment = "unavailable";
      console.warn("Map evidence enrichment was unavailable.", error);
      return null;
    });
  return mapEvidenceLoadPromise;
}

async function loadOptionalCollectionLandingSummary() {
  collectionLandingSummary = null;
  try {
    const payload = await readJson("data/collection_landing_summary.json");
    if (Array.isArray(payload?.collections)) collectionLandingSummary = payload;
  } catch (error) {
    collectionLandingSummary = null;
  }
}

async function loadOptionalCaseDossiers() {
  caseDossierByRecordId.clear();
  try {
    const payload = await readJson("cases/index.json");
    const rows = Array.isArray(payload?.dossiers) ? payload.dossiers : [];
    for (const row of rows) {
      const recordId = String(row.record_id || "").trim();
      if (recordId) caseDossierByRecordId.set(recordId, row);
    }
  } catch (error) {
    caseDossierByRecordId.clear();
  }
}

async function loadPageIntelligence(collectionRows) {
  pageIntelligenceByIssue.clear();
  await Promise.all(collectionRows.map(async collection => {
    if (!collection.page_intelligence || !collection.path) return;
    try {
      const payload = await readGzipJson(`${collection.path}/${collection.page_intelligence}`);
      if (!Array.isArray(payload?.issues)) return;
      for (const row of payload.issues) {
        const issueId = Number(row.issue_id);
        if (!Number.isFinite(issueId)) continue;
        pageIntelligenceByIssue.set(`${collection.id}:${issueId}`, {
          max_sighting_score: Number(row.max_sighting_score || 0),
          flags: Array.isArray(row.flags) ? row.flags : [],
          likely_pages: Array.isArray(row.likely_pages) ? row.likely_pages : [],
        });
      }
    } catch (error) {
      console.warn(`Page intelligence unavailable for ${collection.id}`, error);
    }
  }));
}

function applyLocalLinksToIssues(issueRows) {
  for (const issue of issueRows) {
    const link = localLinksByDocumentId.get(String(issue.document_id));
    if (!link) {
      issue.access_mode = issue.pdf_url ? "online" : "unavailable";
      continue;
    }
    issue.local_pdf_url = link.local_pdf_url;
    issue.local_relative_path = link.local_relative_path;
    issue.access_mode = "local";
  }
}

function issueMetadataScore(issue, terms, phrase) {
  const title = `${issue.title || ""}`.toLocaleLowerCase();
  const series = `${issue.series || ""}`.toLocaleLowerCase();
  const metadata = `${issue.embedded_title || ""} ${issue.embedded_author || ""}`.toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    score += countOccurrences(title, term) * 140;
    score += countOccurrences(series, term) * 45;
    score += countOccurrences(metadata, term) * 25;
  }
  if (phrase.length > 2 && title.includes(phrase)) score += 350;
  if (terms.every(term => title.includes(term))) score += 175;
  return score;
}

function metadataMatches(issue, criteria) {
  const haystack = `${issue.series} ${issue.title} ${issue.embedded_title} ${issue.embedded_author}`.toLocaleLowerCase();
  return textMatchesCriteria(haystack, criteria);
}

function ensureCandidate(candidates, issue) {
  if (!candidates.has(issue.document_id)) {
    candidates.set(issue.document_id, {
      issue,
      score: 0,
      metadataScore: 0,
      textHitPages: 0,
      storedPages: [],
      bestPage: null,
      excerpt: "",
      excerpts: [],
      sources: new Set(),
      pinned: false,
    });
  }
  return candidates.get(issue.document_id);
}

function addTextHit(candidate, series, pageIndex, pageNumber, issueId = null) {
  candidate.sources.add("content");
  candidate.textHitPages += 1;
  if (candidate.storedPages.length < maxStoredPagesPerResult) {
    candidate.storedPages.push({series, pageIndex, page: pageNumber, issueId});
  }
  if (!candidate.bestPage || pageNumber < candidate.bestPage) {
    candidate.bestPage = pageNumber;
  }
}

function matchingPageSummary(result) {
  if (!result.textHitPages) return "";
  const pages = [...new Set(result.storedPages.map(page => page.page))]
    .sort((a, b) => a - b)
    .slice(0, 8);
  const more = result.textHitPages > pages.length ? ` and ${result.textHitPages - pages.length} more` : "";
  const links = pages.map(page => {
    const url = pdfOpenUrl(result.issue, page, currentTerms);
    if (!url) return escapeHtml(String(page));
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(page)}</a>`;
  }).join(", ");
  return `${result.textHitPages} matching page${result.textHitPages === 1 ? "" : "s"}: ${links}${escapeHtml(more)}`;
}

function pageClusterMarkup(result) {
  if (!result.textHitPages || result.storedPages.length < 2) return "";
  const pages = [...new Set(result.storedPages.map(page => Number(page.page)).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const clusters = [];
  let start = pages[0];
  let previous = pages[0];
  for (const page of pages.slice(1)) {
    if (page <= previous + 2) {
      previous = page;
      continue;
    }
    clusters.push([start, previous]);
    start = page;
    previous = page;
  }
  clusters.push([start, previous]);
  const clusterText = clusters
    .slice(0, 5)
    .map(([first, last]) => first === last ? `p. ${first}` : `pp. ${first}-${last}`)
    .join(" / ");
  const more = result.textHitPages > pages.length ? ` / ${result.textHitPages - pages.length} more hit${result.textHitPages - pages.length === 1 ? "" : "s"}` : "";
  return `<p class="page-clusters"><span>Page clusters</span><strong>${escapeHtml(clusterText)}${escapeHtml(more)}</strong></p>`;
}

function resultScore(result) {
  if (result.pinned) return Number.MAX_SAFE_INTEGER;
  const contentScore = Math.min(result.textHitPages * 8, 650);
  const mapEvidence = mappedEvidenceSummary(result.issue);
  const evidenceScore = mapEvidence
    ? Math.min(mapEvidence.sourceCount * 3 + mapEvidence.mappedPages * 8 + mapEvidence.prnCount * 2, 420)
    : 0;
  const intelligence = intelligenceForIssue(result.issue);
  const intelligenceScore = intelligence ? Math.min(Number(intelligence.max_sighting_score || 0) * 3, 180) : 0;
  return result.metadataScore + contentScore + evidenceScore + intelligenceScore + intentScore(result, mapEvidence);
}

function sortCurrentResults() {
  const mode = resultSortInput?.value || "relevance";
  if (currentResultMode === "cases") {
    currentResults.sort((left, right) => {
      const leftYear = Number(caseField(left, "year") || 0);
      const rightYear = Number(caseField(right, "year") || 0);
      const titleOrder = caseField(left, "title").localeCompare(caseField(right, "title"));
      if (mode === "source-richness") {
        return Number(caseField(right, "source_count") || 0) - Number(caseField(left, "source_count") || 0)
          || right.score - left.score
          || titleOrder;
      }
      if (mode === "date-newest") return rightYear - leftYear || right.score - left.score || titleOrder;
      if (mode === "date-oldest") return leftYear - rightYear || right.score - left.score || titleOrder;
      if (mode === "title") return titleOrder || right.score - left.score;
      return right.score - left.score || titleOrder;
    });
    return;
  }
  currentResults.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (mode === "source-richness") {
      const leftEvidence = mappedEvidenceSummary(left.issue);
      const rightEvidence = mappedEvidenceSummary(right.issue);
      const leftScore = (leftEvidence?.sourceCount || 0) * 1000 + (leftEvidence?.prnCount || 0);
      const rightScore = (rightEvidence?.sourceCount || 0) * 1000 + (rightEvidence?.prnCount || 0);
      return rightScore - leftScore || right.score - left.score || left.issue.title.localeCompare(right.issue.title);
    }
    if (mode === "date-newest" || mode === "date-oldest") {
      const leftYear = Number(issueYear(left.issue) || 0);
      const rightYear = Number(issueYear(right.issue) || 0);
      const direction = mode === "date-newest" ? rightYear - leftYear : leftYear - rightYear;
      return direction || right.score - left.score || left.issue.title.localeCompare(right.issue.title);
    }
    if (mode === "title") return left.issue.title.localeCompare(right.issue.title) || right.score - left.score;
    return right.score - left.score || left.issue.title.localeCompare(right.issue.title);
  });
}

function intentScore(result, mapEvidence = mappedEvidenceSummary(result.issue)) {
  const intent = selectedSearchIntent();
  if (intent === "general") return 0;
  const text = metadataTextForIssue(result.issue);
  const issueSeries = String(result.issue.series || "");
  const mappedBoost = mapEvidence ? Math.min(500, 80 + mapEvidence.prnCount * 12 + mapEvidence.sourceCount * 4) : 0;
  const intelligence = intelligenceForIssue(result.issue);
  const flags = new Set(intelligence?.flags || []);
  const likelyBoost = flags.has("likely_sighting") ? Math.min(260, 90 + Number(intelligence.max_sighting_score || 0) * 4) : 0;
  if (intent === "mapped") return mappedBoost || -120;
  if (intent === "cases") {
    const caseWords = /\b(sighting|observed|observation|witness|case|landing|radar|trace|humanoid|encounter|report)\b/i;
    return (caseWords.test(text) ? 90 : 0) + Math.min(result.textHitPages * 4, 120) + Math.min(mappedBoost, 220) + likelyBoost;
  }
  if (intent === "people") {
    const peopleWords = /\b(interview|witness|investigator|letter|correspondence|biography|committee|director)\b/i;
    return peopleWords.test(text) ? 90 : 0;
  }
  if (intent === "places") {
    const placeWords = /\b(city|county|state|province|country|base|airport|river|mountain|valley|lake)\b/i;
    return (placeWords.test(text) ? 70 : 0) + Math.min(mappedBoost, 180);
  }
  if (intent === "organizations") {
    const orgWords = /\b(mufon|nicap|apro|cufos|geipan|committee|society|association|center|centre|bureau|project)\b/i;
    return orgWords.test(`${text} ${issueSeries}`) ? 100 : 0;
  }
  return 0;
}

function booleanParam(value, fallback) {
  if (value === null) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLocaleLowerCase());
}

function deepLinkOptions() {
  const params = new URLSearchParams(window.location.search);
  const series = params.getAll("series")
    .flatMap(value => value.split(","))
    .map(value => value.trim())
    .filter(Boolean);
  const page = Number.parseInt(params.get("page") || "", 10);
  return {
    query: params.get("q") || "",
    mode: params.get("mode") || "basic",
    all: params.get("all") || "",
    phrase: params.get("phrase") || "",
    any: params.get("any") || "",
    none: params.get("none") || "",
    yearMin: params.get("year_min") || "",
    yearMax: params.get("year_max") || "",
    series,
    collections: params.getAll("collection")
      .flatMap(value => value.split(","))
      .map(value => value.trim())
      .filter(Boolean),
    access: params.getAll("access")
      .flatMap(value => value.split(","))
      .map(value => value.trim())
      .filter(Boolean),
    intelligence: params.getAll("signal")
      .flatMap(value => value.split(","))
      .map(value => value.trim())
      .filter(Boolean),
    facetDecade: params.get("facet_decade") || "",
    facetEvidence: params.get("facet_evidence") || "",
    facetSource: params.get("facet_source") || "",
    facetPageLink: params.get("facet_page") || "",
    caseCollection: params.get("case_collection") || "",
    caseCountry: params.get("case_country") || "",
    caseEvidence: booleanParam(params.get("case_evidence"), false),
    language: params.get("language") || "main",
    intent: params.get("intent") || "general",
    sort: params.get("sort") || "relevance",
    mapRecords: params.getAll("map_record")
      .flatMap(value => value.split(","))
      .map(value => value.trim())
      .filter(Boolean),
    issue: params.get("issue") || "",
    page: Number.isInteger(page) && page > 0 ? page : null,
    fulltext: booleanParam(params.get("fulltext"), true),
    autorun: booleanParam(params.get("autorun"), false),
  };
}

function applyDeepLinkOptions(options) {
  requestedMapRecordIds = new Set(options.mapRecords || []);
  if (options.mode === "advanced" || options.all || options.phrase || options.any || options.none) {
    document.querySelector('input[name="search-mode"][value="advanced"]').checked = true;
    document.getElementById("basic-search").hidden = true;
    document.getElementById("advanced-search").hidden = false;
    allWordsInput.value = options.all || options.query;
    exactPhraseInput.value = options.phrase;
    anyWordsInput.value = options.any;
    noneWordsInput.value = options.none;
  } else {
    queryInput.value = options.query;
  }
  if (yearMinInput) yearMinInput.value = options.yearMin;
  if (yearMaxInput) yearMaxInput.value = options.yearMax;
  fullTextInput.checked = options.fulltext;
  if (options.collections.length) {
    const selectedCollections = new Set(options.collections);
    document.querySelectorAll(".collection-checkbox").forEach(input => {
      input.checked = selectedCollections.has(input.value);
    });
  }
  if (options.access.length) {
    const selectedAccess = new Set(options.access);
    document.querySelectorAll(".access-filter").forEach(input => {
      input.checked = selectedAccess.has(input.value);
    });
  }
  if (options.intelligence.length) {
    const selectedSignals = new Set(options.intelligence);
    document.querySelectorAll(".intelligence-filter").forEach(input => {
      input.checked = selectedSignals.has(input.value);
    });
  }
  pendingResultFacets = {
    decade: options.facetDecade || "",
    evidence: options.facetEvidence || "",
    source: options.facetSource || "",
    pageLink: options.facetPageLink || "",
  };
  if (facetEvidenceInput) facetEvidenceInput.value = pendingResultFacets.evidence;
  if (facetPageLinkInput) facetPageLinkInput.value = pendingResultFacets.pageLink;
  pendingCaseFilters = {
    collection: options.caseCollection || "",
    country: options.caseCountry || "",
    evidence: Boolean(options.caseEvidence),
  };
  if (caseEvidenceFilter) caseEvidenceFilter.checked = pendingCaseFilters.evidence;
  if (languageFilterInput && options.language) languageFilterInput.value = options.language;
  if (searchIntentInput && options.intent) searchIntentInput.value = options.intent;
  updateResultModePresentation();
  if (resultSortInput && [...resultSortInput.options].some(option => option.value === options.sort)) resultSortInput.value = options.sort;
  const knownSeries = new Set(allSeries.flatMap(series => [series.id, series.selection_id]));
  const selected = new Set(options.series);
  document.querySelectorAll(".series-checkbox").forEach(input => {
    input.checked = selected.has(input.value) || selected.has(input.dataset.seriesId);
  });
  const unknownSeries = options.series.filter(series => !knownSeries.has(series));
  if (unknownSeries.length) deepLinkWarnings.push(`Unknown series: ${unknownSeries.join(", ")}.`);
  requestedIssue = options.issue
    ? issues.find(issue => issue.document_id === options.issue || String(issue.id) === options.issue) || null
    : null;
  requestedPage = options.page;
  if (options.issue && !requestedIssue) deepLinkWarnings.push(`Unknown issue: ${options.issue}.`);
}

function buildShareUrl({autorun = true, issue = null, page = null, query = null, collection = null, series = [], fulltext = null} = {}) {
  const params = new URLSearchParams();
  const mode = activeSearchMode();
  if (query) {
    params.set("q", query);
  } else if (mode === "advanced") {
    params.set("mode", "advanced");
    if (allWordsInput.value.trim()) params.set("all", allWordsInput.value.trim());
    if (exactPhraseInput.value.trim()) params.set("phrase", exactPhraseInput.value.trim());
    if (anyWordsInput.value.trim()) params.set("any", anyWordsInput.value.trim());
    if (noneWordsInput.value.trim()) params.set("none", noneWordsInput.value.trim());
  } else if (queryInput.value.trim()) {
    params.set("q", queryInput.value.trim());
  }
  if (yearMinInput?.value.trim()) params.set("year_min", yearMinInput.value.trim());
  if (yearMaxInput?.value.trim()) params.set("year_max", yearMaxInput.value.trim());
  const intent = selectedSearchIntent();
  const caseMode = intent === "cases";
  if (intent !== "general") params.set("intent", intent);
  const sortMode = resultSortInput?.value || "relevance";
  if (sortMode !== "relevance") params.set("sort", sortMode);
  if (caseMode) {
    if (caseCollectionFilter?.value) params.set("case_collection", caseCollectionFilter.value);
    if (caseCountryFilter?.value) params.set("case_country", caseCountryFilter.value);
    if (caseEvidenceFilter?.checked) params.set("case_evidence", "1");
  } else {
    const includeFullText = fulltext === null ? fullTextInput.checked : Boolean(fulltext);
    if (!includeFullText) params.set("fulltext", "0");
    const languageMode = selectedLanguageMode();
    if (languageMode !== "main") params.set("language", languageMode);
    const accessModes = selectedAccessModes();
    if (!accessModes.size) {
      params.set("access", "none");
    } else if (accessModes.size < document.querySelectorAll(".access-filter").length) {
      accessModes.forEach(mode => params.append("access", mode));
    }
    selectedIntelligenceFilters().forEach(signal => params.append("signal", signal));
    const resultFacets = activeResultFacets();
    if (resultFacets.decade) params.set("facet_decade", resultFacets.decade);
    if (resultFacets.evidence) params.set("facet_evidence", resultFacets.evidence);
    if (resultFacets.source) params.set("facet_source", resultFacets.source);
    if (resultFacets.pageLink) params.set("facet_page", resultFacets.pageLink);
    if (requestedMapRecordIds.size) params.set("map_record", [...requestedMapRecordIds].slice(0, 80).join(","));
    const selectedCollectionIds = collection
      ? [collection]
      : [...document.querySelectorAll(".collection-checkbox:checked")].map(input => input.value);
    if (selectedCollectionIds.length && selectedCollectionIds.length < collections.length) {
      selectedCollectionIds.forEach(collection => params.append("collection", collection));
    }
    const selectedSeriesIds = series.length ? series : [...selectedSeries()];
    selectedSeriesIds.forEach(series => params.append("series", series));
    if (issue) {
      params.set("issue", issue);
    } else if (requestedIssue) {
      params.set("issue", requestedIssue.document_id || requestedIssue.id);
    }
  }
  if (page || requestedPage) params.set("page", String(page || requestedPage));
  if (autorun && (
    query
    || hasPositiveCriteria(searchCriteria())
    || (caseMode && (yearMinInput?.value.trim() || yearMaxInput?.value.trim()))
    || issue
    || requestedIssue
    || requestedMapRecordIds.size
  )) params.set("autorun", "1");
  const url = new URL(window.location.href);
  url.search = params.toString();
  url.hash = "";
  return url.href;
}

function updateShareUrl() {
  window.history.replaceState({}, "", buildShareUrl({autorun: true}));
}

function updateScopeStatus() {
  if (!scopeStatusElement) return;
  if (selectedSearchIntent() === "cases") {
    scopeStatusElement.textContent = caseDiscoveryRecordCount
      ? `${caseDiscoveryRecordCount.toLocaleString()} public mapped cases loaded from ${caseDiscoveryCollectionCount.toLocaleString()} active collections. The case index and map data come from the active MapView release.`
      : "Mapped case mode uses a compact cross-origin index that loads on the first case search; the interactive map stays unloaded until opened.";
    return;
  }
  const selected = selectedSeries();
  const selectedCountryIds = selectedCollections();
  const activeSeries = allSeries.filter(series =>
    selectedCountryIds.has(series.collection_id)
    && (!selected.size || selected.has(series.selection_id))
  );
  const searchable = activeSeries.filter(series => series.indexed_text_pages > 0).length;
  const languageText = {
    main: "English + mixed/unknown",
    all: "all languages",
    other: "other detected languages",
  }[selectedLanguageMode()] || (languageFilterInput?.selectedOptions?.[0]?.textContent || selectedLanguageMode());
  const intentText = searchIntentInput?.selectedOptions?.[0]?.textContent || "General";
  const signalCount = selectedIntelligenceFilters().size;
  const signalText = signalCount ? ` Page signals: ${signalCount} active.` : "";
  const resultFacetCount = activeResultFacetCount();
  const resultFacetText = resultFacetCount ? ` Result refinements: ${resultFacetCount} active.` : "";
  scopeStatusElement.textContent = `${searchable.toLocaleString()} of ${activeSeries.length.toLocaleString()} active series have indexed full text. Mode: ${intentText}. Language scope: ${languageText}.${signalText}${resultFacetText}`;
}

function collectionKindCount() {
  return new Set(collections.map(collection => String(collection.id || "").split("/")[0]).filter(Boolean)).size;
}

function archiveStats() {
  const searchableSeries = allSeries.filter(series => Number(series.indexed_text_pages || 0) > 0);
  const searchableCollections = collections.filter(collection =>
    allSeries.some(series => series.collection_id === collection.id && Number(series.indexed_text_pages || 0) > 0)
  );
  const foreignLanguageIssues = issues.filter(isForeignLanguage).length;
  return {
    collections: collections.length,
    sections: collectionKindCount(),
    documents: issues.length,
    searchablePages: searchableSeries.reduce((total, series) => total + Number(series.indexed_text_pages || 0), 0),
    searchableCollections: searchableCollections.length,
    searchableSeries: searchableSeries.length,
    series: allSeries.length,
    foreignLanguageIssues,
  };
}

function renderArchiveStats() {
  if (!archiveStatsElement) return;
  const stats = archiveStats();
  archiveStatsElement.innerHTML = [
    {value: stats.collections, label: "PDF collections"},
    {value: stats.documents, label: "online PDFs"},
    {value: stats.searchablePages, label: "searchable pages"},
    {value: stats.foreignLanguageIssues, label: "foreign-language PDFs"},
    {value: stats.searchableSeries, label: `full-text series of ${stats.series.toLocaleString()}`},
  ].map(item => `
    <span>
      <strong>${Number(item.value).toLocaleString()}</strong>
      <small>${escapeHtml(item.label)}</small>
    </span>
  `).join("");
}

function collectionMetrics(collection) {
  const seriesRows = allSeries.filter(series => series.collection_id === collection.id);
  const searchablePages = seriesRows.reduce((total, series) => total + Number(series.indexed_text_pages || 0), 0);
  const searchableSeries = seriesRows.filter(series => Number(series.indexed_text_pages || 0) > 0).length;
  return {
    issueCount: Number(collection.issue_count || 0),
    searchablePages,
    searchableSeries,
    seriesCount: seriesRows.length,
  };
}

function renderFeaturedCollections() {
  if (!featuredCollectionsElement) return;
  const featured = collections
    .map(collection => ({collection, metrics: collectionMetrics(collection)}))
    .filter(row => row.metrics.issueCount || row.metrics.searchablePages)
    .sort((a, b) => b.metrics.searchablePages - a.metrics.searchablePages || b.metrics.issueCount - a.metrics.issueCount)
    .slice(0, 6);
  featuredCollectionsElement.innerHTML = featured.map(({collection, metrics}) => `
    <button type="button" class="featured-collection-card" data-featured-collection="${escapeHtml(collection.id)}">
      <strong>${escapeHtml(collection.title)}</strong>
      <span>${metrics.issueCount.toLocaleString()} PDFs</span>
      <span>${metrics.searchablePages.toLocaleString()} searchable pages</span>
    </button>
  `).join("");
}

function renderCoverageDashboard() {
  if (!coverageDashboardElement) return;
  const stats = archiveStats();
  const fullTextPct = stats.series ? Math.round((stats.searchableSeries / stats.series) * 100) : 0;
  const collectionPct = stats.collections ? Math.round((stats.searchableCollections / stats.collections) * 100) : 0;
  const metadataOnly = Math.max(0, stats.series - stats.searchableSeries);
  coverageDashboardElement.innerHTML = `
    <span><strong>${fullTextPct}%</strong><small>series with full text</small></span>
    <span><strong>${collectionPct}%</strong><small>collections searchable</small></span>
    <span><strong>${metadataOnly.toLocaleString()}</strong><small>metadata-only series left</small></span>
  `;
}

function modifiedMillis(issue) {
  const value = Date.parse(issue.modified_utc || "");
  return Number.isFinite(value) ? value : 0;
}

function indexedMillis(collection) {
  const indexed = Date.parse(collection.indexed_at_utc || "");
  if (Number.isFinite(indexed)) return indexed;
  const newestIssue = issues
    .filter(issue => issue.collection_id === collection.id)
    .reduce((newest, issue) => Math.max(newest, modifiedMillis(issue)), 0);
  return newestIssue;
}

function renderNewlySearchable() {
  if (!newlySearchableElement) return;
  const newest = collections
    .map(collection => ({collection, metrics: collectionMetrics(collection), indexedAt: indexedMillis(collection)}))
    .filter(row => row.metrics.issueCount)
    .sort((a, b) => b.indexedAt - a.indexedAt || b.metrics.issueCount - a.metrics.issueCount)
    .slice(0, 5);
  if (!newest.length) {
    newlySearchableElement.innerHTML = "";
    return;
  }
  newlySearchableElement.innerHTML = `
    <p class="eyebrow">Recently indexed</p>
    <div class="newly-searchable-list">
      ${newest.map(({collection, metrics}) => `
        <a href="${escapeHtml(buildShareUrl({collection: collection.id}))}">
          <strong>${escapeHtml(collection.title)}</strong>
          <span>${metrics.issueCount.toLocaleString()} PDFs / ${metrics.searchablePages.toLocaleString()} searchable pages</span>
        </a>
      `).join("")}
    </div>
  `;
}

function renderCollectionSpotlight() {
  if (!collectionSpotlightElement || !collectionLandingSummary?.collections?.length) {
    if (collectionSpotlightElement) collectionSpotlightElement.innerHTML = "";
    return;
  }
  const rows = collectionLandingSummary.collections.slice(0, 6);
  collectionSpotlightElement.innerHTML = `
    <p class="eyebrow">Collection highlights</p>
    <div class="collection-spotlight-grid">
      ${rows.map(row => `
        <article class="collection-spotlight-card">
          <strong>${escapeHtml(row.title)}</strong>
          <span>${Number(row.issue_count || 0).toLocaleString()} PDFs / ${Number(row.searchable_page_count || 0).toLocaleString()} searchable pages</span>
          <span>${Number(row.mapped_prn_count || 0).toLocaleString()} mapped cases / ${Number(row.source_link_count || 0).toLocaleString()} source links</span>
          <span>${Number(row.thumbnail_count || 0).toLocaleString()} thumbnails</span>
          <div class="collection-spotlight-actions">
            <a href="${escapeHtml(row.search_url || buildShareUrl({collection: row.collection_id}))}">Search collection</a>
            <a href="${escapeHtml(mapUiUrl(row.map_url || "?evidence=1"))}">Open map trail</a>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function languageBadges(row) {
  const badges = [];
  if (isFrenchLanguage(row)) badges.push({label: "French language", className: "language-french"});
  else if (row?.language_label) badges.push({label: `${row.language_label} language`, className: "language-other"});
  if (isForeignLanguage(row)) badges.push({label: "Foreign-language source", className: "language-foreign"});
  return badges;
}

function renderSourceRichBrowser() {
  if (!sourceRichBrowserElement || !mapSourcesByDocumentId.size) {
    if (sourceRichBrowserElement) sourceRichBrowserElement.innerHTML = "";
    return;
  }
  const issueByDocumentId = new Map(issues.map(issue => [String(issue.document_id || ""), issue]));
  const rows = [...mapSourcesByDocumentId.entries()]
    .map(([documentId, sources]) => {
      const issue = issueByDocumentId.get(documentId);
      if (!issue) return null;
      const prns = new Set(sources.map(source => String(source.ufocat_prn || "")).filter(Boolean));
      const labels = [...new Set(sources.map(source => String(source.source_label || source.source_code || "")).filter(Boolean))];
      const mappedPages = sources.filter(source => source.validation_status === "mapped_page_valid" || source.online_source_page || source.search_hit_page).length;
      return {issue, sources, prnCount: prns.size, labels, mappedPages};
    })
    .filter(Boolean)
    .sort((a, b) => b.mappedPages - a.mappedPages || b.prnCount - a.prnCount || b.sources.length - a.sources.length || String(a.issue.title).localeCompare(String(b.issue.title)))
    .slice(0, 9);
  if (!rows.length) {
    sourceRichBrowserElement.innerHTML = "";
    return;
  }
  sourceRichBrowserElement.innerHTML = `
    <p class="eyebrow">Best documented mapped evidence</p>
    <div class="source-rich-list">
      ${rows.map(row => `
        <article>
          <strong>${escapeHtml(row.issue.title)}</strong>
          <span>${row.prnCount.toLocaleString()} mapped sighting${row.prnCount === 1 ? "" : "s"} / ${row.mappedPages.toLocaleString()} page-mapped link${row.mappedPages === 1 ? "" : "s"}</span>
          <span>${escapeHtml(row.labels.slice(0, 3).join(", ") || row.issue.collection_title || row.issue.collection_id || "Archive")}</span>
          <div class="source-rich-actions">
            <a href="${escapeHtml(buildShareUrl({autorun: true, issue: row.issue.document_id}))}">Open PDF result</a>
            <a href="${escapeHtml(relatedMapUrl({issue: row.issue}))}">Open mapped cases</a>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function collectionById(collectionId) {
  return collections.find(collection => collection.id === collectionId) || null;
}

function browsePreviewCollectionId() {
  const checked = [...document.querySelectorAll(".collection-checkbox:checked")].map(input => input.value);
  return checked.length === 1 ? checked[0] : collections[0]?.id || "";
}

function renderBrowsePreview() {
  if (!browsePreviewElement || !collections.length) return;
  const collectionId = browsePreviewCollectionId();
  const collection = collectionById(collectionId);
  if (!collection) {
    browsePreviewElement.innerHTML = "";
    return;
  }
  const collectionIssues = issues.filter(issue => issue.collection_id === collectionId);
  const seriesRows = allSeries.filter(series => series.collection_id === collectionId)
    .sort((a, b) => Number(b.indexed_text_pages || 0) - Number(a.indexed_text_pages || 0) || String(a.title).localeCompare(String(b.title)))
    .slice(0, 6);
  const newestIssues = collectionIssues
    .slice()
    .sort((a, b) => modifiedMillis(b) - modifiedMillis(a) || String(a.title).localeCompare(String(b.title)))
    .slice(0, 8);
  browsePreviewElement.innerHTML = `
    <div class="browse-heading">
      <p class="eyebrow">Browse collection</p>
      <h3>${escapeHtml(collection.title)}</h3>
      ${collection.public_note ? `<p class="collection-public-note">${escapeHtml(collection.public_note)}</p>` : ""}
    </div>
    <div class="browse-series-list">
      ${seriesRows.map(series => `
        <button type="button" data-browse-series="${escapeHtml(series.selection_id)}">
          <strong>${escapeHtml(series.title)}</strong>
          <span>${Number(series.issue_count || 0).toLocaleString()} PDFs / ${Number(series.indexed_text_pages || 0).toLocaleString()} searchable pages</span>
        </button>
      `).join("")}
    </div>
    <div class="browse-issues-list">
      ${newestIssues.map(issue => `
        <a href="${escapeHtml(buildShareUrl({autorun: true, issue: issue.document_id}))}">
          <strong>${escapeHtml(issue.title)}</strong>
          <span>${escapeHtml(issue.series || "Series")}</span>
        </a>
      `).join("")}
    </div>
  `;
}

function nowMillis() {
  return window.performance?.now ? window.performance.now() : Date.now();
}

function elapsedSeconds(startedAt) {
  return ((nowMillis() - startedAt) / 1000).toFixed(2);
}

function fullTextConcurrencyLimit(searchAllIndexed) {
  const cores = Number(window.navigator?.hardwareConcurrency) || 4;
  const defaultLimit = searchAllIndexed ? 6 : 4;
  return Math.max(2, Math.min(searchAllIndexed ? 8 : 6, Math.floor(cores / 2) || defaultLimit));
}

function criteriaCanUseTermManifest(criteria) {
  return Boolean(criteria.all.length || criteria.phraseTerms.length || criteria.any.length);
}

function isManifestRulePrunedTerm(term) {
  return /\d/.test(term) || term.length > 15 || /(.)\1{3,}/.test(term);
}

function manifestFilterableTerms(terms, frequencyPrunedTerms) {
  return terms.filter(term => !frequencyPrunedTerms.has(term) && !isManifestRulePrunedTerm(term));
}

function termManifestMatchesSeries(seriesTerms, criteria, frequencyPrunedTerms) {
  if (!seriesTerms) return true;
  const allTerms = manifestFilterableTerms(criteria.all, frequencyPrunedTerms);
  const phraseTerms = manifestFilterableTerms(criteria.phraseTerms, frequencyPrunedTerms);
  const anyTerms = manifestFilterableTerms(criteria.any, frequencyPrunedTerms);
  if (allTerms.some(term => !seriesTerms.has(term))) return false;
  if (phraseTerms.some(term => !seriesTerms.has(term))) return false;
  if (criteria.any.length === anyTerms.length && anyTerms.length && !anyTerms.some(term => seriesTerms.has(term))) return false;
  return true;
}

function routeTermManifestShard(term, boundaries) {
  for (let index = 0; index < boundaries.length; index += 1) {
    if (term < boundaries[index]) return index;
  }
  return boundaries.length;
}

function termManifestShardPath(template, index) {
  return String(template || "").replace("{index}", String(index));
}

function normalizeGlobalTermRouter(router) {
  if (!router?.path || !router?.shard_template) return null;
  return {
    ...router,
    pruned: new Set(Array.isArray(router.pruned) ? router.pruned : []),
    termCollections: new Map(),
  };
}

async function loadGlobalTermRouterShard(router, shardIndex) {
  const shardPath = termManifestShardPath(router.shard_template, shardIndex);
  if (globalTermRouterShardCache.has(shardPath)) return globalTermRouterShardCache.get(shardPath);
  const shardPromise = readGzipJson(shardPath);
  globalTermRouterShardCache.set(shardPath, shardPromise);
  try {
    const shard = await shardPromise;
    globalTermRouterShardCache.set(shardPath, shard);
    return shard;
  } catch (error) {
    globalTermRouterShardCache.delete(shardPath);
    throw error;
  }
}

async function loadGlobalTermRouterTerms(criteria) {
  if (!globalTermRouter || !criteriaCanUseTermManifest(criteria)) return null;
  const terms = [
    ...manifestFilterableTerms(criteria.all, globalTermRouter.pruned),
    ...manifestFilterableTerms(criteria.phraseTerms, globalTermRouter.pruned),
    ...manifestFilterableTerms(criteria.any, globalTermRouter.pruned),
  ];
  const uniqueTerms = [...new Set(terms)];
  if (!uniqueTerms.length) return null;
  const shardIndexes = [...new Set(uniqueTerms.map(term => routeTermManifestShard(term, globalTermRouter.boundaries || [])))];
  await Promise.all(
    shardIndexes.map(async shardIndex => {
      const shard = await loadGlobalTermRouterShard(globalTermRouter, shardIndex);
      for (const term of uniqueTerms) {
        if (routeTermManifestShard(term, globalTermRouter.boundaries || []) !== shardIndex) continue;
        if (!globalTermRouter.termCollections.has(term)) {
          globalTermRouter.termCollections.set(term, new Set(Array.isArray(shard?.[term]) ? shard[term] : []));
        }
      }
    })
  );
  return {uniqueTerms, shardCount: shardIndexes.length};
}

function globalRouterMatchesCollection(collectionId, criteria) {
  if (!globalTermRouter) return true;
  const allTerms = manifestFilterableTerms(criteria.all, globalTermRouter.pruned);
  const phraseTerms = manifestFilterableTerms(criteria.phraseTerms, globalTermRouter.pruned);
  const anyTerms = manifestFilterableTerms(criteria.any, globalTermRouter.pruned);
  if (allTerms.some(term => !globalTermRouter.termCollections.get(term)?.has(collectionId))) return false;
  if (phraseTerms.some(term => !globalTermRouter.termCollections.get(term)?.has(collectionId))) return false;
  if (
    criteria.any.length === anyTerms.length
    && anyTerms.length
    && !anyTerms.some(term => globalTermRouter.termCollections.get(term)?.has(collectionId))
  ) {
    return false;
  }
  return true;
}

async function filterSeriesByGlobalRouter(selectable, criteria) {
  if (!globalTermRouter || !criteriaCanUseTermManifest(criteria)) {
    return {series: selectable, skippedSeriesCount: 0, routerShardRequestCount: 0, failed: false};
  }
  try {
    const loaded = await loadGlobalTermRouterTerms(criteria);
    if (!loaded) return {series: selectable, skippedSeriesCount: 0, routerShardRequestCount: 0, failed: false};
    const filtered = selectable.filter(series => globalRouterMatchesCollection(series.collection_id, criteria));
    return {
      series: filtered,
      skippedSeriesCount: selectable.length - filtered.length,
      routerShardRequestCount: loaded.shardCount,
      failed: false,
    };
  } catch (error) {
    recordSearchWarning("global_term_router", null, error);
    return {series: selectable, skippedSeriesCount: 0, routerShardRequestCount: 0, failed: true};
  }
}

function intersectPageIndexes(lists) {
  if (!lists.length) return [];
  if (lists.some(list => !list.length)) return [];
  const [shortest, ...remaining] = [...lists].sort((a, b) => a.length - b.length);
  const sets = remaining.map(list => new Set(list));
  return shortest.filter(pageIndex => sets.every(set => set.has(pageIndex)));
}

function unionPageIndexes(lists) {
  return [...new Set(lists.flat())];
}

function candidatePageIndexes(index, criteria) {
  const requiredGroups = [];
  if (criteria.all.length) {
    requiredGroups.push(intersectPageIndexes(criteria.all.map(term => index.postings[term] || [])));
  }
  if (criteria.phraseTerms.length) {
    requiredGroups.push(intersectPageIndexes(criteria.phraseTerms.map(term => index.postings[term] || [])));
  }
  if (criteria.any.length) {
    requiredGroups.push(unionPageIndexes(criteria.any.map(term => index.postings[term] || [])));
  }
  return intersectPageIndexes(requiredGroups);
}

async function readGzipJson(url) {
  const resolvedUrl = archiveDataUrl(url);
  const response = await fetchArchiveResponse(resolvedUrl);
  if (!response.ok) throw new Error(`Unable to load ${resolvedUrl}`);
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser does not support loading compressed search indexes.");
  }
  const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(decompressed).text());
}

async function readJson(url) {
  const resolvedUrl = archiveDataUrl(url);
  const response = await fetchArchiveResponse(resolvedUrl);
  if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
  return response.json();
}

function catalogueBundleDescriptor(registry) {
  return registry.find(entry => entry?.catalogue_bundle?.path)?.catalogue_bundle || null;
}

function setCatalogueLoadMode(mode) {
  catalogueLoadMode = mode;
  document.documentElement.dataset.catalogueLoadMode = mode;
}

async function loadCatalogueRows(registry) {
  const descriptor = catalogueBundleDescriptor(registry);
  if (descriptor) {
    try {
      const payload = await readGzipJson(descriptor.path);
      if (payload?.schema_version !== 1 || !Array.isArray(payload?.collections)) {
        throw new Error("Compact catalogue has an unsupported schema.");
      }
      const rowsById = new Map();
      for (const row of payload.collections) {
        const id = String(row?.id || "");
        if (!id || rowsById.has(id)) throw new Error("Compact catalogue has invalid collection identifiers.");
        rowsById.set(id, row);
      }
      if (rowsById.size !== registry.length) {
        throw new Error("Compact catalogue does not match the collection registry.");
      }
      const rows = registry.map(entry => {
        const row = rowsById.get(String(entry.id || ""));
        if (
          !row
          || row.path !== entry.path
          || !row.collection
          || typeof row.collection !== "object"
          || Array.isArray(row.collection)
          || !Array.isArray(row.issues)
        ) {
          throw new Error(`Compact catalogue entry is invalid for ${entry.id || entry.path}.`);
        }
        return {entry, collectionResponse: row.collection, issuesResponse: row.issues};
      });
      unavailableCatalogueEntries = [];
      setCatalogueLoadMode("compact-bundle");
      return rows;
    } catch (error) {
      console.warn("Compact catalogue unavailable; loading collection files instead.", error);
    }
  }

  setCatalogueLoadMode("per-collection");
  unavailableCatalogueEntries = [];
  const rows = await Promise.all(registry.map(async entry => {
    try {
      const [collectionResponse, issuesResponse] = await Promise.all([
        readJson(`${entry.path}/collection.json`),
        readJson(`${entry.path}/issues.json`),
      ]);
      return {entry, collectionResponse, issuesResponse};
    } catch (error) {
      unavailableCatalogueEntries.push({entry, error});
      console.warn(`Skipping unavailable catalogue collection ${entry.id || entry.path}.`, error);
      return null;
    }
  }));
  const availableRows = rows.filter(Boolean);
  if (!availableRows.length) throw new Error("No collection metadata files from the registry are available.");
  return availableRows;
}

async function loadTextShard(series) {
  if (pagesBySeries.has(series.selection_id)) return pagesBySeries.get(series.selection_id);
  const pagesPromise = readGzipJson(`${series.collection_path}/${series.text_shard}`);
  pagesBySeries.set(series.selection_id, pagesPromise);
  try {
    const pages = await pagesPromise;
    pagesBySeries.set(series.selection_id, pages);
    return pages;
  } catch (error) {
    pagesBySeries.delete(series.selection_id);
    throw error;
  }
}

async function loadSearchIndex(series) {
  if (indexBySeries.has(series.selection_id)) return indexBySeries.get(series.selection_id);
  const indexPromise = readGzipJson(`${series.collection_path}/${series.search_index}`);
  indexBySeries.set(series.selection_id, indexPromise);
  try {
    const index = await indexPromise;
    indexBySeries.set(series.selection_id, index);
    return index;
  } catch (error) {
    indexBySeries.delete(series.selection_id);
    throw error;
  }
}

async function loadCollectionTermManifest(series) {
  const manifestPath = series.term_manifest;
  if (!manifestPath) return null;
  const cacheKey = `${series.collection_id}:${manifestPath}`;
  if (termManifestByCollection.has(cacheKey)) return termManifestByCollection.get(cacheKey);
  const manifestPromise = manifestPath.endsWith(".gz")
    ? readGzipJson(`${series.collection_path}/${manifestPath}`)
    : readJson(`${series.collection_path}/${manifestPath}`);
  termManifestByCollection.set(cacheKey, manifestPromise);
  try {
    const manifest = await manifestPromise;
    let parsed;
    if (manifest?.routing === "alphabetical-range" && manifest?.format === "term-to-series") {
      parsed = {
        mode: "sharded",
        pruned: new Set(Array.isArray(manifest?.pruned) ? manifest.pruned : []),
        boundaries: Array.isArray(manifest?.boundaries) ? manifest.boundaries : [],
        shardTemplate: manifest?.shard_template || "",
        termSeries: new Map(),
      };
    } else {
      parsed = {
        mode: "series",
        series: new Map(),
        pruned: new Set(Array.isArray(manifest?.pruned) ? manifest.pruned : []),
      };
      const seriesTerms = manifest?.series || {};
      for (const [seriesId, terms] of Object.entries(seriesTerms)) {
        parsed.series.set(seriesId, new Set(Array.isArray(terms) ? terms : []));
      }
    }
    termManifestByCollection.set(cacheKey, parsed);
    return parsed;
  } catch (error) {
    termManifestByCollection.delete(cacheKey);
    throw error;
  }
}

async function loadTermManifestShard(series, manifest, shardIndex) {
  const shardPath = termManifestShardPath(manifest.shardTemplate, shardIndex);
  const cacheKey = `${series.collection_id}:${shardPath}`;
  if (termManifestShardByCollection.has(cacheKey)) return termManifestShardByCollection.get(cacheKey);
  const shardPromise = readGzipJson(`${series.collection_path}/${shardPath}`);
  termManifestShardByCollection.set(cacheKey, shardPromise);
  try {
    const shard = await shardPromise;
    termManifestShardByCollection.set(cacheKey, shard);
    return shard;
  } catch (error) {
    termManifestShardByCollection.delete(cacheKey);
    throw error;
  }
}

async function loadShardedTermManifestTerms(series, manifest, criteria) {
  const terms = [
    ...manifestFilterableTerms(criteria.all, manifest.pruned),
    ...manifestFilterableTerms(criteria.phraseTerms, manifest.pruned),
    ...manifestFilterableTerms(criteria.any, manifest.pruned),
  ];
  const shardIndexes = [...new Set(terms.map(term => routeTermManifestShard(term, manifest.boundaries)))];
  await Promise.all(
    shardIndexes.map(async shardIndex => {
      const shard = await loadTermManifestShard(series, manifest, shardIndex);
      for (const term of terms) {
        if (routeTermManifestShard(term, manifest.boundaries) !== shardIndex) continue;
        if (!manifest.termSeries.has(term)) {
          manifest.termSeries.set(term, new Set(Array.isArray(shard?.[term]) ? shard[term] : []));
        }
      }
    })
  );
}

function shardedTermManifestMatchesSeries(seriesId, manifest, criteria) {
  const allTerms = manifestFilterableTerms(criteria.all, manifest.pruned);
  const phraseTerms = manifestFilterableTerms(criteria.phraseTerms, manifest.pruned);
  const anyTerms = manifestFilterableTerms(criteria.any, manifest.pruned);
  if (allTerms.some(term => !manifest.termSeries.get(term)?.has(seriesId))) return false;
  if (phraseTerms.some(term => !manifest.termSeries.get(term)?.has(seriesId))) return false;
  if (
    criteria.any.length === anyTerms.length
    && anyTerms.length
    && !anyTerms.some(term => manifest.termSeries.get(term)?.has(seriesId))
  ) {
    return false;
  }
  return true;
}

async function loadHybridMetadata(series) {
  const hybrid = series.hybrid_index;
  if (!hybrid?.metadata) return null;
  const cacheKey = `${series.collection_id}:${hybrid.metadata}`;
  if (hybridMetadataByCollection.has(cacheKey)) return hybridMetadataByCollection.get(cacheKey);
  const metadataPromise = readGzipJson(`${series.collection_path}/${hybrid.metadata}`);
  hybridMetadataByCollection.set(cacheKey, metadataPromise);
  try {
    const metadata = await metadataPromise;
    hybridMetadataByCollection.set(cacheKey, metadata);
    return metadata;
  } catch (error) {
    hybridMetadataByCollection.delete(cacheKey);
    throw error;
  }
}

function hybridShardPath(template, index) {
  return String(template || "").replace("{index}", String(index));
}

async function loadHybridShard(series, shardIndex) {
  const hybrid = series.hybrid_index;
  if (!hybrid?.shard_template) return null;
  const shardPath = hybridShardPath(hybrid.shard_template, shardIndex);
  const cacheKey = `${series.collection_id}:${shardPath}`;
  if (hybridShardByCollection.has(cacheKey)) return hybridShardByCollection.get(cacheKey);
  const shardPromise = readGzipJson(`${series.collection_path}/${shardPath}`);
  hybridShardByCollection.set(cacheKey, shardPromise);
  try {
    const shard = await shardPromise;
    hybridShardByCollection.set(cacheKey, shard);
    return shard;
  } catch (error) {
    hybridShardByCollection.delete(cacheKey);
    throw error;
  }
}

function routeHybridShard(term, boundaries) {
  for (let index = 0; index < boundaries.length; index += 1) {
    if (term < boundaries[index]) return index;
  }
  return boundaries.length;
}

function hybridCandidatePageIndexes(postingsByTerm, criteria) {
  const requiredGroups = [];
  if (criteria.all.length) {
    requiredGroups.push(intersectPageIndexes(criteria.all.map(term => postingsByTerm.get(term) || [])));
  }
  if (criteria.phraseTerms.length) {
    requiredGroups.push(intersectPageIndexes(criteria.phraseTerms.map(term => postingsByTerm.get(term) || [])));
  }
  if (criteria.any.length) {
    requiredGroups.push(unionPageIndexes(criteria.any.map(term => postingsByTerm.get(term) || [])));
  }
  return intersectPageIndexes(requiredGroups);
}

async function searchHybridCollection(collectionSeries, criteria, issueById, maxCandidateHits, validationBudget) {
  const sampleSeries = collectionSeries[0];
  const metadata = await loadHybridMetadata(sampleSeries);
  if (!metadata?.series_keys || !metadata?.pages || !metadata?.boundaries) {
    return null;
  }

  const selectedSeries = new Set(collectionSeries.map(series => series.id));
  const selectedSeriesIndexes = new Set(
    metadata.series_keys
      .map((seriesId, index) => selectedSeries.has(seriesId) ? index : null)
      .filter(index => index !== null)
  );
  const terms = [...new Set([...criteria.all, ...criteria.phraseTerms, ...criteria.any])];
  const shardIndexes = [...new Set(terms.map(term => routeHybridShard(term, metadata.boundaries)))];
  const shards = new Map();
  await Promise.all(
    shardIndexes.map(async shardIndex => {
      shards.set(shardIndex, await loadHybridShard(sampleSeries, shardIndex));
    })
  );

  const postingsByTerm = new Map();
  for (const term of terms) {
    const shard = shards.get(routeHybridShard(term, metadata.boundaries)) || {};
    postingsByTerm.set(term, shard[term] || []);
  }
  const pageIndexes = hybridCandidatePageIndexes(postingsByTerm, criteria);
  const validateText = needsTextValidation(criteria);
  const pagesBySeriesIndex = new Map();
  const seriesById = new Map(collectionSeries.map(series => [series.id, series]));
  const matches = [];
  let candidatePageCount = 0;

  for (const pageIndex of pageIndexes) {
    const pageRef = metadata.pages[pageIndex];
    if (!pageRef) continue;
    const [seriesIndex, issueId, pageNumber] = pageRef;
    if (!selectedSeriesIndexes.has(seriesIndex)) continue;
    candidatePageCount += 1;
    if (candidatePageCount > maxCandidateHits) break;
    const seriesId = metadata.series_keys[seriesIndex];
    const series = seriesById.get(seriesId);
    if (!series) continue;
    if (validateText) {
      if (!pagesBySeriesIndex.has(seriesIndex)) {
        if (validationBudget.remaining <= 0) {
          return {
            matches,
            candidatePageCount,
            truncated: true,
            searchedSeriesCount: collectionSeries.length,
            hybridCollectionCount: 1,
            shardRequestCount: shardIndexes.length,
            textValidationShardLoads: validationBudget.used,
          };
        }
        validationBudget.remaining -= 1;
        validationBudget.used += 1;
        pagesBySeriesIndex.set(seriesIndex, await loadTextShard(series));
      }
      const pages = pagesBySeriesIndex.get(seriesIndex);
      const localPageIndex = pages.findIndex(page => Number(page.issue_id) === Number(issueId) && Number(page.page) === Number(pageNumber));
      if (localPageIndex < 0 || !textMatchesCriteria(pages[localPageIndex]?.text, criteria)) continue;
      const issue = issueById.get(`${series.collection_id}:${issueId}`);
      if (!issue) continue;
      matches.push({issue, series, pageIndex: localPageIndex, pageNumber, issueId});
      continue;
    }
    const issue = issueById.get(`${series.collection_id}:${issueId}`);
    if (!issue) continue;
    matches.push({issue, series, pageIndex: null, pageNumber, issueId});
  }

  return {
    matches,
    candidatePageCount,
    truncated: candidatePageCount > maxCandidateHits,
    searchedSeriesCount: collectionSeries.length,
    hybridCollectionCount: 1,
    shardRequestCount: shardIndexes.length,
    textValidationShardLoads: validationBudget.used,
  };
}

async function filterSeriesByTermManifest(selectable, criteria) {
  if (!criteriaCanUseTermManifest(criteria)) {
    return {series: selectable, skippedSeriesCount: 0, manifestCollectionCount: 0, failedManifestCount: 0};
  }
  const byCollection = new Map();
  for (const series of selectable) {
    // Hybrid postings already provide exact term membership and page references.
    // Loading a second collection manifest only adds transfer and latency.
    if (series.hybrid_index?.metadata && series.hybrid_index?.shard_template) continue;
    if (!series.term_manifest) continue;
    if (!byCollection.has(series.collection_id)) byCollection.set(series.collection_id, series);
  }
  const manifests = new Map();
  await Promise.all(
    [...byCollection.values()].map(async series => {
      try {
        const manifest = await loadCollectionTermManifest(series);
        if (manifest?.mode === "sharded") {
          await loadShardedTermManifestTerms(series, manifest, criteria);
        }
        manifests.set(series.collection_id, manifest);
      } catch (error) {
        recordSearchWarning("term_manifest", series, error);
        manifests.set(series.collection_id, null);
      }
    })
  );

  const filtered = selectable.filter(series => {
    if (series.hybrid_index?.metadata && series.hybrid_index?.shard_template) return true;
    const manifest = manifests.get(series.collection_id);
    if (!manifest) return true;
    if (manifest.mode === "sharded") {
      return shardedTermManifestMatchesSeries(series.id, manifest, criteria);
    }
    return termManifestMatchesSeries(manifest.series.get(series.id), criteria, manifest.pruned);
  });
  return {
    series: filtered,
    skippedSeriesCount: selectable.length - filtered.length,
    manifestCollectionCount: [...manifests.values()].filter(Boolean).length,
    failedManifestCount: [...manifests.values()].filter(value => !value).length,
  };
}

async function searchSeriesFullText(series, criteria, issueById) {
  const index = await loadSearchIndex(series);
  const pageIndexes = candidatePageIndexes(index, criteria);
  if (!pageIndexes.length) {
    return {series, matches: [], candidatePageCount: 0};
  }
  const validateText = needsTextValidation(criteria);
  const pages = validateText ? await loadTextShard(series) : null;
  const matches = [];
  for (const pageIndex of pageIndexes) {
    if (validateText && !textMatchesCriteria(pages?.[pageIndex]?.text, criteria)) continue;
    const pageRef = index.pages[pageIndex];
    if (!pageRef) continue;
    const [issueId, pageNumber] = pageRef;
    const issue = issueById.get(`${series.collection_id}:${issueId}`);
    if (!issue) continue;
    matches.push({issue, series, pageIndex, pageNumber});
  }
  return {series, matches, candidatePageCount: pageIndexes.length};
}

async function searchFullText(selectable, criteria, issueById, selected) {
  const searchAllIndexed = !selected.size;
  const maxScannedPageHits = selected.size ? 50000 : 20000;
  const concurrency = fullTextConcurrencyLimit(searchAllIndexed);
  const startedAt = nowMillis();
  const timings = {
    routerSeconds: "0.00",
    manifestSeconds: "0.00",
    indexSeconds: "0.00",
    shardSeconds: "0.00",
  };
  const routerStartedAt = nowMillis();
  const routed = await filterSeriesByGlobalRouter(selectable, criteria);
  timings.routerSeconds = elapsedSeconds(routerStartedAt);
  const manifestStartedAt = nowMillis();
  const filtered = await filterSeriesByTermManifest(routed.series, criteria);
  timings.manifestSeconds = elapsedSeconds(manifestStartedAt);
  const searchable = filtered.series;
  const matches = [];
  let scannedPageHits = 0;
  let truncated = false;
  let hybridCollectionCount = 0;
  let hybridShardRequestCount = 0;
  const validationBudget = {
    remaining: needsTextValidation(criteria) ? maxTextValidationShardLoads : Number.POSITIVE_INFINITY,
    used: 0,
  };

  const hybridGroups = new Map();
  const fallbackSeries = [];
  for (const series of searchable) {
    if (series.hybrid_index?.metadata && series.hybrid_index?.shard_template) {
      if (!hybridGroups.has(series.collection_id)) hybridGroups.set(series.collection_id, []);
      hybridGroups.get(series.collection_id).push(series);
    } else {
      fallbackSeries.push(series);
    }
  }

  for (const group of hybridGroups.values()) {
    const remaining = Math.max(0, maxScannedPageHits - scannedPageHits);
    if (!remaining) {
      truncated = true;
      break;
    }
    let result = null;
    try {
      result = await searchHybridCollection(group, criteria, issueById, remaining, validationBudget);
    } catch (error) {
      recordSearchWarning("hybrid_index", group[0], error);
      fallbackSeries.push(...group);
      continue;
    }
    if (!result) {
      fallbackSeries.push(...group);
      continue;
    }
    scannedPageHits += result.candidatePageCount;
    matches.push(...result.matches);
    truncated = truncated || result.truncated || scannedPageHits >= maxScannedPageHits;
    hybridCollectionCount += result.hybridCollectionCount;
    hybridShardRequestCount += result.shardRequestCount;
  }

  let nextSeriesIndex = 0;
  let completedSeriesCount = 0;
  let lastProgress = 0;
  const indexStartedAt = nowMillis();

  async function worker() {
    while (!truncated && nextSeriesIndex < fallbackSeries.length) {
      const series = fallbackSeries[nextSeriesIndex];
      nextSeriesIndex += 1;
      if (needsTextValidation(criteria)) {
        if (validationBudget.remaining <= 0) {
          truncated = true;
          break;
        }
        validationBudget.remaining -= 1;
        validationBudget.used += 1;
      }
      let result;
      try {
        result = await searchSeriesFullText(series, criteria, issueById);
      } catch (error) {
        recordSearchWarning(needsTextValidation(criteria) ? "text_shard" : "search_index", series, error);
        completedSeriesCount += 1;
        continue;
      }
      const beforeScan = scannedPageHits;
      scannedPageHits += result.candidatePageCount;
      const allowedCandidateHits = Math.max(0, maxScannedPageHits - beforeScan);
      if (allowedCandidateHits) {
        matches.push(...result.matches.slice(0, allowedCandidateHits));
      }
      if (scannedPageHits >= maxScannedPageHits) truncated = true;
      completedSeriesCount += 1;
      if (completedSeriesCount === fallbackSeries.length || completedSeriesCount - lastProgress >= 10 || truncated) {
        lastProgress = completedSeriesCount;
        updateStatus(`Searching full text: ${completedSeriesCount} of ${fallbackSeries.length} fallback series checked...`);
      }
    }
  }
  const workers = Array.from({length: Math.min(concurrency, fallbackSeries.length)}, () => worker());
  await Promise.all(workers);
  timings.indexSeconds = elapsedSeconds(indexStartedAt);
  timings.shardSeconds = timings.indexSeconds;

  return {
    matches,
    truncated,
    scannedPageHits: Math.min(scannedPageHits, maxScannedPageHits),
    elapsedSeconds: elapsedSeconds(startedAt),
    concurrency,
    searchedSeriesCount: searchable.length,
    skippedSeriesCount: routed.skippedSeriesCount + filtered.skippedSeriesCount,
    globalRouterSkippedSeriesCount: routed.skippedSeriesCount,
    globalRouterShardRequestCount: routed.routerShardRequestCount,
    globalRouterFailed: routed.failed,
    manifestCollectionCount: filtered.manifestCollectionCount,
    failedManifestCount: filtered.failedManifestCount,
    hybridCollectionCount,
    hybridShardRequestCount,
    textValidationShardLoads: validationBudget.used,
    textValidationShardLimit: needsTextValidation(criteria) ? maxTextValidationShardLoads : null,
    failedLoadCount: currentSearchWarnings.length,
    timings,
  };
}

function snippet(text, terms) {
  const lower = text.toLocaleLowerCase();
  const folded = foldDiacritics(lower);
  const positions = terms
    .map(term => {
      const direct = lower.indexOf(term);
      return direct >= 0 ? direct : folded.indexOf(foldDiacritics(term));
    })
    .filter(position => position >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 90) : 0;
  const excerpt = text.slice(start, start + 270).replace(/\s+/g, " ").trim();
  return `${start ? "... " : ""}${excerpt}${text.length > start + 270 ? " ..." : ""}`;
}

function snippetScore(text, terms, phrase = "") {
  const source = String(text || "");
  const lower = source.toLocaleLowerCase();
  const phraseText = String(phrase || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  let score = terms.reduce((total, term) => total + countOccurrences(lower, term), 0);
  if (phraseText && lower.replace(/\s+/g, " ").includes(phraseText)) score += 25;
  const positions = terms.map(term => lower.indexOf(term)).filter(position => position >= 0);
  if (positions.length >= 2) {
    const span = Math.max(...positions) - Math.min(...positions);
    score += Math.max(0, 10 - Math.floor(span / 80));
  }
  return score;
}

function metadataTextForIssue(issue) {
  return [
    issue.title,
    issue.filename,
    issue.series,
    issue.collection_title,
    issue.remote_path,
    issue.embedded_title,
    issue.embedded_author,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function whyMatchedItems(row, sourceLabels) {
  const items = [];
  sourceLabels.forEach(label => items.push(label));
  const metadataText = metadataTextForIssue(row.issue);
  const terms = currentTerms.filter(term =>
    metadataText.includes(term) ||
    row.sources.has("content") ||
    row.excerpts.some(excerpt => String(excerpt.text || "").toLocaleLowerCase().includes(term))
  );
  if (terms.length) items.push(`terms: ${[...new Set(terms)].slice(0, 5).join(", ")}`);
  if (currentCriteria?.phrase) items.push(`phrase: ${currentCriteria.phrase}`);
  const intelligence = intelligenceForIssue(row.issue);
  if (intelligence?.flags?.includes("likely_sighting")) items.push("likely sighting page");
  const flags = (intelligence?.flags || []).filter(flag => flag !== "likely_sighting").slice(0, 3);
  if (flags.length) items.push(`signals: ${flags.join(", ")}`);
  if (row.bestPage) items.push(`best page ${row.bestPage}`);
  return [...new Set(items)].slice(0, 7);
}

function caseField(row, field) {
  const record = row?.record || row;
  return String(record?.[CASE_FIELD[field]] ?? "");
}

function caseNumberField(row, field) {
  const record = row?.record || row;
  return Number(record?.[CASE_FIELD[field]] || 0);
}

function caseSearchHaystack(record) {
  return foldDiacritics([
    "id", "collection", "title", "date", "year", "location", "region",
    "country", "type", "classification", "source_labels",
  ].map(field => caseField(record, field)).join(" ").toLocaleLowerCase());
}

function normalizedCaseCriteria(criteria) {
  return {
    ...criteria,
    all: criteria.all.map(foldDiacritics),
    phraseTerms: criteria.phraseTerms.map(foldDiacritics),
    any: criteria.any.map(foldDiacritics),
    none: criteria.none.map(foldDiacritics),
    phrase: foldDiacritics(criteria.phrase),
  };
}

function caseMatchesCriteria(record, criteria) {
  const year = Number(caseField(record, "year") || 0);
  if (criteria.yearMin && (!year || year < criteria.yearMin)) return false;
  if (criteria.yearMax && (!year || year > criteria.yearMax)) return false;
  return textMatchesCriteria(caseSearchHaystack(record), criteria);
}

function caseMatchScore(record, criteria) {
  const id = foldDiacritics(caseField(record, "id").toLocaleLowerCase());
  const title = foldDiacritics(caseField(record, "title").toLocaleLowerCase());
  const location = foldDiacritics(caseField(record, "location").toLocaleLowerCase());
  const region = foldDiacritics(caseField(record, "region").toLocaleLowerCase());
  const country = foldDiacritics(caseField(record, "country").toLocaleLowerCase());
  const source = foldDiacritics(caseField(record, "source_labels").toLocaleLowerCase());
  const terms = positiveTerms(criteria).map(foldDiacritics);
  let score = caseNumberField(record, "source_count") * 3;
  for (const term of terms) {
    if (id === term) score += 2000;
    score += countOccurrences(title, term) * 180;
    score += countOccurrences(location, term) * 140;
    score += countOccurrences(region, term) * 70;
    score += countOccurrences(country, term) * 55;
    score += countOccurrences(source, term) * 35;
  }
  if (criteria.phrase && title.includes(criteria.phrase)) score += 450;
  return score;
}

function caseEvidenceUrl(row) {
  const raw = caseField(row, "evidence_url").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, MAP_EVIDENCE_DATA_BASE_URL);
    if (url.protocol === "http:" && /(^|\.)fold3\.com$/i.test(url.hostname)) url.protocol = "https:";
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function caseSourceEvidenceUrl(source) {
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
    const url = new URL(raw, MAP_EVIDENCE_DATA_BASE_URL);
    if (url.protocol === "http:" && /(^|\.)fold3\.com$/i.test(url.hostname)) url.protocol = "https:";
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function sourceArchiveRecordUrl(source) {
  const documentId = String(source.afu_document_id || source.online_source_document_id || "").trim();
  if (!documentId) return "";
  const url = new URL(SEARCH_UI_BASE_URL);
  url.searchParams.set("issue", documentId);
  url.searchParams.set("fulltext", "1");
  url.searchParams.set("autorun", "1");
  return url.href;
}

function readableEvidenceStatus(source) {
  const raw = String(
    source.validation_status
    || source.page_mapping_status
    || source.link_confidence
    || source.link_status
    || ""
  ).trim();
  return raw.replaceAll("_", " ");
}

function caseEvidenceSources(row) {
  const recordId = caseField(row, "id");
  const sources = mapSourcesByRecordId.get(recordId) || [];
  const unique = new Map();
  for (const source of sources) {
    const evidenceUrl = caseSourceEvidenceUrl(source);
    if (!evidenceUrl) continue;
    const sourceCode = String(source.source_code || source.source_label || "").trim();
    const page = String(source.online_source_page || source.search_hit_page || "").trim();
    const key = `${evidenceUrl}|${sourceCode}|${page}`;
    if (!unique.has(key)) unique.set(key, {...source, _evidence_url: evidenceUrl});
  }
  return [...unique.values()].sort((left, right) =>
    Number(String(right.citation_role || "").toLocaleLowerCase() === "primary")
      - Number(String(left.citation_role || "").toLocaleLowerCase() === "primary")
    || String(left.source_label || left.source_code || "").localeCompare(String(right.source_label || right.source_code || ""))
    || String(left.online_source_page || left.search_hit_page || "").localeCompare(String(right.online_source_page || right.search_hit_page || ""))
  );
}

function caseEvidenceTrailMarkup(row) {
  const sources = caseEvidenceSources(row);
  const expectedCount = caseNumberField(row, "source_count");
  if (!sources.length) {
    if (mapEvidenceLoadState === "loading" && expectedCount) {
      return `<div class="case-evidence-loading" aria-live="polite">Loading all public evidence links…</div>`;
    }
    return "";
  }
  const shown = sources.slice(0, 8);
  const overflow = sources.length - shown.length;
  return `
    <details class="case-evidence-trail" ${sources.length <= 3 ? "open" : ""}>
      <summary>
        <span>Evidence trail</span>
        <strong>${sources.length.toLocaleString()} public link${sources.length === 1 ? "" : "s"}</strong>
      </summary>
      <div class="case-evidence-source-list">
        ${shown.map(source => {
          const label = String(source.source_label || source.source_code || "Public source").trim();
          const issue = String(source.issue_label || source.online_source_label || source.case_title || source.item_record_number || "").trim();
          const page = String(source.online_source_page || source.search_hit_page || "").trim();
          const status = readableEvidenceStatus(source);
          const role = String(source.citation_role || "").trim();
          const archiveUrl = sourceArchiveRecordUrl(source);
          const badges = [
            role,
            page ? `page ${page}` : "",
            status,
          ].filter(Boolean);
          return `<article>
            <div class="case-evidence-source-heading">
              <strong>${escapeHtml(label)}</strong>
              ${badges.length ? `<span>${badges.map(value => escapeHtml(value)).join(" / ")}</span>` : ""}
            </div>
            ${issue ? `<p>${escapeHtml(issue)}</p>` : ""}
            <div class="case-evidence-source-actions">
              <a href="${escapeHtml(source._evidence_url)}" target="_blank" rel="noopener">Open evidence</a>
              ${archiveUrl ? `<a href="${escapeHtml(archiveUrl)}">Open archive record</a>` : ""}
            </div>
          </article>`;
        }).join("")}
      </div>
      ${overflow > 0 ? `<p class="case-evidence-overflow">${overflow.toLocaleString()} additional link${overflow === 1 ? "" : "s"} available on the full map.</p>` : ""}
      <p class="case-evidence-note">Links identify public source material; they are not a credibility score.</p>
    </details>`;
}

function caseMapUrl(recordIds) {
  const url = new URL(MAP_UI_BASE_URL);
  const ids = [...new Set(recordIds.map(value => String(value || "").trim()).filter(Boolean))];
  if (ids.length) url.searchParams.set("prn", ids.slice(0, 80).join(","));
  url.searchParams.set("evidence", "1");
  return url.href;
}

function caseDetailUrl(row) {
  const url = new URL("case/", SEARCH_UI_BASE_URL);
  const recordId = caseField(row, "id");
  const collection = caseField(row, "collection");
  if (recordId) url.searchParams.set("id", recordId);
  if (collection) url.searchParams.set("collection", collection);
  if (isLocalArchivePreview()
    && url.origin === window.location.origin
    && new URLSearchParams(window.location.search).get("publicData") === "1") {
    url.searchParams.set("publicData", "1");
  }
  return url.href;
}

function caseCitation(row) {
  const parts = [
    caseField(row, "title"),
    caseField(row, "date") ? `date ${caseField(row, "date")}` : "",
    caseField(row, "location") ? `location ${caseField(row, "location")}` : "",
    `${CASE_COLLECTION_LABELS[caseField(row, "collection")] || caseField(row, "collection")} record ${caseField(row, "id")}`,
    caseDetailUrl(row),
  ].filter(Boolean);
  return parts.join(". ");
}

function caseResearchButton(row) {
  const recordId = caseField(row, "id");
  const detailUrl = caseDetailUrl(row);
  return `<button class="citation-action research-save-button" type="button" data-research-add
    data-research-id="${escapeHtml(`case:${recordId}`)}"
    data-research-type="mapped-case"
    data-research-title="${escapeHtml(caseField(row, "title") || recordId)}"
    data-research-subtitle="${escapeHtml(CASE_COLLECTION_LABELS[caseField(row, "collection")] || caseField(row, "collection"))}"
    data-research-url="${escapeHtml(detailUrl)}"
    data-research-citation="${escapeHtml(caseCitation(row))}"
    data-research-date="${escapeHtml(caseField(row, "date"))}"
    data-research-location="${escapeHtml(caseField(row, "location"))}"
    data-research-collection="${escapeHtml(caseField(row, "collection"))}"
    data-research-record-id="${escapeHtml(recordId)}"
    data-research-source-families="${escapeHtml(caseField(row, "source_labels"))}"
    data-research-source-count="${escapeHtml(caseNumberField(row, "source_count"))}"
    data-research-evidence-status="${caseEvidenceUrl(row) ? "linked" : "mapped"}">Add to research set</button>`;
}

function renderCaseFilterOptions() {
  if (!caseCollectionFilter || !caseCountryFilter) return;
  const selectedCollection = pendingCaseFilters.collection || caseCollectionFilter.value;
  const selectedCountry = pendingCaseFilters.country || caseCountryFilter.value;
  const collectionCounts = new Map(caseSearchSummary.collectionCounts || []);
  const countryCounts = new Map(caseSearchSummary.countryCounts || []);
  if (caseSearchEngine !== "worker") {
    collectionCounts.clear();
    countryCounts.clear();
    for (const row of caseUniverse) {
      const collection = caseField(row, "collection");
      const country = caseField(row, "country");
      if (collection) collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + 1);
      if (country) countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
    }
  }
  const totalMatches = caseSearchEngine === "worker"
    ? Number(caseSearchSummary.totalMatches || 0)
    : caseUniverse.length;
  caseCollectionFilter.innerHTML = `<option value="">All mapped collections (${totalMatches.toLocaleString()})</option>${[...collectionCounts]
    .sort((left, right) => (CASE_COLLECTION_LABELS[left[0]] || left[0]).localeCompare(CASE_COLLECTION_LABELS[right[0]] || right[0]))
    .map(([value, count]) => `<option value="${escapeHtml(value)}">${escapeHtml(CASE_COLLECTION_LABELS[value] || value)} (${count.toLocaleString()})</option>`)
    .join("")}`;
  caseCountryFilter.innerHTML = `<option value="">All countries (${totalMatches.toLocaleString()})</option>${[...countryCounts]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([value, count]) => `<option value="${escapeHtml(value)}">${escapeHtml(value)} (${count.toLocaleString()})</option>`)
    .join("")}`;
  if ([...caseCollectionFilter.options].some(option => option.value === selectedCollection)) caseCollectionFilter.value = selectedCollection;
  if ([...caseCountryFilter.options].some(option => option.value === selectedCountry)) caseCountryFilter.value = selectedCountry;
  if (caseEvidenceFilter) caseEvidenceFilter.checked = pendingCaseFilters.evidence || caseEvidenceFilter.checked;
  pendingCaseFilters = {collection: "", country: "", evidence: false};
}

function activeCaseFilters() {
  return {
    collection: pendingCaseFilters.collection || caseCollectionFilter?.value || "",
    country: pendingCaseFilters.country || caseCountryFilter?.value || "",
    evidence: pendingCaseFilters.evidence || Boolean(caseEvidenceFilter?.checked),
  };
}

async function refreshWorkerCaseResults({updateUrl = true, announce = true} = {}) {
  const refreshId = caseSearchRefreshId + 1;
  caseSearchRefreshId = refreshId;
  const summary = await caseSearchWorkerCall("search", {
    criteria: currentCaseCriteria,
    filters: activeCaseFilters(),
    sort: resultSortInput?.value || "relevance",
    limit: visibleCount,
  });
  if (refreshId !== caseSearchRefreshId) return false;
  caseSearchSummary = summary;
  currentResults = summary.rows;
  caseUniverse = [];
  document.documentElement.dataset.caseWorkerVisibleRows = String(currentResults.length);
  document.documentElement.dataset.caseWorkerTotalMatches = String(summary.totalMatches);
  document.documentElement.dataset.caseWorkerDurationMs = String(summary.durationMs);
  renderCaseFilterOptions();
  renderResults();
  renderResultFacetStatus();
  currentResultNote = resultCountNote();
  if (caseFilterStatus) caseFilterStatus.textContent = currentResultNote;
  if (announce) {
    updateStatus(`${currentResultNote} Case filtering took ${Number(summary.durationMs || 0).toLocaleString()} ms off the page's main thread.`);
  }
  if (updateUrl) updateShareUrl();
  return true;
}

async function applyCaseFilters({updateUrl = true} = {}) {
  visibleCount = pageSize;
  if (caseSearchEngine === "worker") {
    await refreshWorkerCaseResults({updateUrl});
    return;
  }
  const filters = activeCaseFilters();
  currentResults = caseUniverse.filter(row =>
    (!filters.collection || caseField(row, "collection") === filters.collection)
    && (!filters.country || caseField(row, "country") === filters.country)
    && (!filters.evidence || Boolean(caseEvidenceUrl(row)))
  );
  sortCurrentResults();
  caseSearchSummary = {
    totalMatches: caseUniverse.length,
    filteredCount: currentResults.length,
    collectionCounts: [],
    countryCounts: [],
    durationMs: 0,
  };
  renderCaseFilterOptions();
  renderResults();
  renderResultFacetStatus();
  currentResultNote = resultCountNote();
  if (caseFilterStatus) caseFilterStatus.textContent = currentResultNote;
  updateStatus(currentResultNote);
  if (updateUrl) updateShareUrl();
}

async function runCaseSearch(criteria, searchStartedAt) {
  currentResultMode = "cases";
  currentSearchTruncated = false;
  facetUniverse = [];
  updateResultModePresentation();
  if (!hasPositiveCriteria(criteria) && !criteria.yearMin && !criteria.yearMax) {
    caseUniverse = [];
    currentResults = [];
    currentCaseCriteria = null;
    caseSearchSummary = {
      totalMatches: 0,
      filteredCount: 0,
      collectionCounts: [],
      countryCounts: [],
      durationMs: 0,
    };
    visibleCount = pageSize;
    renderResults();
    renderResultFacetStatus();
    updateShareUrl();
    updateStatus(criteria.none.length ? "Enter a positive case-search term as well as excluded words." : "Enter a case-search term or year range.");
    return;
  }
  updateStatus("Loading the compact mapped-case index...");
  try {
    await initializeCaseSearchEngine();
  } catch (error) {
    caseUniverse = [];
    currentResults = [];
    renderResults();
    resultsElement.innerHTML = `<p class="empty-state load-error">Mapped case search is temporarily unavailable. ${escapeHtml(error.message)}</p>`;
    updateStatus(`Mapped case search is unavailable: ${error.message}`);
    return;
  }
  currentCaseCriteria = normalizedCaseCriteria(criteria);
  visibleCount = pageSize;
  if (caseSearchEngine === "worker") {
    try {
      await refreshWorkerCaseResults({updateUrl: false, announce: false});
    } catch (error) {
      caseUniverse = [];
      currentResults = [];
      renderResults();
      resultsElement.innerHTML = `<p class="empty-state load-error">Mapped case search is temporarily unavailable. ${escapeHtml(error.message)}</p>`;
      updateStatus(`Mapped case search is unavailable: ${error.message}`);
      return;
    }
  } else {
    caseUniverse = caseDiscoveryRecords
      .filter(record => caseMatchesCriteria(record, currentCaseCriteria))
      .map(record => ({record, score: caseMatchScore(record, currentCaseCriteria)}));
    await applyCaseFilters({updateUrl: false});
  }
  focusResultsIfRequested();
  const seconds = elapsedSeconds(searchStartedAt);
  currentResultNote = resultCountNote();
  const workerNote = caseSearchEngine === "worker"
    ? ` Worker matching and filtering took ${Number(caseSearchSummary.durationMs || 0).toLocaleString()} ms off the page's main thread.`
    : "";
  updateStatus(`${currentResultNote} Case index search completed in ${seconds}s.${workerNote} The map remains unloaded until requested.`);
  updateShareUrl();
  updateScopeStatus();
}

function resultDomId(result) {
  return `result-${String(result.issue.document_id || result.issue.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function relatedMapUrl(row) {
  const url = new URL(MAP_UI_BASE_URL);
  const mapSources = mapSourcesForIssue(row.issue);
  const prns = [...new Set(mapSources.map(source => String(source.ufocat_prn || "")).filter(Boolean))];
  if (prns.length) {
    url.searchParams.set("prn", prns.slice(0, 80).join(","));
  }
  const labels = [...new Set(mapSources.map(source => String(source.source_label || source.source_code || "")).filter(Boolean))];
  const query = prns.length
    ? labels.slice(0, 2).join(" ")
    : currentTerms.length ? currentTerms.join(" ") : row.issue.title || row.issue.series || "";
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("evidence", "1");
  return url.href;
}

function visibleResultsMapUrl() {
  if (currentResultMode === "cases") {
    const recordIds = currentResults.slice(0, visibleCount).map(row => caseField(row, "id"));
    return {url: caseMapUrl(recordIds), mappedCount: recordIds.length};
  }
  const url = new URL(MAP_UI_BASE_URL);
  const rows = currentResults.slice(0, visibleCount);
  const allRecordIds = [...new Set(rows.flatMap(row =>
    mapSourcesForIssue(row.issue)
      .map(source => String(source.ufocat_prn || source.record_id || source.geipan_case_id || "").trim())
      .filter(Boolean)
  ))];
  const recordIds = requestedMapRecordIds.size
    ? allRecordIds.filter(recordId => requestedMapRecordIds.has(recordId))
    : allRecordIds;
  if (recordIds.length) url.searchParams.set("prn", recordIds.slice(0, 80).join(","));
  const query = recordIds.length
    ? ""
    : currentTerms.length
      ? currentTerms.join(" ")
      : rows.length === 1 ? rows[0].issue.title || rows[0].issue.series || "" : "";
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("evidence", "1");
  return {url: url.href, mappedCount: recordIds.length};
}

function updateResultsMapLink() {
  if (!showResultsMapElement) return;
  const {url, mappedCount} = visibleResultsMapUrl();
  showResultsMapElement.href = url;
  showResultsMapElement.setAttribute("aria-disabled", String(!mappedCount));
  showResultsMapElement.classList.toggle("disabled", !mappedCount);
  showResultsMapElement.textContent = mappedCount
    ? `Show ${mappedCount.toLocaleString()} mapped case${mappedCount === 1 ? "" : "s"}`
    : "No mapped cases in results";
  if (toggleResultsMapButton) {
    toggleResultsMapButton.hidden = !mappedCount;
    toggleResultsMapButton.disabled = !mappedCount;
    toggleResultsMapButton.textContent = resultsMapOpen ? "Refresh map" : "Preview map";
  }
  if (openResultsMapLink) openResultsMapLink.href = url;
  if (resultsMapOpen) syncResultsMapFrame(url, mappedCount);
}

function syncResultsMapFrame(url, mappedCount) {
  if (!resultsMapOpen || !resultsMapFrame || !resultsMapPanel || !resultsLayout) return;
  resultsMapPanel.hidden = false;
  resultsLayout.classList.add("map-open");
  if (mappedCount && resultsMapFrame.src !== url) resultsMapFrame.src = url;
  if (resultsMapNote) {
    resultsMapNote.textContent = mappedCount
      ? `Showing up to ${mappedCount.toLocaleString()} visible mapped case${mappedCount === 1 ? "" : "s"}. Selecting “Locate here” focuses one case.`
      : "No mapped cases are available in the visible results.";
  }
}

function openResultsMapPreview(url = "", mappedCount = 0) {
  const visibleMap = visibleResultsMapUrl();
  resultsMapOpen = true;
  syncResultsMapFrame(url || visibleMap.url, mappedCount || visibleMap.mappedCount);
  if (toggleResultsMapButton) toggleResultsMapButton.textContent = "Refresh map";
}

function closeResultsMapPreview() {
  resultsMapOpen = false;
  if (resultsMapPanel) resultsMapPanel.hidden = true;
  if (resultsLayout) resultsLayout.classList.remove("map-open");
  if (toggleResultsMapButton) toggleResultsMapButton.textContent = "Preview map";
}

function sourceMapUrl(source, fallbackIssue = null) {
  const url = new URL(MAP_UI_BASE_URL);
  const prn = String(source.ufocat_prn || source.record_id || source.geipan_case_id || "").trim();
  if (prn) url.searchParams.set("prn", prn);
  const sourceDoc = source.afu_document_id || source.online_source_document_id || "";
  const sourceCode = source.source_code || "";
  if (sourceDoc) url.searchParams.set("source_doc", sourceDoc);
  if (sourceCode) url.searchParams.set("source_code", sourceCode);
  const query = source.search_anchor_term
    || source.online_source_search_term
    || source.source_label
    || fallbackIssue?.series
    || fallbackIssue?.title
    || "";
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("evidence", "1");
  return url.href;
}

function mapSourcesForIssue(issue) {
  return mapSourcesByDocumentId.get(String(issue.document_id || "")) || [];
}

function caseDossiersForIssue(issue) {
  const rows = mapSourcesForIssue(issue)
    .map(source => caseDossierByRecordId.get(String(source.ufocat_prn || source.record_id || "")))
    .filter(Boolean);
  return [...new Map(rows.map(row => [String(row.record_id), row])).values()];
}

function mappedEvidenceSummary(issue) {
  const sources = mapSourcesForIssue(issue);
  const prns = new Set(sources.map(source => String(source.ufocat_prn || "")).filter(Boolean));
  if (!prns.size) return null;
  const labels = [...new Set(sources.map(source => String(source.source_label || source.source_code || "")).filter(Boolean))].slice(0, 3);
  const mappedPages = sources.filter(source => source.validation_status === "mapped_page_valid" || source.online_source_page || source.search_hit_page).length;
  const anchors = [...new Set(sources.map(source => String(source.search_anchor_term || source.online_source_search_term || "")).filter(Boolean))].slice(0, 3);
  return {
    prnCount: prns.size,
    sourceCount: sources.length,
    mappedPages,
    anchors,
    label: labels.join(", "),
  };
}

function evidenceTrailMarkup(issue, mapEvidence, mapUrl) {
  if (!mapEvidence) return "";
  const trailStats = [
    `${mapEvidence.prnCount.toLocaleString()} mapped case${mapEvidence.prnCount === 1 ? "" : "s"}`,
    `${mapEvidence.sourceCount.toLocaleString()} source link${mapEvidence.sourceCount === 1 ? "" : "s"}`,
    mapEvidence.mappedPages ? `${mapEvidence.mappedPages.toLocaleString()} page-mapped` : "",
    mapEvidence.label,
  ].filter(Boolean);
  const anchors = mapEvidence.anchors.length
    ? `<p class="evidence-anchors">Anchors: ${mapEvidence.anchors.map(escapeHtml).join(", ")}</p>`
    : "";
  const dossiers = caseDossiersForIssue(issue);
  const dossierLinks = dossiers.length
    ? `<div class="dossier-result-links"><strong>Flagship dossiers</strong>${dossiers.map(row => `<a href="${escapeHtml(searchUiUrl(row.stable_url || ("cases/" + row.slug + "/")))}">${escapeHtml(row.title || ("UFOCAT " + row.record_id))}</a>`).join("")}</div>`
    : "";
  return `
    <div class="evidence-trail">
      <p>${trailStats.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</p>
      ${anchors}
      <div class="evidence-trail-actions">
        <a href="${escapeHtml(mapUrl)}">View cited cases on map</a>
        <a href="${escapeHtml(buildShareUrl({autorun: true, issue: issue.document_id, fulltext: true}))}">Search within this issue</a>
      </div>
      ${dossierLinks}
      ${evidenceTrailDetailsMarkup(issue)}
    </div>
  `;
}

function evidenceTrailDetailsMarkup(issue) {
  const sources = mapSourcesForIssue(issue);
  if (!sources.length) return "";
  const rows = sources
    .slice()
    .sort((left, right) =>
      String(left.ufocat_prn || "").localeCompare(String(right.ufocat_prn || "")) ||
      String(left.online_source_page || left.search_hit_page || "").localeCompare(String(right.online_source_page || right.search_hit_page || "")) ||
      String(left.source_label || "").localeCompare(String(right.source_label || ""))
    )
    .slice(0, 12);
  const overflow = sources.length > rows.length ? `<p class="evidence-detail-more">${(sources.length - rows.length).toLocaleString()} more source link${sources.length - rows.length === 1 ? "" : "s"} available on the map.</p>` : "";
  return `
    <details class="evidence-detail">
      <summary>Show cited case details</summary>
      <div class="evidence-detail-list">
        ${rows.map(source => {
          const prn = source.ufocat_prn || source.record_id || source.geipan_case_id || "mapped case";
          const page = source.online_source_page || source.search_hit_page || "";
          const status = source.validation_status || source.page_mapping_status || source.link_confidence || "";
          const title = [source.source_label || source.source_code || "Archive source", source.issue_label].filter(Boolean).join(" / ");
          return `
            <article>
              <strong>${escapeHtml(prn)}</strong>
              <span>${escapeHtml(title)}</span>
              <span>${escapeHtml([page ? `page ${page}` : "", status].filter(Boolean).join(" / ") || "source link")}</span>
              <a href="${escapeHtml(sourceMapUrl(source, issue))}">Open this case on map</a>
            </article>
          `;
        }).join("")}
        ${overflow}
      </div>
    </details>
  `;
}

function resultCitation(row, page, searchUrl) {
  const issue = row.issue;
  const title = String(issue.title || "Archive document").trim();
  const series = String(issue.series || "").trim();
  const collection = String(issue.collection_title || issue.collection_id || "Isaac Koi Archive").trim();
  const year = issueYear(issue);
  const details = [series, year, collection, page ? `evidence page ${page}` : ""].filter(Boolean).join(". ");
  return `Isaac Koi Archive. "${title}." ${details}${details ? "." : ""} ${searchUrl}`;
}

function canonicalSearchResultUrl(searchUrl) {
  const source = new URL(searchUrl, window.location.href);
  const canonical = new URL(SEARCH_UI_BASE_URL);
  canonical.search = source.search;
  canonical.hash = source.hash;
  return canonical.href;
}

function researchItemButton(row, page, searchUrl, mapEvidence) {
  const issue = row.issue;
  const documentId = String(issue.document_id || issue.id || "");
  if (!documentId) return "";
  const canonicalUrl = canonicalSearchResultUrl(searchUrl);
  const sourceFamilies = [...new Set(mapSourcesForIssue(issue)
    .map(source => String(source.source_label || source.source_code || "").trim())
    .filter(Boolean))];
  const evidenceStatus = mapEvidence
    ? `${mapEvidence.mappedPages} page-resolved of ${mapEvidence.sourceCount} public source links`
    : issue.access_mode === "online" ? "Public archive document" : "Catalogue metadata record";
  return `<button class="citation-action research-save-button" type="button" data-research-add
    data-research-id="${escapeHtml(`document:${documentId}`)}"
    data-research-type="archive-document"
    data-research-title="${escapeHtml(issue.title || "Archive document")}"
    data-research-subtitle="${escapeHtml(issue.series || "")}"
    data-research-url="${escapeHtml(canonicalUrl)}"
    data-research-citation="${escapeHtml(resultCitation(row, page, canonicalUrl))}"
    data-research-date="${escapeHtml(issueYear(issue) || "")}"
    data-research-collection="${escapeHtml(issue.collection_title || issue.collection_id || "")}"
    data-research-document-id="${escapeHtml(documentId)}"
    data-research-source-families="${escapeHtml(sourceFamilies.join("|"))}"
    data-research-source-count="${escapeHtml(mapEvidence?.sourceCount || 0)}"
    data-research-evidence-status="${escapeHtml(evidenceStatus)}">Add to research set</button>`;
}

function resultNeedsSnippets(result) {
  return Boolean(result.textHitPages && !result.excerpts.length && result.storedPages.length);
}

function renderResultExcerpts(row) {
  if (row.excerpts.length) {
    return `<div class="excerpts">${row.excerpts.map(excerpt => `
      <p class="excerpt">${pdfOpenUrl(row.issue, excerpt.page, currentTerms)
        ? `<a class="page-prefix" href="${escapeHtml(pdfOpenUrl(row.issue, excerpt.page, currentTerms))}" target="_blank" rel="noopener">Page ${escapeHtml(excerpt.page)}</a>`
        : `<span class="page-prefix">Page ${escapeHtml(excerpt.page)}</span>`}: ${highlightedSnippet(excerpt.text, currentTerms, currentCriteria?.phrase || "")}</p>
    `).join("")}</div>`;
  }
  if (resultNeedsSnippets(row)) {
    return `<div class="excerpts snippet-pending" aria-live="polite">
      <p class="excerpt-skeleton"><span></span><span></span><span></span></p>
    </div>`;
  }
  return "";
}

function updateResultExcerpts(row) {
  const article = document.getElementById(resultDomId(row));
  const container = article?.querySelector("[data-snippet-slot]");
  if (!container) return;
  container.innerHTML = renderResultExcerpts(row);
}

async function hydrateResultSnippets(result, terms, runId) {
  if (!resultNeedsSnippets(result)) return;
  const scoredPages = [];
  const bySeries = new Map();
  for (const pageRef of result.storedPages) {
    if (!bySeries.has(pageRef.series.id)) bySeries.set(pageRef.series.id, {series: pageRef.series, pageRefs: []});
    bySeries.get(pageRef.series.id).pageRefs.push(pageRef);
  }
  for (const group of bySeries.values()) {
    let pages;
    try {
      pages = await loadTextShard(group.series);
    } catch (error) {
      recordSearchWarning("text_shard", group.series, error);
      continue;
    }
    if (runId !== currentSearchRunId) return;
    for (const pageRef of group.pageRefs) {
      const page = pageRef.pageIndex === null || pageRef.pageIndex === undefined
        ? pages.find(candidate => Number(candidate.issue_id) === Number(pageRef.issueId) && Number(candidate.page) === Number(pageRef.page))
        : pages[pageRef.pageIndex];
      if (!page) continue;
      const text = String(page.text || "");
      const score = snippetScore(text, terms, currentCriteria?.phrase || "");
      scoredPages.push({
        page: page.page,
        text,
        score,
      });
    }
  }
  scoredPages.sort((a, b) => b.score - a.score || a.page - b.page);
  const selected = [];
  const seenPages = new Set();
  for (const row of scoredPages) {
    if (seenPages.has(row.page) || !row.text) continue;
    seenPages.add(row.page);
    selected.push({
      page: row.page,
      text: snippet(row.text, terms),
    });
    if (selected.length >= maxSnippetsPerResult) break;
  }
  result.excerpts = selected;
  if (!result.pinned || !requestedPage) {
    result.bestPage = selected[0]?.page || result.bestPage;
  }
  result.excerpt = selected[0]?.text || "";
  if (runId === currentSearchRunId) updateResultExcerpts(result);
}

async function hydrateVisibleSnippets(terms, runId = currentSearchRunId) {
  const visible = currentResults.slice(0, visibleCount).filter(result =>
    resultNeedsSnippets(result)
  );
  await Promise.all(visible.map(result => hydrateResultSnippets(result, terms, runId)));
}

function renderCaseResults() {
  const rows = currentResults.slice(0, visibleCount);
  if (!rows.length) {
    resultsElement.innerHTML = "<p>No matching mapped cases.</p>";
    updateResultsMapLink();
    return;
  }
  const markup = rows.map(row => {
    const recordId = caseField(row, "id");
    const collection = caseField(row, "collection");
    const collectionLabel = CASE_COLLECTION_LABELS[collection] || collection;
    const mapUrl = caseMapUrl([recordId]);
    const detailUrl = caseDetailUrl(row);
    const evidenceUrl = caseEvidenceUrl(row);
    const evidenceTrail = caseEvidenceTrailMarkup(row);
    const sourceCount = caseNumberField(row, "source_count");
    const dossier = caseDossierByRecordId.get(recordId);
    const metadata = [
      caseField(row, "date"),
      caseField(row, "location"),
      caseField(row, "region"),
      caseField(row, "country"),
      caseField(row, "type"),
      caseField(row, "classification") ? `Class ${caseField(row, "classification")}` : "",
    ].filter(Boolean);
    const stats = [
      `${sourceCount.toLocaleString()} linked source${sourceCount === 1 ? "" : "s"}`,
      evidenceUrl ? "source/file link" : "map metadata",
      dossier ? "reviewed dossier" : "",
    ].filter(Boolean);
    return `
      <article id="case-${escapeHtml(recordId.replace(/[^a-zA-Z0-9_-]/g, "-"))}" class="result no-thumbnail case-result">
        <div class="result-body">
          <p class="series-name">${escapeHtml(collectionLabel)} / ${escapeHtml(recordId)}</p>
          <h3>${escapeHtml(caseField(row, "title") || recordId)}</h3>
          <p class="result-meta">${metadata.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</p>
          <p class="result-stat-strip">${stats.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</p>
          ${caseField(row, "source_labels") ? `<p class="source-map-summary">Source family: ${escapeHtml(caseField(row, "source_labels"))}</p>` : ""}
          ${evidenceTrail}
          <div class="result-actions">
            ${evidenceUrl ? `<a class="evidence-action" href="${escapeHtml(evidenceUrl)}" target="_blank" rel="noopener">Open representative evidence <span aria-hidden="true">&nearr;</span></a>` : ""}
            <a class="secondary-action" href="${escapeHtml(detailUrl)}">Open case page</a>
            <button class="secondary-action" type="button" data-preview-case-map="${escapeHtml(recordId)}">Locate here</button>
            <a class="secondary-action map-evidence-action" href="${escapeHtml(mapUrl)}">Open case on full map</a>
            ${dossier ? `<a class="secondary-action" href="${escapeHtml(searchUiUrl(dossier.stable_url || ("cases/" + dossier.slug + "/")))}">Open reviewed dossier</a>` : ""}
            <button class="citation-action" type="button" data-copy-case-citation="${escapeHtml(recordId)}">Copy citation</button>
            ${caseResearchButton(row)}
          </div>
        </div>
      </article>`;
  }).join("");
  const moreMarkup = Number(caseSearchSummary.filteredCount || 0) > rows.length
    ? `<button id="load-more-results" class="load-more" type="button">Load 25 more cases</button>`
    : "";
  resultsElement.innerHTML = `${markup}${moreMarkup}`;
  window.IsaacKoiResearch?.render();
  updateResultsMapLink();
}

function renderResults() {
  if (currentResultMode === "cases") {
    renderCaseResults();
    return;
  }
  const rows = currentResults.slice(0, visibleCount);
  if (!rows.length) {
    resultsElement.innerHTML = "<p>No matching results.</p>";
    updateResultsMapLink();
    return;
  }
  const resultMarkup = rows.map(row => {
    const pageSummary = matchingPageSummary(row);
    const sourceLabels = [];
    if (row.sources.has("metadata")) sourceLabels.push("title/metadata");
    if (row.sources.has("content")) sourceLabels.push("full text");
    if (row.sources.has("direct-link")) sourceLabels.push("direct link");
    const signalPage = likelySightingPage(row.issue);
    const openPage = row.bestPage || signalPage || null;
    const openPdfUrl = pdfOpenUrl(row.issue, openPage, currentTerms);
    const evidenceLabel = openPage ? `View evidence page ${openPage}` : "Open PDF";
    const searchUrl = buildShareUrl({autorun: true, issue: row.issue.document_id, page: openPage});
    const mapUrl = relatedMapUrl(row);
    const mapEvidence = mappedEvidenceSummary(row.issue);
    const issueYearText = issueYear(row.issue);
    const pageCount = Number(row.issue.page_count || row.issue.pages || 0);
    const resultStats = [
      row.textHitPages ? `${row.textHitPages.toLocaleString()} full-text hit${row.textHitPages === 1 ? "" : "s"}` : "",
      row.excerpts.length ? `${row.excerpts.length.toLocaleString()} snippet${row.excerpts.length === 1 ? "" : "s"}` : "",
      mapEvidence ? `${mapEvidence.sourceCount.toLocaleString()} source link${mapEvidence.sourceCount === 1 ? "" : "s"}` : "",
      intelligenceForIssue(row.issue)?.flags?.includes("likely_sighting") ? "likely sighting signal" : "",
      row.issue.thumbnail_url ? "thumbnail" : "",
    ].filter(Boolean);
    const whyItems = whyMatchedItems(row, sourceLabels);
    const resultMeta = [
      row.issue.collection_title || row.issue.collection_id || "Archive",
      row.issue.series,
      row.issue.language_label ? `${row.issue.language_label} language` : "",
      issueYearText || "",
      pageCount ? `${pageCount.toLocaleString()} pages` : "",
      openPage ? `best page ${openPage}` : "",
    ].filter(Boolean);
    const resultLanguageBadges = languageBadges(row.issue);
    let accessLabel = `<span class="access-badge online-access">Online PDF</span>`;
    if (row.issue.access_mode === "local") {
      accessLabel = `<span class="access-badge local-access">Local PDF</span>`;
    } else if (row.issue.access_mode === "unavailable") {
      accessLabel = `<span class="access-badge unavailable-access">No public PDF yet</span>`;
    }
    const availabilityLabels = {
      rights_pending: ["Rights pending", "rights-pending-access"],
      local_only: ["Local only", "local-only-access"],
      ready_for_upload: ["Ready for upload", "ready-upload-access"],
    };
    const availability = availabilityLabels[row.issue.availability_status];
    if (availability) {
      accessLabel += ` <span class="access-badge ${availability[1]}">${availability[0]}</span>`;
    }
    const preview = documentPreviewMarkup(row.issue, openPdfUrl, pageCount);
    const evidenceTrail = evidenceTrailMarkup(row.issue, mapEvidence, mapUrl);
    const researchButton = researchItemButton(row, openPage, searchUrl, mapEvidence);
    const evidenceAction = openPdfUrl
      ? `<div class="result-actions">
          <a class="evidence-action" href="${escapeHtml(openPdfUrl)}" target="_blank" rel="noopener">
            ${escapeHtml(evidenceLabel)} <span aria-hidden="true">&nearr;</span>
          </a>
          <a class="secondary-action" href="${escapeHtml(searchUrl)}">Open search result</a>
          ${mapEvidence
            ? `<a class="secondary-action map-evidence-action" href="${escapeHtml(mapUrl)}">${mapEvidence.prnCount.toLocaleString()} mapped sighting${mapEvidence.prnCount === 1 ? "" : "s"}</a>`
            : `<a class="secondary-action" href="${escapeHtml(mapUrl)}">Explore related map search</a>`}
          <button class="citation-action" type="button" data-copy-result-citation="${escapeHtml(String(row.issue.document_id || row.issue.id || ""))}">Copy citation</button>
          ${researchButton}
        </div>`
      : `<div class="result-actions"><span class="evidence-action unavailable-action" aria-disabled="true">PDF not publicly available</span><button class="citation-action" type="button" data-copy-result-citation="${escapeHtml(String(row.issue.document_id || row.issue.id || ""))}">Copy citation</button>${researchButton}</div>`;
    return `
    <article id="${escapeHtml(resultDomId(row))}" class="result ${preview ? "has-thumbnail" : "no-thumbnail"}">
      ${preview}
      <div class="result-body">
        <p class="series-name">${escapeHtml(row.issue.collection_title || row.issue.collection_id || "Archive")} / ${escapeHtml(row.issue.series)}</p>
        <h3>${escapeHtml(row.issue.title)}</h3>
        <p class="result-meta">${resultMeta.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</p>
        ${resultLanguageBadges.length ? `<p class="language-badge-line">${resultLanguageBadges.map(item => `<span class="language-badge ${item.className}">${escapeHtml(item.label)}</span>`).join("")}</p>` : ""}
        ${resultStats.length ? `<p class="result-stat-strip">${resultStats.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</p>` : ""}
        ${whyItems.length ? `<p class="why-match">${whyItems.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</p>` : ""}
        <p class="access-line">${accessLabel}</p>
        ${mapEvidence ? `<p class="source-map-summary">${mapEvidence.prnCount.toLocaleString()} mapped sighting${mapEvidence.prnCount === 1 ? "" : "s"} cite this PDF${mapEvidence.label ? ` via ${escapeHtml(mapEvidence.label)}` : ""}.</p>` : ""}
        ${evidenceTrail}
        <p class="match-summary">${escapeHtml(sourceLabels.join(" + "))}${pageSummary ? ` &middot; ${pageSummary}` : ""}</p>
        ${pageClusterMarkup(row)}
        <div data-snippet-slot>${renderResultExcerpts(row)}</div>
        ${evidenceAction}
      </div>
    </article>
  `;
  }).join("");
  const moreMarkup = currentResults.length > visibleCount
    ? `<button id="load-more-results" class="load-more" type="button">Load 25 more results</button>`
    : "";
  resultsElement.innerHTML = `${resultMarkup}${moreMarkup}`;
  window.IsaacKoiResearch?.render();
  updateResultsMapLink();
}

function visibleResearchSetText() {
  const rows = currentResults.slice(0, visibleCount);
  if (!rows.length) return "";
  if (currentResultMode === "cases") {
    const heading = `Isaac Koi mapped case research set (${rows.length.toLocaleString()} visible case${rows.length === 1 ? "" : "s"})`;
    const lines = rows.map((row, index) => [
      `${index + 1}. ${caseField(row, "title") || caseField(row, "id")}`,
      `Record: ${caseField(row, "id")}`,
      `Collection: ${CASE_COLLECTION_LABELS[caseField(row, "collection")] || caseField(row, "collection")}`,
      caseField(row, "date") ? `Date: ${caseField(row, "date")}` : "",
      caseField(row, "location") ? `Location: ${caseField(row, "location")}` : "",
      `Map link: ${caseMapUrl([caseField(row, "id")])}`,
      caseEvidenceUrl(row) ? `Evidence/file link: ${caseEvidenceUrl(row)}` : "",
    ].filter(Boolean).join("\n"));
    return [heading, "", ...lines].join("\n\n");
  }
  const heading = `Isaac Koi Archive research set (${rows.length.toLocaleString()} visible result${rows.length === 1 ? "" : "s"})`;
  const lines = rows.map((row, index) => {
    const mapEvidence = mappedEvidenceSummary(row.issue);
    const page = row.bestPage || "";
    const parts = [
      `${index + 1}. ${row.issue.title}`,
      row.issue.series ? `Series: ${row.issue.series}` : "",
      row.issue.collection_title || row.issue.collection_id ? `Collection: ${row.issue.collection_title || row.issue.collection_id}` : "",
      page ? `Best page: ${page}` : "",
      mapEvidence ? `Mapped cases: ${mapEvidence.prnCount}; source links: ${mapEvidence.sourceCount}` : "",
      `Search link: ${buildShareUrl({autorun: true, issue: row.issue.document_id, page, fulltext: true})}`,
      mapEvidence ? `Map link: ${relatedMapUrl(row)}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  });
  return [heading, "", ...lines].join("\n\n");
}

function visibleResearchRows() {
  if (currentResultMode === "cases") {
    return currentResults.slice(0, visibleCount).map(row => ({
      record_id: caseField(row, "id"),
      title: caseField(row, "title"),
      collection: CASE_COLLECTION_LABELS[caseField(row, "collection")] || caseField(row, "collection"),
      date: caseField(row, "date"),
      year: caseField(row, "year"),
      location: caseField(row, "location"),
      region: caseField(row, "region"),
      country: caseField(row, "country"),
      case_type: caseField(row, "type"),
      classification: caseField(row, "classification"),
      source_count: caseNumberField(row, "source_count"),
      source_labels: caseField(row, "source_labels"),
      map_url: caseMapUrl([caseField(row, "id")]),
      evidence_url: caseEvidenceUrl(row),
      citation: caseCitation(row),
    }));
  }
  return currentResults.slice(0, visibleCount).map(row => {
    const page = row.bestPage || "";
    const searchUrl = buildShareUrl({autorun: true, issue: row.issue.document_id, page, fulltext: true});
    const dossiers = caseDossiersForIssue(row.issue);
    return {
      document_id: row.issue.document_id || "",
      title: row.issue.title || "",
      series: row.issue.series || "",
      collection: row.issue.collection_title || row.issue.collection_id || "",
      year: issueYear(row.issue) || "",
      language: row.issue.language_label || row.issue.language || "",
      access_mode: row.issue.access_mode || "",
      best_page: page,
      search_url: searchUrl,
      map_url: mappedEvidenceSummary(row.issue) ? relatedMapUrl(row) : "",
      dossier_urls: dossiers.map(dossier => searchUiUrl(dossier.stable_url || ("cases/" + dossier.slug + "/"))),
      citation: resultCitation(row, page, searchUrl),
    };
  });
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadResearchFile(format) {
  const rows = visibleResearchRows();
  if (!rows.length) {
    updateStatus("Run a search before exporting results.");
    return;
  }
  let content;
  let mimeType;
  let extension;
  if (format === "csv") {
    const fields = Object.keys(rows[0]);
    content = [fields.map(csvValue).join(","), ...rows.map(row => fields.map(field => csvValue(row[field])).join(","))].join("\r\n") + "\r\n";
    mimeType = "text/csv;charset=utf-8";
    extension = "csv";
  } else {
    content = JSON.stringify({schema_version: 1, exported_results: rows}, null, 2) + "\n";
    mimeType = "application/json";
    extension = "json";
  }
  const blobUrl = URL.createObjectURL(new Blob([content], {type: mimeType}));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `isaac-koi-archive-results.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  updateStatus(`Exported ${rows.length.toLocaleString()} visible result${rows.length === 1 ? "" : "s"} as ${extension.toUpperCase()}.`);
}

function searchDiagnosticsNote(searchStartedAt, metadataSeconds) {
  const totalSeconds = elapsedSeconds(searchStartedAt);
  if (!lastSearchStats) return ` Search completed in ${totalSeconds}s. Metadata scan: ${metadataSeconds}s.`;
  const manifestNote = `${lastSearchStats.manifestCollectionCount.toLocaleString()} manifest collection${lastSearchStats.manifestCollectionCount === 1 ? "" : "s"} checked`;
  const skippedNote = `${lastSearchStats.skippedSeriesCount.toLocaleString()} series skipped`;
  const failedLoadCount = currentSearchWarnings.length || lastSearchStats.failedLoadCount || 0;
  const failureNote = failedLoadCount
    ? `; ${failedLoadCount.toLocaleString()} failed load${failedLoadCount === 1 ? "" : "s"}`
    : "";
  const hybridNote = lastSearchStats.hybridCollectionCount
    ? `; hybrid: ${lastSearchStats.hybridCollectionCount.toLocaleString()} collection${lastSearchStats.hybridCollectionCount === 1 ? "" : "s"}, ${lastSearchStats.hybridShardRequestCount.toLocaleString()} shard request${lastSearchStats.hybridShardRequestCount === 1 ? "" : "s"}`
    : `; per-series index loads up to ${lastSearchStats.concurrency} at a time`;
  const routerNote = lastSearchStats.globalRouterShardRequestCount
    ? `, global router ${lastSearchStats.globalRouterShardRequestCount.toLocaleString()} shard${lastSearchStats.globalRouterShardRequestCount === 1 ? "" : "s"} / ${lastSearchStats.globalRouterSkippedSeriesCount.toLocaleString()} series skipped before collection checks`
    : "";
  const validationNote = lastSearchStats.textValidationShardLimit
    ? `; validation shards: ${lastSearchStats.textValidationShardLoads.toLocaleString()}/${lastSearchStats.textValidationShardLimit.toLocaleString()}`
    : "";
  return ` Search completed in ${totalSeconds}s. Timings: metadata ${metadataSeconds}s, router ${lastSearchStats.timings.routerSeconds}s, manifests ${lastSearchStats.timings.manifestSeconds}s, indexes ${lastSearchStats.timings.indexSeconds}s, shard loading ${lastSearchStats.timings.shardSeconds}s. Full text: ${lastSearchStats.searchedSeriesCount.toLocaleString()} candidate series, ${manifestNote}, ${skippedNote}${routerNote}${hybridNote}${validationNote}${failureNote}.`;
}

async function runSearch() {
  if (!catalogueLoaded) {
    currentResults = [];
    facetUniverse = [];
    visibleCount = pageSize;
    renderResults();
    renderResultFacetStatus();
    if (scopeStatusElement) scopeStatusElement.textContent = "No generated catalogue is loaded.";
    updateStatus(catalogueLoadError || catalogueMissingMessage());
    resultsElement.innerHTML = `<p class="empty-state load-error">${escapeHtml(catalogueLoadError || catalogueMissingMessage())}</p>`;
    return;
  }
  if (currentSearchRequiresMapEvidence() && mapEvidenceLoadState === "loading" && mapEvidenceLoadPromise) {
    updateStatus("Loading mapped archive evidence for this search...");
    await mapEvidenceLoadPromise;
  }
  const criteria = searchCriteria();
  const runId = currentSearchRunId + 1;
  currentSearchRunId = runId;
  const searchStartedAt = nowMillis();
  const metadataStartedAt = nowMillis();
  const terms = positiveTerms(criteria);
  currentCriteria = criteria;
  currentTerms = terms;
  lastSearchStats = null;
  currentSearchWarnings = [];
  if (selectedSearchIntent() === "cases") {
    await runCaseSearch(criteria, searchStartedAt);
    return;
  }
  currentResultMode = "documents";
  caseUniverse = [];
  updateResultModePresentation();
  if (!hasPositiveCriteria(criteria) && !requestedIssue && !requestedMapRecordIds.size) {
    currentResults = [];
    facetUniverse = [];
    visibleCount = pageSize;
    renderResults();
    renderResultFacetStatus();
    updateShareUrl();
    updateScopeStatus();
    updateStatus(criteria.none.length ? "Enter at least one positive search term as well as excluded words." : "Enter at least one search term.");
    return;
  }
  const selected = selectedSeries();
  const selectedCountryIds = selectedCollections();
  const accessModes = selectedAccessModes();
  const languageMode = selectedLanguageMode();
  const scopedIssues = issues.filter(issue =>
    selectedCountryIds.has(issue.collection_id)
    && (!selected.size || selected.has(issue.series_selection_id))
    && accessModes.has(issue.access_mode)
    && languageMatchesMode(issue, languageMode)
    && issueMatchesYearRange(issue, criteria)
    && issueMatchesIntelligenceFilters(issue)
    && (!requestedMapRecordIds.size || mapSourcesForIssue(issue).some(source =>
      requestedMapRecordIds.has(String(source.ufocat_prn || source.record_id || source.geipan_case_id || ""))
    ))
  );
  const issueById = new Map(scopedIssues.map(issue => [`${issue.collection_id}:${issue.id}`, issue]));
  const candidates = new Map();
  if (requestedIssue && accessModes.has(requestedIssue.access_mode)) {
    const pinned = ensureCandidate(candidates, requestedIssue);
    pinned.sources.add("direct-link");
    pinned.pinned = true;
    if (requestedPage) pinned.bestPage = requestedPage;
  }
  if (requestedMapRecordIds.size) {
    for (const issue of scopedIssues) {
      const pinned = ensureCandidate(candidates, issue);
      pinned.sources.add("direct-link");
      pinned.metadataScore = 1000;
    }
  }
  if (hasPositiveCriteria(criteria)) {
    for (const issue of scopedIssues) {
      if (!metadataMatches(issue, criteria)) continue;
      const candidate = ensureCandidate(candidates, issue);
      candidate.sources.add("metadata");
      candidate.metadataScore = issueMetadataScore(issue, terms, criteria.phrase);
    }
  }
  const metadataSeconds = elapsedSeconds(metadataStartedAt);

  let truncated = false;
  if (hasPositiveCriteria(criteria) && fullTextInput.checked) {
    const searchAllIndexed = !selected.size;
    const selectable = allSeries.filter(series =>
      selectedCountryIds.has(series.collection_id)
      && series.indexed_text_pages > 0
      && languageMatchesMode(series, languageMode)
      && (searchAllIndexed || selected.has(series.selection_id))
    );
    if (searchAllIndexed) {
      updateStatus(`Searching all ${selectable.length} indexed series. This may take a moment...`);
    } else {
      updateStatus(`Searching indexes for ${selectable.length} selected series...`);
    }
    const fullTextStats = await searchFullText(selectable, criteria, issueById, selected);
    truncated = fullTextStats.truncated;
    lastSearchStats = fullTextStats;
    for (const match of fullTextStats.matches) {
      addTextHit(ensureCandidate(candidates, match.issue), match.series, match.pageIndex, match.pageNumber, match.issueId);
    }
  }
  facetUniverse = [...candidates.values()]
    .filter(result => selectedSearchIntent() !== "mapped" || Boolean(mappedEvidenceSummary(result.issue)))
    .map(result => ({...result, score: resultScore(result)}));
  currentSearchTruncated = truncated;
  renderResultFacetOptions();
  currentResults = facetUniverse.filter(result => issueMatchesResultFacets(result.issue));
  sortCurrentResults();
  visibleCount = pageSize;
  renderResults();
  renderResultFacetStatus();
  focusResultsIfRequested();
  hydrateVisibleSnippets(terms, runId)
    .then(() => {
      if (runId !== currentSearchRunId) return;
      updateStatus(`${currentResultNote}${searchDiagnosticsNote(searchStartedAt, metadataSeconds)}${warningSummary()}`);
    })
    .catch(error => updateStatus(`${currentResultNote} Snippet hydration warning: ${error.message}`));
  currentResultNote = resultCountNote();
  updateStatus(
    `${currentResultNote}${searchDiagnosticsNote(searchStartedAt, metadataSeconds)}${warningSummary()}`
  );
  updateShareUrl();
  updateScopeStatus();
}

function renderSeries() {
  seriesList.innerHTML = collections.map(collection => {
    const rows = allSeries.filter(series => series.collection_id === collection.id);
    return `
      <section class="series-group">
        <h4>${escapeHtml(collection.title)}</h4>
        ${rows.map(series => {
          const indexed = series.indexed_text_pages > 0;
          const badge = indexed
            ? `<span class="text-badge text-ready">Full text</span>`
            : `<span class="text-badge text-missing">Metadata only</span>`;
          const langBadge = isForeignLanguage(series)
            ? `<span class="text-badge language-mini">${escapeHtml(series.language_label || "Foreign language")}</span>`
            : "";
          return `
            <label class="series-option">
              <input class="series-checkbox" type="checkbox" value="${escapeHtml(series.selection_id)}" data-series-id="${escapeHtml(series.id)}" data-collection-id="${escapeHtml(series.collection_id)}">
              <span>${escapeHtml(series.title)} ${badge}${langBadge}</span>
              <small>${series.issue_count} PDFs${indexed ? ` / ${Number(series.indexed_text_pages).toLocaleString()} searchable pages` : (series.text_shard_available ? " / needs OCR" : "")}</small>
            </label>
          `;
        }).join("")}
      </section>
    `;
  }).join("");
}

function renderCollections() {
  collectionList.innerHTML = collections.map(collection => {
    const metrics = collectionMetrics(collection);
    const coverageState = metrics.searchableSeries
      ? `${metrics.searchableSeries.toLocaleString()} full-text series`
      : "metadata only";
    const badges = languageBadges(collection);
    return `
      <div class="collection-option">
        <label>
          <input class="collection-checkbox" type="checkbox" value="${escapeHtml(collection.id)}" checked>
          <span>${escapeHtml(collection.title)}</span>
        </label>
        <small>${metrics.issueCount.toLocaleString()} PDFs / ${metrics.searchablePages.toLocaleString()} searchable pages / ${escapeHtml(coverageState)}</small>
        ${collection.public_note ? `<p class="collection-public-note compact">${escapeHtml(collection.public_note)}</p>` : ""}
        <span class="collection-coverage-badge ${metrics.searchableSeries ? "fulltext-coverage" : "metadata-coverage"}">${escapeHtml(coverageState)}</span>
        ${badges.map(item => `<span class="collection-coverage-badge language-coverage ${item.className}">${escapeHtml(item.label)}</span>`).join("")}
        <div class="collection-actions">
          <button type="button" data-collection-search="${escapeHtml(collection.id)}">Search this collection</button>
          <button type="button" data-collection-fulltext="${escapeHtml(collection.id)}">Full-text series</button>
        </div>
      </div>
    `;
  }).join("");
}

async function start() {
  await initializeSearchDataRelease();
  const registry = await readJson("collections.json");
  if (!Array.isArray(registry) || !registry.length) {
    throw new Error("collections.json is missing or empty.");
  }
  await loadOptionalGlobalTermRouter(registry);
  const catalogueRows = await loadCatalogueRows(registry);
  const loaded = catalogueRows.map(({entry, collectionResponse, issuesResponse}) => {
    const collection = withLanguageFallback(collectionResponse);
    const collectionIssues = issuesResponse;
    if (!collection || !Array.isArray(collection.series)) {
      throw new Error(`${entry.path}/collection.json has no series list.`);
    }
    if (!Array.isArray(collectionIssues)) {
      throw new Error(`${entry.path}/issues.json is not an issue list.`);
    }
    collection.path = entry.path;
    collection.indexed_at_utc = collection.indexed_at_utc || entry.indexed_at_utc || "";
    collection.series = collection.series.map(series => withLanguageFallback({
      ...series,
      collection_id: collection.id,
      collection_title: collection.title,
      collection_path: entry.path,
      term_manifest: collection.term_manifest || "",
      hybrid_index: collection.hybrid_index || null,
      selection_id: `${collection.id}::${series.id}`,
    }, collection));
    collectionIssues.forEach(issue => {
      issue.collection_id = collection.id;
      issue.collection_title = collection.title;
      issue.series_selection_id = `${collection.id}::${issue.series_slug}`;
      Object.assign(issue, withLanguageFallback(issue, collection));
    });
    return {collection, issues: collectionIssues};
  });
  collections = loaded.map(item => item.collection);
  allSeries = collections.flatMap(collection => collection.series);
  issues = loaded.flatMap(item => item.issues);
  await Promise.all([loadOptionalLocalLinks(), loadOptionalCollectionLandingSummary(), loadOptionalCaseDossiers(), loadPageIntelligence(collections)]);
  for (const issue of issues) {
    const intelligence = pageIntelligenceByIssue.get(issueIntelligenceKey(issue));
    if (intelligence) issue.page_intelligence = intelligence;
  }
  applyLocalLinksToIssues(issues);
  catalogueLoaded = true;
  catalogueLoadError = "";
  renderCollections();
  renderSeries();
  renderArchiveStats();
  renderFeaturedCollections();
  renderCoverageDashboard();
  renderNewlySearchable();
  renderCollectionSpotlight();
  renderSourceRichBrowser();
  renderBrowsePreview();
  const mapEvidencePromise = startMapEvidenceEnrichment();
  const options = deepLinkOptions();
  applyDeepLinkOptions(options);
  updateScopeStatus();
  const localCount = issues.filter(issue => issue.access_mode === "local").length;
  const unavailableCount = issues.filter(issue => issue.access_mode === "unavailable").length;
  const localNote = localCount ? ` ${localCount.toLocaleString()} PDFs will open from local files.` : "";
  const unavailableNote = unavailableCount ? ` ${unavailableCount.toLocaleString()} records have no public PDF link yet.` : "";
  const startupNote = catalogueLoadMode === "compact-bundle" ? " Compact catalogue loaded in one request." : "";
  const releaseNote = activeDataRelease ? ` Data release ${activeDataRelease}.` : "";
  const registryGapNote = unavailableCatalogueEntries.length
    ? ` ${unavailableCatalogueEntries.length.toLocaleString()} advertised collection${unavailableCatalogueEntries.length === 1 ? " is" : "s are"} not yet deployed and ${unavailableCatalogueEntries.length === 1 ? "was" : "were"} skipped.`
    : "";
  updateStatus(`${issues.length.toLocaleString()} online PDF records across ${collections.length.toLocaleString()} collection${collections.length === 1 ? "" : "s"} and ${allSeries.length.toLocaleString()} series.${startupNote}${releaseNote}${registryGapNote}${localNote}${unavailableNote}`);
  if (options.autorun && (
    options.query
    || options.all
    || options.phrase
    || options.any
    || (options.intent === "cases" && (options.yearMin || options.yearMax))
    || requestedIssue
    || requestedMapRecordIds.size
  )) {
    requestResultFocus();
    if (currentSearchRequiresMapEvidence()) await mapEvidencePromise;
    await runSearch();
  }
}

document.getElementById("search-button").addEventListener("click", () => {
  requestResultFocus();
  runSearch().catch(error => updateStatus(error.message));
});
document.querySelectorAll('input[name="search-mode"]').forEach(input => {
  input.addEventListener("change", () => {
    const advanced = activeSearchMode() === "advanced";
    document.getElementById("basic-search").hidden = advanced;
    document.getElementById("advanced-search").hidden = !advanced;
    if (advanced && !allWordsInput.value && queryInput.value) allWordsInput.value = queryInput.value;
    (advanced ? allWordsInput : queryInput).focus();
  });
});
[queryInput, allWordsInput, exactPhraseInput, anyWordsInput, noneWordsInput].forEach(input => {
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      requestResultFocus();
      runSearch().catch(error => updateStatus(error.message));
    }
  });
});
resultsElement.addEventListener("click", async event => {
  const caseCitationButton = event.target?.closest("[data-copy-case-citation]");
  if (caseCitationButton) {
    const recordId = caseCitationButton.dataset.copyCaseCitation || "";
    const row = currentResults.find(result => caseField(result, "id") === recordId);
    if (!row) return;
    try {
      await writeClipboardText(caseCitation(row));
      caseCitationButton.textContent = "Citation copied";
      updateStatus("Copied the stable mapped-case citation.");
      window.setTimeout(() => { caseCitationButton.textContent = "Copy citation"; }, 1600);
    } catch (error) {
      updateStatus("Could not access the clipboard for this citation.");
    }
    return;
  }
  const previewMapButton = event.target?.closest("[data-preview-case-map]");
  if (previewMapButton) {
    const recordId = previewMapButton.dataset.previewCaseMap || "";
    openResultsMapPreview(caseMapUrl([recordId]), 1);
    resultsMapPanel?.scrollIntoView({behavior: "smooth", block: "start"});
    return;
  }
  const citationButton = event.target?.closest("[data-copy-result-citation]");
  if (citationButton) {
    const key = citationButton.dataset.copyResultCitation || "";
    const row = currentResults.find(result => String(result.issue.document_id || result.issue.id || "") === key);
    if (!row) return;
    const page = row.bestPage || "";
    const searchUrl = buildShareUrl({autorun: true, issue: row.issue.document_id, page, fulltext: true});
    try {
      await writeClipboardText(resultCitation(row, page, searchUrl));
      citationButton.textContent = "Citation copied";
      updateStatus("Copied the stable archive-result citation.");
      window.setTimeout(() => { citationButton.textContent = "Copy citation"; }, 1600);
    } catch (error) {
      updateStatus("Could not access the clipboard for this citation.");
    }
    return;
  }
  if (event.target.id !== "load-more-results") return;
  visibleCount += pageSize;
  const terms = currentTerms;
  const runId = currentSearchRunId;
  if (currentResultMode === "cases") {
    if (caseSearchEngine === "worker") {
      try {
        await refreshWorkerCaseResults({updateUrl: false, announce: false});
      } catch (error) {
        updateStatus(`Could not load more mapped cases: ${error.message}`);
        return;
      }
    } else {
      renderResults();
    }
    const shown = Math.min(visibleCount, currentResults.length);
    updateStatus(`${currentResultNote} Showing ${shown.toLocaleString()} now.`);
    return;
  }
  renderResults();
  hydrateVisibleSnippets(terms, runId)
    .then(() => {
      if (runId !== currentSearchRunId) return;
      const shown = Math.min(visibleCount, currentResults.length);
      updateStatus(`${currentResultNote} Showing ${shown.toLocaleString()} now.${warningSummary()}`);
    })
    .catch(error => updateStatus(error.message));
});
document.getElementById("clear-series").addEventListener("click", () => {
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
  updateScopeStatus();
});
document.getElementById("select-indexed").addEventListener("click", () => {
  const indexed = new Set(allSeries.filter(series => series.indexed_text_pages > 0).map(series => series.selection_id));
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = indexed.has(input.value); });
  updateScopeStatus();
});
document.querySelectorAll("[data-featured-search]").forEach(button => {
  button.addEventListener("click", () => {
    requestResultFocus();
    applyFeaturedSearch(button.dataset.featuredSearch);
  });
});
featuredCollectionsElement?.addEventListener("click", event => {
  const button = event.target?.closest("[data-featured-collection]");
  const collectionId = button?.dataset.featuredCollection || "";
  if (!collectionId) return;
  document.querySelectorAll(".collection-checkbox").forEach(input => { input.checked = input.value === collectionId; });
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
  rerunIfUseful();
  renderBrowsePreview();
  document.querySelector(".search-panel")?.scrollIntoView({behavior: "smooth", block: "start"});
});
document.querySelectorAll("[data-quick-filter]").forEach(button => {
  button.addEventListener("click", () => {
    const filter = button.dataset.quickFilter;
    if (filter === "magazines") {
      setCollectionsByPrefix("magazines");
    } else if (filter === "documents") {
      setCollectionsByPrefix("documents");
    } else if (filter === "geipan") {
      if (!setCollectionById("documents/france-geipan")) {
        document.querySelector('input[name="search-mode"][value="basic"]').checked = true;
        document.getElementById("basic-search").hidden = false;
        document.getElementById("advanced-search").hidden = true;
        queryInput.value = "GEIPAN";
        resetQuickScope();
      }
    } else if (filter === "french") {
      if (languageFilterInput) languageFilterInput.value = "fr";
      setCollectionsByPredicate(isFrenchLanguage);
    } else if (filter === "foreign-language") {
      if (languageFilterInput) languageFilterInput.value = "all";
      setCollectionsByPredicate(isForeignLanguage);
    } else if (filter === "fulltext") {
      setFullTextOnly(true);
    } else if (filter === "sightings") {
      if (searchIntentInput) searchIntentInput.value = "cases";
      document.querySelectorAll(".collection-checkbox").forEach(input => { input.checked = true; });
      document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
      document.querySelectorAll(".intelligence-filter").forEach(input => {
        input.checked = input.value === "likely_sighting";
      });
      rerunIfUseful();
      renderBrowsePreview();
    } else if (filter === "mapped") {
      if (searchIntentInput) searchIntentInput.value = "mapped";
      document.querySelectorAll(".collection-checkbox").forEach(input => { input.checked = true; });
      document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = false; });
      rerunIfUseful();
      renderBrowsePreview();
    } else {
      if (searchIntentInput) searchIntentInput.value = "general";
      resetQuickScope();
    }
  });
});
collectionList.addEventListener("change", event => {
  if (event.target?.matches(".collection-checkbox")) updateScopeStatus();
  if (event.target?.matches(".collection-checkbox")) renderBrowsePreview();
});
languageFilterInput?.addEventListener("change", () => {
  rerunIfUseful();
  renderBrowsePreview();
});
searchIntentInput?.addEventListener("change", () => {
  updateResultModePresentation();
  updateScopeStatus();
  rerunIfUseful();
});
resultSortInput?.addEventListener("change", () => {
  if (currentResultMode === "cases") {
    applyCaseFilters().catch(error => updateStatus(`Could not sort mapped cases: ${error.message}`));
    return;
  }
  sortCurrentResults();
  visibleCount = pageSize;
  renderResults();
  updateShareUrl();
  if (currentResultMode !== "cases") {
    hydrateVisibleSnippets(currentTerms, currentSearchRunId).catch(error => updateStatus(error.message));
  }
});
[caseCollectionFilter, caseCountryFilter, caseEvidenceFilter].forEach(input => {
  input?.addEventListener("change", () => {
    if (currentResultMode === "cases" && (caseSearchSummary.totalMatches || caseUniverse.length)) {
      applyCaseFilters().catch(error => updateStatus(`Could not filter mapped cases: ${error.message}`));
    }
  });
});
clearCaseFiltersButton?.addEventListener("click", () => {
  if (caseCollectionFilter) caseCollectionFilter.value = "";
  if (caseCountryFilter) caseCountryFilter.value = "";
  if (caseEvidenceFilter) caseEvidenceFilter.checked = false;
  if (currentResultMode === "cases") {
    applyCaseFilters().catch(error => updateStatus(`Could not clear mapped-case filters: ${error.message}`));
  }
});
toggleResultsMapButton?.addEventListener("click", () => openResultsMapPreview());
closeResultsMapButton?.addEventListener("click", closeResultsMapPreview);
[facetDecadeInput, facetEvidenceInput, facetSourceInput, facetPageLinkInput].forEach(input => {
  input?.addEventListener("change", () => applyResultFacets());
});
clearResultFacetsButton?.addEventListener("click", () => {
  [facetDecadeInput, facetEvidenceInput, facetSourceInput, facetPageLinkInput].forEach(input => {
    if (input) input.value = "";
  });
  pendingResultFacets = {decade: "", evidence: "", source: "", pageLink: ""};
  applyResultFacets();
});
document.querySelectorAll(".intelligence-filter").forEach(input => {
  input.addEventListener("change", () => {
    rerunIfUseful();
    renderBrowsePreview();
  });
});
collectionList.addEventListener("click", event => {
  const searchButton = event.target?.closest("[data-collection-search]");
  const fullTextButton = event.target?.closest("[data-collection-fulltext]");
  const collectionId = searchButton?.dataset.collectionSearch || fullTextButton?.dataset.collectionFulltext || "";
  if (!collectionId) return;
  const seriesRows = allSeries.filter(series => series.collection_id === collectionId);
  const indexed = new Set(seriesRows.filter(series => Number(series.indexed_text_pages || 0) > 0).map(series => series.selection_id));
  document.querySelectorAll(".collection-checkbox").forEach(input => { input.checked = input.value === collectionId; });
  document.querySelectorAll(".series-checkbox").forEach(input => {
    input.checked = fullTextButton ? indexed.has(input.value) : false;
  });
  rerunIfUseful();
  renderBrowsePreview();
});
seriesList.addEventListener("click", event => {
  const button = event.target?.closest("[data-browse-series]");
  if (!button) return;
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = input.value === button.dataset.browseSeries; });
  rerunIfUseful();
});
browsePreviewElement?.addEventListener("click", event => {
  const button = event.target?.closest("[data-browse-series]");
  if (!button) return;
  document.querySelectorAll(".series-checkbox").forEach(input => { input.checked = input.value === button.dataset.browseSeries; });
  rerunIfUseful();
});
seriesList.addEventListener("change", event => {
  if (event.target?.matches(".series-checkbox")) updateScopeStatus();
});
document.querySelectorAll(".access-filter").forEach(input => {
  input.addEventListener("change", () => {
    updateShareUrl();
    if (hasPositiveCriteria(searchCriteria()) || requestedIssue) {
      runSearch().catch(error => updateStatus(error.message));
    }
  });
});
copyLinkButton.addEventListener("click", async () => {
  const url = buildShareUrl({autorun: true});
  try {
    await navigator.clipboard.writeText(url);
    copyLinkButton.textContent = "Copied";
    updateStatus("Copied a shareable search link.");
    window.setTimeout(() => { copyLinkButton.textContent = "Copy link"; }, 1600);
  } catch (error) {
    updateShareUrl();
    updateStatus("Could not access the clipboard. The shareable search link is now in the address bar.");
  }
});
copyVisibleResultsButton?.addEventListener("click", async () => {
  const text = visibleResearchSetText();
  if (!text) {
    updateStatus("Run a search before copying a research set.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    copyVisibleResultsButton.textContent = "Copied";
    updateStatus("Copied the visible results as a research set.");
    window.setTimeout(() => { copyVisibleResultsButton.textContent = "Copy research set"; }, 1600);
  } catch (error) {
    updateStatus("Could not access the clipboard for the research set.");
  }
});
downloadResultsCsvButton?.addEventListener("click", () => downloadResearchFile("csv"));
downloadResultsJsonButton?.addEventListener("click", () => downloadResearchFile("json"));
document.querySelector("[data-theme-toggle]").addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { window.localStorage.setItem("phoenix-color-mode", next); } catch (error) {}
});

start().catch(showCatalogueLoadFailure);
