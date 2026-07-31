const urlParams = new URLSearchParams(window.location.search);
const localMode = urlParams.get("local") === "true";
const embedMode = ["1", "true"].includes((urlParams.get("embed") || "").toLocaleLowerCase());
const requestedDataset = (urlParams.get("dataset") || "ufo-public").trim().toLocaleLowerCase();
const requestedGeographyType = (urlParams.get("geography_type") || "").trim().toLocaleLowerCase();
const requestedGeographyId = (urlParams.get("geography_id") || "").trim();
const requestedFocusGeographyType = (urlParams.get("focus_geography_type") || "").trim().toLocaleLowerCase();
const requestedFocusGeographyId = (urlParams.get("focus_geography_id") || "").trim();
const requestedVisitorFocus = (urlParams.get("focus") || "").trim().toLocaleLowerCase() === "visitor";
const AFU_PUBLIC_MAP_DATA_BASE = "https://files.afu.se/Downloads/mapview/";
document.documentElement.dataset.embedMode = embedMode ? "true" : "false";
document.documentElement.dataset.dataset = requestedDataset;

function isLocalMapPreview() {
  return window.location.protocol === "file:"
    || ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname.toLocaleLowerCase());
}

function configuredMapDataBase() {
  const publicDataPreview = urlParams.get("publicData") === "1";
  if (isLocalMapPreview() && !publicDataPreview) return new URL("./", window.location.href);
  const configured = document.querySelector('meta[name="afu-map-data-base"]')?.content.trim();
  return new URL(configured || AFU_PUBLIC_MAP_DATA_BASE, window.location.href);
}

const MAP_DATA_ROOT_URL = configuredMapDataBase();
let MAP_DATA_BASE_URL = MAP_DATA_ROOT_URL;
let activeMapDataRelease = "";
const MAP_RUNTIME_CACHE_PREFIX = "isaac-koi-map-data-v1-";
const MAP_RUNTIME_CACHE_MAX_ENTRIES = 24;
let mapRuntimeCacheName = "";
document.documentElement.dataset.archiveDataOrigin = MAP_DATA_ROOT_URL.origin;

function configuredInterfaceBase(metaName, fallback) {
  const configured = document.querySelector(`meta[name="${metaName}"]`)?.content.trim();
  return new URL(configured || fallback, window.location.href);
}

const MAP_UI_BASE_URL = configuredInterfaceBase("afu-map-ui-base", "./");
const SEARCH_UI_BASE_URL = configuredInterfaceBase("afu-search-ui-base", "../search/");
document.documentElement.dataset.archiveUiOrigin = MAP_UI_BASE_URL.origin;

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

function validatedHandoffUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const candidate = new URL(value, baseUrl);
    const base = new URL(baseUrl);
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    if (candidate.origin !== base.origin) return "";
    if (candidate.pathname !== base.pathname && !candidate.pathname.startsWith(basePath)) return "";
    return candidate.href;
  } catch (error) {
    return "";
  }
}

function canonicalMapReturnUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("from");
  url.searchParams.delete("return_search");
  return url.href;
}

function withMapHandoff(value) {
  const url = new URL(value, SEARCH_UI_BASE_URL);
  url.searchParams.set("from", "map");
  url.searchParams.set("return_map", canonicalMapReturnUrl());
  return url.href;
}

function mapDataUrl(value) {
  return new URL(value, MAP_DATA_BASE_URL).href;
}

function runtimeMapCacheReleaseKey() {
  return String(activeMapDataRelease || "").toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80);
}

function isPersistentlyCacheableMapUrl(value) {
  if (!mapRuntimeCacheName || !activeMapDataRelease || !("caches" in window)) return false;
  const url = new URL(value);
  if (url.origin !== MAP_DATA_BASE_URL.origin || !url.href.startsWith(MAP_DATA_BASE_URL.href)) return false;
  return /\.(?:geo)?json\.gz$/i.test(url.pathname);
}

async function trimMapRuntimeCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAP_RUNTIME_CACHE_MAX_ENTRIES;
  if (overflow > 0) {
    await Promise.all(keys.slice(0, overflow).map(request => cache.delete(request)));
  }
  document.documentElement.dataset.mapPersistentCacheEntries = String(
    Math.min(keys.length, MAP_RUNTIME_CACHE_MAX_ENTRIES)
  );
}

async function activateMapRuntimeCache() {
  if (!activeMapDataRelease || !("caches" in window)) return;
  mapRuntimeCacheName = `${MAP_RUNTIME_CACHE_PREFIX}${runtimeMapCacheReleaseKey()}`;
  document.documentElement.dataset.mapPersistentCache = "enabled";
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(MAP_RUNTIME_CACHE_PREFIX) && name !== mapRuntimeCacheName)
        .map(name => caches.delete(name))
    );
    const cache = await caches.open(mapRuntimeCacheName);
    document.documentElement.dataset.mapPersistentCacheEntries = String((await cache.keys()).length);
  } catch (error) {
    document.documentElement.dataset.mapPersistentCache = "unavailable";
    console.warn("Persistent map cache cleanup was unavailable.", error);
  }
}

async function fetchMapResponse(resolvedUrl) {
  const request = new Request(resolvedUrl, {mode: "cors", credentials: "omit"});
  if (!isPersistentlyCacheableMapUrl(resolvedUrl)) return fetch(request);
  let cache;
  try {
    cache = await caches.open(mapRuntimeCacheName);
    const cached = await cache.match(request);
    if (cached) {
      document.documentElement.dataset.mapPersistentCache = "hit";
      return cached;
    }
  } catch (error) {
    document.documentElement.dataset.mapPersistentCache = "unavailable";
    console.warn("Persistent map cache read was unavailable.", error);
    return fetch(request);
  }
  const response = await fetch(request);
  if (response.ok) {
    void cache.put(request, response.clone())
      .then(() => trimMapRuntimeCache(cache))
      .catch(error => {
        document.documentElement.dataset.mapPersistentCache = "unavailable";
        console.warn("Persistent map cache write was unavailable.", error);
      });
  }
  return response;
}

function validatedMapReleaseDataUrl(pointer, rootUrl) {
  if (pointer?.schema_version !== 1 || pointer?.package_kind !== "map" || !pointer?.release_id) return null;
  const dataPath = String(pointer.data_path || "");
  if (!dataPath || dataPath.startsWith("/") || dataPath.includes("..") || !dataPath.endsWith("/")) return null;
  const resolved = new URL(dataPath, rootUrl);
  if (resolved.origin !== rootUrl.origin || !resolved.href.startsWith(rootUrl.href)) return null;
  return resolved;
}

async function initializeMapDataRelease() {
  const publicDataPreview = urlParams.get("publicData") === "1";
  const releaseDataPreview = urlParams.get("releaseData") === "1";
  if (isLocalMapPreview() && !publicDataPreview && !releaseDataPreview) return;
  try {
    const pointerUrl = new URL("release.json", MAP_DATA_ROOT_URL);
    const response = await fetch(pointerUrl, {mode: "cors", credentials: "omit", cache: "no-cache"});
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Release pointer returned HTTP ${response.status}`);
    const pointer = await response.json();
    const releaseUrl = validatedMapReleaseDataUrl(pointer, MAP_DATA_ROOT_URL);
    if (!releaseUrl) throw new Error("Release pointer is malformed or unsafe.");
    MAP_DATA_BASE_URL = releaseUrl;
    activeMapDataRelease = String(pointer.release_id);
    document.documentElement.dataset.archiveDataRelease = activeMapDataRelease;
    await activateMapRuntimeCache();
  } catch (error) {
    console.warn("Versioned map release unavailable; using the compatible data root.", error);
  }
}

const deepLinkedRecordIds = new Set(
  urlParams.getAll("prn")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
);
const deepLinkedSourceDoc = urlParams.get("source_doc") || "";
const deepLinkedSourceCode = urlParams.get("source_code") || "";
const ARCHIVE_SEARCH_URL = urlParams.get("searchUrl")
  ? new URL(urlParams.get("searchUrl"), window.location.href).href
  : SEARCH_UI_BASE_URL.href;
const DATA_URL = "data/fold3_all_geocoded.geojson";
const APRO_DATA_URL = "data/ufocat_apro.geojson?v=20260623-quarantine-page-sweep";
const PUBLIC_UFOCAT_SOURCES_URL = "data/ufocat_sources_public.json?v=20260623-quarantine-page-sweep";
const LOCAL_UFOCAT_SOURCES_URL = "data/ufocat_sources_local.json?v=20260623-quarantine-page-sweep";
const SOURCE_LINK_EXPORT_SUMMARY_URL = "data/source-link-export/summary.json?v=20260704";
const SOURCE_LINK_EXPORT_CSV_URL = "data/source-link-export/source-links.csv?v=20260704";
const SOURCE_LINK_EXPORT_JSON_URL = "data/source-link-export/source-links.json?v=20260704";
const SOURCE_FIRST_PUBLIC_DATA_URL = "data/source_first_events_public.geojson?v=20260623-source-first-public-3";
const SOURCE_FIRST_PUBLIC_SOURCES_URL = "data/source_first_sources_public.json?v=20260623-source-first-public-3";
const SOURCE_FIRST_LOCAL_DATA_URL = "data/source_first_events_local.geojson?v=20260623-source-first-local";
const SOURCE_FIRST_LOCAL_SOURCES_URL = "data/source_first_sources_local.json?v=20260623-source-first-local";
const GEIPAN_DATA_URL = "data/geipan_cases_public.geojson?v=20260628-geipan";
const GEIPAN_SOURCES_URL = "data/geipan_sources_public.json?v=20260628-geipan";
const LAC_UFO_DATA_URL = "data/lac_ufo_cases_public.geojson?v=20260706-lac-ufo-1";
const LAC_UFO_SOURCES_URL = "data/lac_ufo_sources_public.json?v=20260706-lac-ufo-1";
const INCIDENT_CLUSTERS_URL = "data/incident_clusters_public.json?v=20260709-incident-clusters-1";
const CASE_DOSSIERS_URL = "data/case_dossiers_public.json?v=20260715-guided-trails-2";
const COMPRESSED_MAP_DATA_FILES = new Set([
  "data/fold3_all_geocoded.geojson",
  "data/ufocat_apro.geojson",
  "data/ufocat_sources_public.json",
  "data/source_first_events_public.geojson",
  "data/source_first_sources_public.json",
  "data/geipan_cases_public.geojson",
  "data/geipan_sources_public.json",
  "data/lac_ufo_cases_public.geojson",
  "data/lac_ufo_sources_public.json",
  "data/incident_clusters_public.json",
  "data/source-link-export/summary.json",
]);

const decadeColors = {
  "1940s": "#8c3f2a",
  "1950s": "#156c75",
  "1960s": "#3d6b2f",
  xxxx: "#6b5c7a",
};

const statePalette = [
  "#1f77b4",
  "#d95f02",
  "#2ca02c",
  "#9467bd",
  "#8c564b",
  "#17becf",
  "#bcbd22",
  "#e377c2",
  "#7f7f7f",
  "#c44e52",
];

const visibleCount = document.getElementById("visibleCount");
const totalCount = document.getElementById("totalCount");
const evidenceCount = document.getElementById("evidenceCount");
const yearTimeline = document.getElementById("yearTimeline");
const monthTimeline = document.getElementById("monthTimeline");
const collectionTimeline = document.getElementById("collectionTimeline");
const timelinePlay = document.getElementById("timelinePlay");
const timelineClear = document.getElementById("timelineClear");
const timelineStatus = document.getElementById("timelineStatus");
const timelineDisclosure = document.querySelector(".timeline-disclosure");
const statsDisclosure = document.querySelector(".stats-disclosure");
const mobileSurfaceMenu = document.querySelector(".mobile-surface-menu");
const desktopSurfaceMenu = document.querySelector(".desktop-surface-menu");
const desktopTimelineToggle = document.getElementById("desktopTimelineToggle");
const desktopCoverageToggle = document.getElementById("desktopCoverageToggle");
const mobileTimelineToggle = document.getElementById("mobileTimelineToggle");
const mobileMappingDataToggle = document.getElementById("mobileMappingDataToggle");
const searchInput = document.getElementById("searchInput");
const trailStatus = document.getElementById("trailStatus");
const trailStatusLabel = document.getElementById("trailStatusLabel");
const trailArchiveLink = document.getElementById("trailArchiveLink");
const copyTrailLink = document.getElementById("copyTrailLink");
const archiveTree = document.getElementById("archiveTree");
const stateFilter = document.getElementById("stateFilter");
const countryFilter = document.getElementById("countryFilter");
const decadeFilter = document.getElementById("decadeFilter");
const yearFilter = document.getElementById("yearFilter");
const monthFilter = document.getElementById("monthFilter");
const recordExtentFilter = document.getElementById("recordExtentFilter");
const coordinateTierFilter = document.getElementById("coordinateTierFilter");
const sourceAccessFilter = document.getElementById("sourceAccessFilter");
const colorByDecade = document.getElementById("colorByDecade");
const colorByState = document.getElementById("colorByState");
const colorUniform = document.getElementById("colorUniform");
const filterToggle = document.getElementById("filterToggle");
const activeFilterCount = document.getElementById("activeFilterCount");
const advancedFilters = document.getElementById("advancedFilters");
const resetButton = document.getElementById("resetButton");
const controlBar = document.querySelector(".control-bar");
const popup = document.getElementById("popup");
const popupContent = document.getElementById("popupContent");
const popupClose = document.getElementById("popupClose");
const mapPanel = document.querySelector(".map-panel");
const sourceRichList = document.getElementById("sourceRichList");
const mappingDataPanel = document.getElementById("mappingDataPanel");
const sourceRichPanel = document.getElementById("sourceRichPanel");
const mappingDataAside = document.getElementById("mappingDataAside");
const sourceRichPanelToggle = document.getElementById("sourceRichPanelToggle");
const mappingDataPanelToggle = document.getElementById("mappingDataPanelToggle");
const desktopMappingDataToggle = document.getElementById("desktopMappingDataToggle");
const sourceRichPanelClose = document.getElementById("sourceRichPanelClose");
const mappingDataPanelClose = document.getElementById("mappingDataPanelClose");
const evidencePanel = document.getElementById("evidencePanel");
const evidencePanelTitle = document.getElementById("evidencePanelTitle");
const evidencePanelMeta = document.getElementById("evidencePanelMeta");
const evidenceFrame = document.getElementById("evidenceFrame");
const evidenceExternalLink = document.getElementById("evidenceExternalLink");
const evidencePanelClose = document.getElementById("evidencePanelClose");
const fold3LayerToggle = document.getElementById("fold3LayerToggle");
const aproLayerToggle = document.getElementById("aproLayerToggle");
const geipanLayerToggle = document.getElementById("geipanLayerToggle");
const lacUfoLayerToggle = document.getElementById("lacUfoLayerToggle");
const evidenceOnlyToggle = document.getElementById("evidenceOnlyToggle");
const sourceRichToggle = document.getElementById("sourceRichToggle");
const themeToggle = document.querySelector("[data-theme-toggle]");
const localModeBadge = document.getElementById("localModeBadge");
const searchMapArea = document.getElementById("searchMapArea");
const searchMapAreaStatus = document.getElementById("searchMapAreaStatus");
const mapHandoff = document.getElementById("mapHandoff");
const mapHandoffText = document.getElementById("mapHandoffText");
const returnToSearch = document.getElementById("returnToSearch");
const dismissMapHandoff = document.getElementById("dismissMapHandoff");
const mapState = document.getElementById("mapState");
const mapStateTitle = document.getElementById("mapStateTitle");
const mapStateDetail = document.getElementById("mapStateDetail");
const mapStateAction = document.getElementById("mapStateAction");
const embedContext = document.querySelector(".embed-context");
const embedContextTitle = document.getElementById("embedContextTitle");

if (embedContext) embedContext.hidden = !embedMode;

const US_STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming", DC: "District of Columbia",
};

// Match reviewed legacy dataset labels before falling back to modern region names.
// This keeps a Phoenix-facing ISO code stable even when the source catalogue uses
// an older display label.
const COUNTRY_FILTER_NAMES = {
  GB: "Great Britain",
};

function normalizedOptionValue(value) {
  return String(value || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchingSelectValue(select, candidates) {
  const normalizedCandidates = new Set(candidates.map(normalizedOptionValue).filter(Boolean));
  if (!normalizedCandidates.size) return "";
  return [...select.options]
    .map(option => option.value)
    .find(value => normalizedCandidates.has(normalizedOptionValue(value))) || "";
}

function countryNameForCode(value) {
  const code = String(value || "").trim().toLocaleUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  try {
    const label = new Intl.DisplayNames(["en"], {type: "region"}).of(code);
    if (label && label !== code) return label;
  } catch (error) {
    // The small fallback below covers the current Phoenix pilot sites.
  }
  return {GB: "United Kingdom", US: "United States"}[code] || "";
}

function countryFilterCandidates(value) {
  const code = String(value || "").trim().toLocaleUpperCase();
  return [
    value,
    COUNTRY_FILTER_NAMES[code],
    countryNameForCode(code),
    code === "US" ? "United States of America" : "",
  ];
}

function requestedGeography() {
  if (urlParams.get("country_code")) {
    return {type: "country", id: urlParams.get("country_code").trim()};
  }
  if (urlParams.get("state_code")) {
    return {type: "state", id: urlParams.get("state_code").trim()};
  }
  if (requestedGeographyType && requestedGeographyId) {
    return {type: requestedGeographyType, id: requestedGeographyId};
  }
  return {type: "", id: ""};
}

function requestedFocusGeography() {
  if (urlParams.get("focus_country_code")) {
    return {type: "country", id: urlParams.get("focus_country_code").trim()};
  }
  if (urlParams.get("focus_state_code")) {
    return {type: "state", id: urlParams.get("focus_state_code").trim()};
  }
  if (requestedFocusGeographyType && requestedFocusGeographyId) {
    return {type: requestedFocusGeographyType, id: requestedFocusGeographyId};
  }
  return {type: "", id: ""};
}

function geographyDisplayLabel(scope) {
  if (scope.type === "country") {
    return countryNameForCode(scope.id) || scope.id;
  }
  if (scope.type === "state") {
    return US_STATE_NAMES[scope.id.toLocaleUpperCase()] || scope.id;
  }
  return "";
}

function updateEmbedContextTitle() {
  if (!embedContextTitle) return;
  const scope = requestedGeography();
  const label = scope.type === "country"
    ? countryFilter.value || countryNameForCode(scope.id) || scope.id
    : scope.type === "state"
      ? stateFilter.value || US_STATE_NAMES[scope.id.toLocaleUpperCase()] || scope.id
      : "";
  const focusLabel = geographyDisplayLabel(requestedFocusGeography());
  embedContextTitle.textContent = label
    ? `Mapped records · ${label}`
    : focusLabel
      ? `Mapped records · Focused on ${focusLabel}`
      : "Explore mapped records";
}

function applyInitialGeographyFilters() {
  const legacyState = urlParams.get("state") || "";
  const legacyCountry = urlParams.get("country") || "";
  if (legacyState && [...stateFilter.options].some(option => option.value === legacyState)) {
    stateFilter.value = legacyState;
  }
  if (legacyCountry && [...countryFilter.options].some(option => option.value === legacyCountry)) {
    countryFilter.value = legacyCountry;
  }
  const scope = requestedGeography();
  if (scope.type === "country") {
    stateFilter.value = "";
    countryFilter.value = matchingSelectValue(countryFilter, countryFilterCandidates(scope.id));
  } else if (scope.type === "state") {
    const stateCode = scope.id.toLocaleUpperCase();
    countryFilter.value = "";
    stateFilter.value = matchingSelectValue(stateFilter, [scope.id, US_STATE_NAMES[stateCode]]);
  }
  updateEmbedContextTitle();
}

let initialScopeFocusApplied = false;

function optionValueForGeography(scope) {
  if (scope.type === "country") {
    return matchingSelectValue(countryFilter, countryFilterCandidates(scope.id));
  }
  if (scope.type === "state") {
    return matchingSelectValue(stateFilter, [
      scope.id,
      US_STATE_NAMES[scope.id.toLocaleUpperCase()],
    ]);
  }
  return "";
}

function focusGeographyCases(scope) {
  const optionValue = optionValueForGeography(scope);
  if (!optionValue) return false;
  const matches = currentFilteredFeatures.filter(feature => {
    const properties = feature?.properties || {};
    return scope.type === "country"
      ? properties.Country === optionValue
      : properties.StateProvince === optionValue;
  });
  if (!matches.length) return false;
  const extent = ol.extent.createEmpty();
  for (const feature of matches) {
    const coordinates = feature?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) continue;
    const coordinate = ol.proj.fromLonLat(coordinates);
    ol.extent.extend(extent, [coordinate[0], coordinate[1], coordinate[0], coordinate[1]]);
  }
  if (ol.extent.isEmpty(extent)) return false;
  map.getView().fit(extent, {padding: [64, 64, 64, 64], duration: 220, maxZoom: 9});
  return true;
}

function visitorCountryCode() {
  const aliases = {UK: "GB", EL: "GR"};
  const normalizeCode = value => {
    const raw = String(value || "").trim().toLocaleUpperCase().replace(/[^A-Z]/g, "");
    const code = aliases[raw] || raw;
    return code.length === 2 ? code : "";
  };
  const available = code => Boolean(optionValueForGeography({type: "country", id: code}));
  const timezoneRules = [
    [/^Europe\/London$/i, "GB"],
    [/^Europe\/Dublin$/i, "IE"],
    [/^America\/(New_York|Detroit|Kentucky|Indiana|Chicago|North_Dakota|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Adak|Honolulu)$/i, "US"],
    [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Regina|Halifax|St_Johns|Moncton|Whitehorse|Yellowknife|Iqaluit)$/i, "CA"],
    [/^Australia\//i, "AU"],
    [/^Pacific\/(Auckland|Chatham)$/i, "NZ"],
    [/^Europe\/Paris$/i, "FR"],
    [/^Europe\/Berlin$/i, "DE"],
    [/^Europe\/Madrid$/i, "ES"],
    [/^Europe\/Rome$/i, "IT"],
    [/^Europe\/Amsterdam$/i, "NL"],
    [/^Europe\/Brussels$/i, "BE"],
    [/^Europe\/Zurich$/i, "CH"],
    [/^Europe\/Stockholm$/i, "SE"],
    [/^Europe\/Oslo$/i, "NO"],
    [/^Europe\/Copenhagen$/i, "DK"],
    [/^Europe\/Helsinki$/i, "FI"],
    [/^Europe\/Warsaw$/i, "PL"],
    [/^Europe\/Prague$/i, "CZ"],
    [/^Europe\/Vienna$/i, "AT"],
    [/^Europe\/Lisbon$/i, "PT"],
    [/^America\/Mexico_City$/i, "MX"],
    [/^America\/Sao_Paulo$/i, "BR"],
    [/^America\/Buenos_Aires$/i, "AR"],
    [/^America\/Santiago$/i, "CL"],
    [/^Asia\/Tokyo$/i, "JP"],
    [/^Asia\/Seoul$/i, "KR"],
    [/^Asia\/(Shanghai|Hong_Kong)$/i, "CN"],
    [/^Asia\/(Kolkata|Calcutta)$/i, "IN"],
    [/^Asia\/Singapore$/i, "SG"],
    [/^Asia\/Dubai$/i, "AE"],
    [/^Africa\/Johannesburg$/i, "ZA"],
    [/^Africa\/Lagos$/i, "NG"],
  ];
  let timezone = "";
  try {
    timezone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch (error) {
    // A locale-based estimate remains available below.
  }
  for (const [pattern, code] of timezoneRules) {
    if (pattern.test(timezone) && available(code)) return code;
  }
  let languages = [];
  try {
    languages = navigator.languages?.length ? [...navigator.languages] : [navigator.language];
  } catch (error) {
    // No visitor hint is preferable to a guessed unsupported country.
  }
  for (const language of languages) {
    const parts = String(language || "").replaceAll("_", "-").split("-");
    const code = normalizeCode(parts.length > 1 ? parts.at(-1) : "");
    if (code && available(code)) return code;
  }
  return "";
}

function focusInitialScopeIfRequested() {
  if (initialScopeFocusApplied || deepLinkedRecordIds.size) return;
  const focusScope = requestedFocusGeography();
  if (!stateFilter.value && !countryFilter.value && focusScope.type && focusScope.id) {
    initialScopeFocusApplied = focusGeographyCases(focusScope);
    if (initialScopeFocusApplied) return;
  }
  if (!stateFilter.value && !countryFilter.value && requestedVisitorFocus) {
    const visitorCountry = visitorCountryCode();
    if (visitorCountry) {
      initialScopeFocusApplied = focusGeographyCases({type: "country", id: visitorCountry});
      if (initialScopeFocusApplied) return;
    }
  }
  const shouldFocus = (urlParams.get("focus") || "").toLocaleLowerCase() === "filtered"
    || (embedMode && Boolean(stateFilter.value || countryFilter.value));
  if (!shouldFocus || !currentFilteredFeatures.length) return;
  initialScopeFocusApplied = true;
  window.setTimeout(focusFilteredCases, 0);
}

function renderMapHandoff() {
  if (!mapHandoff || !returnToSearch) return;
  const returnUrl = urlParams.get("from") === "search"
    ? validatedHandoffUrl(urlParams.get("return_search"), SEARCH_UI_BASE_URL)
    : "";
  if (!returnUrl) return;
  returnToSearch.href = returnUrl;
  if (mapHandoffText) {
    const query = urlParams.get("q")?.trim() || "";
    mapHandoffText.textContent = deepLinkedRecordIds.size
      ? `Focused on ${deepLinkedRecordIds.size.toLocaleString()} mapped case${deepLinkedRecordIds.size === 1 ? "" : "s"} from your search.`
      : query
        ? `Showing map cases related to “${query}”.`
        : "Showing the map view selected from archive search.";
  }
  mapHandoff.hidden = false;
}

function updateMapState({title = "", detail = "", loading = false, action = ""} = {}) {
  if (!mapState) return;
  if (!title) {
    mapState.hidden = true;
    return;
  }
  mapState.hidden = false;
  mapState.classList.toggle("is-loading", loading);
  mapStateTitle.textContent = title;
  mapStateDetail.textContent = detail;
  mapStateAction.hidden = !action;
  mapStateAction.textContent = action;
  mapStateAction.dataset.action = action === "Try again" ? "retry" : "reset";
}

renderMapHandoff();
dismissMapHandoff?.addEventListener("click", () => {
  mapHandoff.hidden = true;
});

let rawFeatures = [];
let aproFeatures = [];
let geipanFeatures = [];
let lacUfoFeatures = [];
let ufocatSourceLinks = new Map();
let allPublicSourceRecords = [];
let sourceLinkExportSummary = null;
let incidentClusterByRecordId = new Map();
let caseDossierByRecordId = new Map();
let featureArchiveFolders = new Map();
let selectedArchiveFolders = new Set();
let colorMode = "uniform";
let stateColors = new Map();
let activeClassificationFilter = "";
let activeTrailKey = "";
let currentFilteredFeatures = [];
let timelinePlaybackTimer = null;
let searchRenderTimer = null;
let dataReady = false;
const olFeatureCache = new WeakMap();
const styleCache = new Map();
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function setAuxiliaryPanel(panelName = "") {
  const showSourceRich = panelName === "source-rich";
  const showMappingData = panelName === "mapping-data";
  if (showSourceRich) renderSourceRichList(currentFilteredFeatures);
  if (showMappingData) renderMappingDataPanel();
  if (sourceRichPanel) sourceRichPanel.hidden = !showSourceRich;
  if (mappingDataAside) mappingDataAside.hidden = !showMappingData;
  mapPanel?.classList.toggle("auxiliary-panel-open", showSourceRich || showMappingData);
  sourceRichPanelToggle?.setAttribute("aria-expanded", String(showSourceRich));
  mappingDataPanelToggle?.setAttribute("aria-expanded", String(showMappingData));
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem("phoenix-color-mode", next);
    } catch (error) {
      // Ignore storage write failures.
    }
  });
}

if (localModeBadge) {
  localModeBadge.hidden = !localMode;
}

const FOLD3_ARCHIVE_FOLDER = "Documents / Project Blue Book / Fold3";
const sourceArchiveFolders = {
  GEIPAN: "Documents / France / GEIPAN",
  "LAC-UFO": "Documents / Canada / Library and Archives Canada UFO files",
  APROBulletin: "Magazines / United States / APRO Bulletin",
  DataNet: "Magazines / United States / Data-Net",
  SaucerNews: "Magazines / United States / Saucer News",
  "CSI-NYNews": "Magazines / United States / Civilian Saucer Intelligence (CSI) New York",
  NewsClipServ: "Magazines / United States / UFO Newsclipping Service",
  CRIFO: "Magazines / United States / Orbit (CRIFO, Leonard Stringfield)",
  Orbit: "Magazines / United States / Orbit (CRIFO, Leonard Stringfield)",
  Doubt: "Magazines / United States / Doubt (Fortean Society)",
  DoubtMag: "Magazines / United States / Doubt (Fortean Society)",
};

const mapTrails = {
  "1952": {label: "1952 wave", query: "1952", year: "1952", evidence: true, archiveQuery: "1952"},
  radar: {label: "Radar cases", query: "radar", evidence: true, archiveQuery: "radar report"},
  landings: {label: "Landing cases", query: "landing", evidence: true, archiveQuery: "landing trace"},
  photos: {label: "Photographic cases", query: "photo", evidence: true, archiveQuery: "photograph photo"},
  france: {label: "France evidence", query: "", country: "France", evidence: true, archiveQuery: "ovni"},
  geipan: {label: "GEIPAN cases", query: "GEIPAN", country: "France", evidence: true, archiveQuery: "GEIPAN"},
  "geipan-d": {label: "GEIPAN Class D", query: "GEIPAN Class D", country: "France", evidence: true, classification: "D", archiveQuery: "classification D"},
  "canada-lac": {
    label: "Canada UFO files",
    query: "",
    country: "Canada",
    evidence: true,
    archiveFolder: "Documents / Canada / Library and Archives Canada UFO files",
    archiveQuery: "Canada UFO",
  },
  australia: {label: "Australia cases", query: "", country: "Australia", evidence: true, archiveQuery: "Australia"},
  congress: {label: "Congress references", query: "congress", evidence: true, archiveQuery: "congress hearing"},
  uk: {label: "United Kingdom cases", query: "", country: "United Kingdom", evidence: true, archiveQuery: "United Kingdom"},
};

const baseLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: "https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attributions:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }),
});

const overviewVectorSource = new ol.source.Vector();
const overviewClusterSource = new ol.source.Cluster({
  distance: 70,
  minDistance: 12,
  source: overviewVectorSource,
});
const overviewClusterLayer = new ol.layer.Vector({
  source: overviewClusterSource,
  style: styleForOverviewCluster,
  visible: true,
});

const vectorSource = new ol.source.Vector();
const clusterSource = new ol.source.Cluster({
  distance: 36,
  minDistance: 10,
  source: vectorSource,
});

const clusterLayer = new ol.layer.Vector({
  source: clusterSource,
  style: styleForCluster,
  visible: false,
});

const aproVectorSource = new ol.source.Vector();
const aproClusterSource = new ol.source.Cluster({
  distance: 36,
  minDistance: 10,
  source: aproVectorSource,
});
const aproClusterLayer = new ol.layer.Vector({
  source: aproClusterSource,
  style: styleForCluster,
  visible: false,
});
const geipanVectorSource = new ol.source.Vector();
const geipanClusterSource = new ol.source.Cluster({
  distance: 36,
  minDistance: 10,
  source: geipanVectorSource,
});
const geipanClusterLayer = new ol.layer.Vector({
  source: geipanClusterSource,
  style: styleForCluster,
  visible: false,
});
const lacUfoVectorSource = new ol.source.Vector();
const lacUfoClusterSource = new ol.source.Cluster({
  distance: 36,
  minDistance: 10,
  source: lacUfoVectorSource,
});
const lacUfoClusterLayer = new ol.layer.Vector({
  source: lacUfoClusterSource,
  style: styleForCluster,
  visible: false,
});

const popupOverlay = new ol.Overlay({
  element: popup,
  positioning: "bottom-center",
  stopEvent: true,
  offset: [0, -12],
});

function positionPopup(coordinate) {
  mapPanel?.classList.add("popup-open");
  popup.classList.remove("popup-below");
  popup.style.maxHeight = "";
  popupOverlay.setPositioning("bottom-center");
  popupOverlay.setOffset([0, -12]);
  popupOverlay.setPosition(coordinate);
  window.requestAnimationFrame(() => {
    const size = map.getSize();
    const pixel = map.getPixelFromCoordinate(coordinate);
    if (!size || !pixel) return;
    const popupHeight = popup.getBoundingClientRect().height;
    const spaceAbove = pixel[1] - 18;
    const spaceBelow = size[1] - pixel[1] - 18;
    if (popupHeight > spaceAbove && spaceBelow > spaceAbove) {
      popup.classList.add("popup-below");
      popup.style.maxHeight = `${Math.max(180, spaceBelow)}px`;
      popupOverlay.setPositioning("top-center");
      popupOverlay.setOffset([0, 12]);
      popupOverlay.setPosition(coordinate);
    }
  });
}

function closeMapPopup() {
  popupOverlay.setPosition(undefined);
  popup.classList.remove("popup-below");
  popup.style.maxHeight = "";
  mapPanel?.classList.remove("popup-open");
}

const map = new ol.Map({
  target: "map",
  layers: [baseLayer, overviewClusterLayer, clusterLayer, aproClusterLayer, geipanClusterLayer, lacUfoClusterLayer],
  overlays: [popupOverlay],
  view: new ol.View({
    center: ol.proj.fromLonLat([0, 20]),
    zoom: 2,
  }),
});

function isOverviewZoom() {
  return (map.getView().getZoom() || 0) < 4;
}

function syncClusterLayerVisibility() {
  const overview = isOverviewZoom();
  overviewClusterLayer.setVisible(overview);
  clusterLayer.setVisible(!overview && fold3LayerToggle.checked);
  aproClusterLayer.setVisible(!overview && aproLayerToggle.checked);
  geipanClusterLayer.setVisible(!overview && geipanLayerToggle.checked);
  lacUfoClusterLayer.setVisible(!overview && lacUfoLayerToggle.checked);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function decadeFor(properties) {
  if (properties.DecadeFolder) return properties.DecadeFolder;
  const year = String(properties.Year || dateParts(properties).year || "");
  return /^\d{4}$/.test(year) ? `${Math.floor(Number(year) / 10) * 10}s` : "xxxx";
}

function dateParts(properties) {
  const raw = String(properties.Date || properties.RawDate || "").trim();
  const [yearPart, datePart = ""] = raw.split(".");
  const year = /^\d{4}$/.test(yearPart) ? yearPart : "";
  const month = /^\d{2,4}$/.test(datePart) && Number(datePart.slice(0, 2)) >= 1 && Number(datePart.slice(0, 2)) <= 12
    ? datePart.slice(0, 2)
    : "";
  return { year, month };
}

function colorFor(properties) {
  if (coordinateTier(properties) === "centroid_fallback") return "#7b6f1d";
  if (coordinateTier(properties) === "coarse_province_centroid") return "#8a7a43";
  if (coordinateTier(properties) === "provisional_coordinate" || coordinateTier(properties) === "provisional_locality") return "#a96a36";
  if (colorMode === "uniform") return "#2f7480";
  if (colorMode === "state") {
    return stateColors.get(properties.StateProvince) || "#156c75";
  }
  return decadeColors[decadeFor(properties)] || "#6b5c7a";
}

function formatCaseDate(properties) {
  const raw = String(properties.Date || properties.RawDate || "").trim();
  if (!raw) return "Date unknown";

  const seasons = new Set(["spring", "summer", "fall", "autumn", "winter"]);
  const [yearPart, datePart = ""] = raw.split(".");
  const year = /^\d{4}$/.test(yearPart) ? yearPart : "";
  const lowerDate = datePart.toLowerCase();

  if (seasons.has(lowerDate)) {
    return year ? `${year}, ${lowerDate[0].toUpperCase()}${lowerDate.slice(1)}` : `${lowerDate[0].toUpperCase()}${lowerDate.slice(1)}`;
  }

  if (/^\d{2,4}$/.test(datePart)) {
    const month = Number(datePart.slice(0, 2));
    const day = Number(datePart.slice(2, 4));
    if (month >= 1 && month <= 12) {
      const monthText = monthNames[month - 1];
      const dateText = day >= 1 && day <= 31 ? `${monthText} ${day}` : monthText;
      return year ? `${year}, ${dateText}` : `${dateText} (year unknown)`;
    }
  }

  if (year) return year;
  return raw.replaceAll(".", ", ");
}

function styleForCluster(feature) {
  const features = feature.get("features") || [];
  const size = features.length;
  const first = features[0]?.getProperties() || {};
  const color = colorFor(first);
  const tier = coordinateTier(first);
  const key = `${colorMode}:${color}:${tier}:${size > 1 ? "cluster" : "single"}:${size}`;
  if (styleCache.has(key)) return styleCache.get(key);

  const radius = size > 1 ? Math.min(25, 12 + Math.log(size) * 3.3) : 6.5;
  if (size === 1 && (tier === "centroid_fallback" || tier === "coarse_province_centroid")) {
    const style = [
      new ol.style.Style({
        image: new ol.style.Circle({
          radius: 18,
          fill: new ol.style.Fill({ color: "rgba(123, 111, 29, 0.13)" }),
          stroke: new ol.style.Stroke({ color, width: 2, lineDash: [5, 5] }),
        }),
      }),
      new ol.style.Style({
        image: new ol.style.Circle({
          radius: 4,
          fill: new ol.style.Fill({ color }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 1.5 }),
        }),
      }),
    ];
    styleCache.set(key, style);
    return style;
  }
  if (size === 1 && (tier === "provisional_coordinate" || tier === "provisional_locality")) {
    const style = new ol.style.Style({
      image: new ol.style.Circle({
        radius: 9,
        fill: new ol.style.Fill({ color: "rgba(182, 95, 24, 0.72)" }),
        stroke: new ol.style.Stroke({ color: "#ffffff", width: 2, lineDash: [3, 3] }),
      }),
    });
    styleCache.set(key, style);
    return style;
  }
  const style = new ol.style.Style({
    image: new ol.style.Circle({
      radius,
      fill: new ol.style.Fill({ color }),
      stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.92)", width: size > 1 ? 1.75 : 1.5 }),
    }),
    text:
      size > 1
        ? new ol.style.Text({
            text: String(size),
            fill: new ol.style.Fill({ color: "#ffffff" }),
            font: "700 11px Arial, Helvetica, sans-serif",
          })
        : undefined,
  });
  styleCache.set(key, style);
  return style;
}

function styleForOverviewCluster(feature) {
  const features = feature.get("features") || [];
  const size = features.length;
  if (size === 1) return styleForCluster(feature);
  const first = features[0]?.getProperties() || {};
  const color = colorMode === "uniform" ? "#2f7480" : colorFor(first);
  const key = `overview:${colorMode}:${color}:${size}`;
  if (styleCache.has(key)) return styleCache.get(key);
  const style = new ol.style.Style({
    image: new ol.style.Circle({
      radius: Math.min(22, 10 + Math.log(size) * 2.7),
      fill: new ol.style.Fill({ color }),
      stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.94)", width: 1.6 }),
    }),
    text: new ol.style.Text({
      text: String(size),
      fill: new ol.style.Fill({ color: "#ffffff" }),
      font: "700 10px Arial, Helvetica, sans-serif",
    }),
  });
  styleCache.set(key, style);
  return style;
}

function casePermalink(properties) {
  const recordId = String(properties.RecordId || properties.Fold3ImageNumber || "").trim();
  if (!recordId) return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("prn", recordId);
  if (hasOnlineEvidence({properties})) url.searchParams.set("evidence", "1");
  return url.href;
}

function canonicalMapCaseUrl(properties) {
  const localUrl = casePermalink(properties);
  if (!localUrl) return "";
  const local = new URL(localUrl);
  const canonical = new URL(MAP_UI_BASE_URL);
  canonical.search = local.search;
  return canonical.href;
}

function caseCollectionId(properties) {
  return isLacUfoFeature(properties) ? "lac"
    : isGeipanFeature(properties) ? "geipan"
    : isSourceFirstFeature(properties) ? "source-first"
    : isUfocatFeature(properties) ? "ufocat"
    : "blue-book";
}

function caseDetailUrl(properties) {
  const recordId = String(properties.RecordId || properties.Fold3ImageNumber || "").trim();
  if (!recordId) return "";
  const url = new URL("case/", SEARCH_UI_BASE_URL);
  url.searchParams.set("id", recordId);
  url.searchParams.set("collection", caseCollectionId(properties));
  if (isLocalMapPreview() && url.origin === window.location.origin && urlParams.get("publicData") === "1") {
    url.searchParams.set("publicData", "1");
  }
  return url.href;
}

function researchCaseButton(properties) {
  const recordId = String(properties.RecordId || properties.Fold3ImageNumber || "").trim();
  const url = caseDetailUrl(properties) || canonicalMapCaseUrl(properties);
  if (!recordId || !url) return "";
  const title = properties.Location || properties.Title || properties.MapLabel || `Mapped record ${recordId}`;
  const date = formatCaseDate(properties);
  const labels = sourceLabelsForFeature({properties});
  const linkCount = sourceLinkCount({properties});
  const evidenceStatus = [
    linkCount ? `${linkCount} public source link${linkCount === 1 ? "" : "s"}` : "Catalogue record",
    properties.CoordinatePrecision || properties.CoordinateTier || "",
  ].filter(Boolean).join(" · ");
  const citation = mapCaseCitation(properties, url);
  return `<button class="popup-link case-citation-button research-save-button" type="button" data-research-add
    data-research-id="${escapeHtml(`case:${recordId}`)}"
    data-research-type="mapped-case"
    data-research-title="${escapeHtml(title)}"
    data-research-subtitle="${escapeHtml(`${properties.SourceType || "Mapped record"} ${recordId}`)}"
    data-research-url="${escapeHtml(url)}"
    data-research-citation="${escapeHtml(citation)}"
    data-research-date="${escapeHtml(date)}"
    data-research-location="${escapeHtml(properties.Location || "")}"
    data-research-collection="${escapeHtml(properties.SourceType || "MapView")}"
    data-research-record-id="${escapeHtml(recordId)}"
    data-research-source-families="${escapeHtml(labels.join("|"))}"
    data-research-source-count="${escapeHtml(linkCount)}"
    data-research-evidence-status="${escapeHtml(evidenceStatus)}">Save for comparison</button>`;
}

function casePermalinkMarkup(properties) {
  const url = caseDetailUrl(properties);
  const recordId = String(properties.RecordId || properties.Fold3ImageNumber || "").trim();
  const dossier = caseDossierByRecordId.get(recordId);
  const permalink = url ? `<a class="popup-link" href="${escapeHtml(url)}">Open full case page</a>` : "";
  const dossierLink = dossier
    ? `<a class="popup-link dossier-case-link" href="${escapeHtml(searchUiUrl(dossier.stable_url || `cases/${dossier.slug}/`))}">Open evidence dossier</a>`
    : "";
  const investigationLink = dossier?.investigation_url
    ? `<a class="popup-link dossier-case-link" href="${escapeHtml(searchUiUrl(dossier.investigation_url))}">Start guided investigation</a>`
    : "";
  const citationButton = recordId ? `<button class="popup-link case-citation-button" type="button" data-copy-case-citation="${escapeHtml(recordId)}">Copy citation</button>` : "";
  const researchButton = researchCaseButton(properties);
  return permalink || dossierLink || investigationLink || citationButton || researchButton ? `<div class="case-permalink">${investigationLink}${dossierLink}${permalink}${citationButton}${researchButton}</div>` : "";
}

function mapCaseCitation(properties, explicitUrl = "") {
  const recordId = String(properties.RecordId || properties.Fold3ImageNumber || "").trim();
  const title = properties.Location || properties.Title || properties.MapLabel || recordId || "Mapped case";
  const date = formatCaseDate(properties);
  const dossier = caseDossierByRecordId.get(recordId);
  const url = explicitUrl || (dossier?.stable_url
    ? searchUiUrl(dossier.stable_url)
    : caseDetailUrl(properties) || canonicalMapCaseUrl(properties));
  const catalogue = isUfocatFeature(properties) ? `UFOCAT record ${recordId}` : `mapped record ${recordId}`;
  return `Isaac Koi Archive. "${title}, ${date}." ${catalogue}. ${url}`;
}

function relatedCaseUrl(recordId, collectionId = "") {
  const url = new URL("case/", SEARCH_UI_BASE_URL);
  url.searchParams.set("id", recordId);
  if (collectionId) url.searchParams.set("collection", collectionId);
  return url.href;
}

function relatedCasesMarkup(properties) {
  const recordId = String(properties.RecordId || properties.Fold3ImageNumber || "").trim();
  const collectionId = caseCollectionId(properties);
  const membership = incidentClusterByRecordId.get(`${collectionId}:${recordId}`);
  if (!membership) return "";
  const matches = membership.matches || [];
  const otherMembers = (membership.members || []).filter(member => member.record_key !== membership.record_key);
  const allMembersMarkup = otherMembers.length > matches.slice(0, 4).length
    ? `
      <details class="incident-cluster-members">
        <summary>View all ${Number(membership.member_count).toLocaleString()} preserved records</summary>
        <div class="related-case-list">
          ${otherMembers.map(member => `
            <a href="${escapeHtml(relatedCaseUrl(member.record_id, member.collection_id))}">
              <strong>${escapeHtml(member.location || member.title || member.record_id)}</strong>
              <span>${escapeHtml(member.collection)} &middot; ${escapeHtml(member.date)}</span>
              <small>${escapeHtml(member.record_id)}</small>
            </a>
          `).join("")}
        </div>
      </details>
    `
    : "";
  return `
    <section class="related-cases">
      <p class="source-section-title">Provisional incident cluster</p>
      <p class="source-detail">${Number(membership.member_count).toLocaleString()} preserved source records across ${Number(membership.collection_count).toLocaleString()} collections. Automated research aid; records are not merged.</p>
      <div class="related-case-list">
        ${matches.slice(0, 4).map(match => `
          <a href="${escapeHtml(relatedCaseUrl(match.record_id, match.collection_id))}">
            <strong>${escapeHtml(match.location || match.title || match.record_id)}</strong>
            <span>${escapeHtml(match.collection)} · ${escapeHtml(match.date)} · ${Number(match.distance_km).toLocaleString()} km</span>
            <small>${escapeHtml(match.confidence)} · ${escapeHtml((match.reasons || []).join(", "))}</small>
          </a>
        `).join("")}
      </div>
      ${allMembersMarkup}
    </section>
  `;
}

function caseCardHtml(properties, headingLevel = 2) {
  if (isLacUfoFeature(properties)) return lacUfoCardHtml(properties, headingLevel);
  if (isGeipanFeature(properties)) return geipanCardHtml(properties, headingLevel);
  if (isSourceFirstFeature(properties)) return sourceFirstCardHtml(properties, headingLevel);
  if (isUfocatFeature(properties)) return ufocatCardHtml(properties, headingLevel);
  const title = properties.Location || properties.MapLabel || properties.Fold3ImageNumber || "Project Blue Book case";
  const date = formatCaseDate(properties);
  const recordUrl = properties.RecordUrl || properties.SourceUrl || properties.Fold3Url || "";
  const link = recordUrl
    ? `<a class="popup-link" href="${escapeHtml(recordUrl)}" target="_blank" rel="noopener">Open Project Blue Book documents on Fold3</a>`
    : "";
  const searchActions = mapSearchActions(properties);
  const headingTag = `h${headingLevel}`;
  const countryRow = properties.Country ? `<dt>Country</dt><dd>${escapeHtml(properties.Country)}</dd>` : "";
  const stateRow = properties.StateProvince ? `<dt>State</dt><dd>${escapeHtml(properties.StateProvince)}</dd>` : "";
  return `
    <p class="source-label">Document collection: Project Blue Book on Fold3</p>
    <${headingTag} class="popup-title">${escapeHtml(title)}</${headingTag}>
    <dl class="popup-meta">
      <dt>Date</dt><dd>${escapeHtml(date)}</dd>
      <dt>Location</dt><dd>${escapeHtml(properties.Location)}</dd>
      ${countryRow}
      ${stateRow}
      <dt>Pages</dt><dd>${escapeHtml(properties.NumberOfPages)}</dd>
      <dt>Fold3 image number</dt><dd>${escapeHtml(properties.RecordId || properties.Fold3ImageNumber)}</dd>
    </dl>
    ${searchActions}
    ${link}
    ${casePermalinkMarkup(properties)}
    ${relatedCasesMarkup(properties)}
  `;
}

function geipanCardHtml(properties, headingLevel = 2) {
  const title = properties.Title || properties.Location || properties.RecordId || "GEIPAN case";
  const headingTag = `h${headingLevel}`;
  const sources = sourcesForRecordId(properties.RecordId);
  const sourceCountBadge = sources.length ? `<span class="source-count">${sources.length.toLocaleString()} source link${sources.length === 1 ? "" : "s"}</span>` : "";
  const collectionSearchUrl = archiveCollectionSearchUrl("documents/france-geipan", [
    properties.Title,
    properties.Location,
    properties.RecordId,
  ].filter(Boolean).join(" "));
  const classSearchUrl = properties.Classification
    ? archiveCollectionSearchUrl("documents/france-geipan", `classification ${properties.Classification}`)
    : "";
  const sourceLinks = sources.length
    ? `<div class="popup-links">
        ${sources.map((source) => `
          <button class="inline-link evidence-view-button geipan-evidence-button" type="button"
            data-evidence-url="${escapeHtml(source.source_url || source.online_source_url || "")}"
            data-evidence-title="${escapeHtml(source.document_filename || source.source_label || "GEIPAN public case file")}"
            data-evidence-meta="${escapeHtml([source.source_label, source.classification ? `classification ${source.classification}` : ""].filter(Boolean).join(" | "))}">View beside map</button>
          <a class="popup-link primary-source-link" href="${escapeHtml(source.source_url)}" target="_blank" rel="noopener">${escapeHtml(source.document_filename || source.source_label || "Open AFU-hosted GEIPAN file")}</a>
          ${source.official_source_url ? `<a class="popup-link" href="${escapeHtml(source.official_source_url)}" target="_blank" rel="noopener">Official GEIPAN source</a>` : ""}
        `).join("")}
      </div>`
    : "";
  const geipanSearchLinks = [collectionSearchUrl ? ["Search GEIPAN files", collectionSearchUrl] : null, classSearchUrl ? ["Search this GEIPAN class", classSearchUrl] : null]
    .filter(Boolean)
    .map(([label, url]) => `<a class="popup-link search-shortcut-link" href="${escapeHtml(url)}">${escapeHtml(label)}</a>`)
    .join("");
  return `
    <p class="source-label">GEIPAN public case file ${sourceCountBadge}</p>
    <${headingTag} class="popup-title">${escapeHtml(title)}</${headingTag}>
    <dl class="popup-meta">
      <dt>Date</dt><dd>${escapeHtml(formatCaseDate(properties))}</dd>
      ${optionalMetaRow("Classification", properties.Classification)}
      ${optionalMetaRow("Classification guide", geipanClassificationText(properties.Classification))}
      ${optionalMetaRow("Identification", properties.Identification)}
      ${optionalMetaRow("Location", properties.Location)}
      ${optionalMetaRow("Department", properties.Department)}
      ${optionalMetaRow("Region", properties.Region)}
      ${optionalMetaRow("Country", properties.Country)}
      ${optionalMetaRow("Phenomenon", properties.Phenomenon)}
      ${optionalMetaRow("Coordinate precision", properties.CoordinatePrecision)}
      <dt>GEIPAN case ID</dt><dd>${escapeHtml(String(properties.RecordId || "").replace(/^geipan:/, ""))}</dd>
    </dl>
    ${mapSearchActions(properties)}
    ${geipanSearchLinks ? `<div class="map-search-actions" aria-label="GEIPAN collection search">${geipanSearchLinks}</div>` : ""}
    ${sourceLinks}
    ${casePermalinkMarkup(properties)}
    ${relatedCasesMarkup(properties)}
  `;
}

function geipanClassificationText(value) {
  const key = String(value || "").trim().toUpperCase();
  const meanings = {
    A: "identified phenomenon",
    B: "probable explanation",
    C: "insufficient information",
    D: "unidentified after investigation",
  };
  return meanings[key] || "";
}

function lacUfoCardHtml(properties, headingLevel = 2) {
  const title = [properties.Location, properties.StateProvince].filter(Boolean).join(", ") || properties.RecordId || "LAC UFO record";
  const headingTag = `h${headingLevel}`;
  const sources = sourcesForRecordId(properties.RecordId);
  const pdfSource = sources.find((source) => source.pdf_url);
  const sourceCountBadge = sources.length ? `<span class="source-count">${sources.length.toLocaleString()} source link${sources.length === 1 ? "" : "s"}</span>` : "";
  const sourceLinks = sources.length
    ? `<div class="popup-links">
        ${sources.map((source) => `
          ${source.pdf_url ? `<a class="popup-link primary-source-link" href="${escapeHtml(source.pdf_url)}" target="_blank" rel="noopener">Open source PDF</a>` : ""}
          <a class="popup-link primary-source-link" href="${escapeHtml(source.source_url || source.official_source_url || "")}" target="_blank" rel="noopener">Open LAC item display</a>
          ${(source.image_urls || "").split("|").filter(Boolean).slice(0, 3).map((url, index) =>
            `<a class="popup-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">View image${index ? ` ${index + 1}` : ""}</a>`
          ).join("")}
        `).join("")}
      </div>`
    : "";
  return `
    <p class="source-label">Library and Archives Canada UFO file ${sourceCountBadge}</p>
    <${headingTag} class="popup-title">${escapeHtml(title)}</${headingTag}>
    <dl class="popup-meta">
      <dt>Date</dt><dd>${escapeHtml(formatCaseDate(properties))}</dd>
      ${optionalMetaRow("Document date", properties.DocumentDate)}
      ${optionalMetaRow("Location", title)}
      ${optionalMetaRow("Record number", properties.ItemRecordNumber)}
      ${optionalMetaRow("MIKAN", properties.MikanNumber)}
      ${optionalMetaRow("Record group", properties.RecordGroup)}
      ${optionalMetaRow("Pages", properties.PageCount)}
      ${optionalMetaRow("PDF pages", pdfSource?.pdf_page_count)}
      ${optionalMetaRow("PDF range", lacPdfRangeText(pdfSource))}
      ${optionalMetaRow("Coordinate tier", coordinateConfidenceText(coordinateTier(properties)))}
      ${optionalMetaRow("Coordinate precision", properties.CoordinatePrecision)}
      <dt>LAC span ID</dt><dd>${escapeHtml(properties.RecordId)}</dd>
    </dl>
    <p class="source-detail">Coordinates are automatically inferred from LAC metadata and may be approximate.</p>
    ${mapSearchActions(properties)}
    ${sourceLinks}
    ${casePermalinkMarkup(properties)}
    ${relatedCasesMarkup(properties)}
  `;
}

function lacPdfRangeText(source) {
  if (!source?.pdf_range_method) return "";
  const inferredCount = Number(source.inferred_continuation_page_count || 0);
  const crosswalkCount = Number(source.crosswalk_2012_page_count || 0);
  if (source.pdf_range_method === "indexed_pages_plus_inferred_and_2012_crosswalk_pages") {
    const parts = [];
    if (inferredCount) parts.push(`${inferredCount.toLocaleString()} inferred continuation page${inferredCount === 1 ? "" : "s"}`);
    if (crosswalkCount) parts.push(`${crosswalkCount.toLocaleString()} 2012 crosswalk page${crosswalkCount === 1 ? "" : "s"}`);
    return parts.length ? `indexed pages plus ${parts.join(" and ")}` : "indexed pages plus inferred/crosswalk pages";
  }
  if (source.pdf_range_method === "indexed_pages_plus_inferred_small_gap_continuations") {
    return inferredCount
      ? `indexed pages plus ${inferredCount.toLocaleString()} inferred continuation page${inferredCount === 1 ? "" : "s"}`
      : "indexed pages plus inferred continuation pages";
  }
  if (source.pdf_range_method === "indexed_pages_only") return "indexed pages only";
  return String(source.pdf_range_method).replaceAll("_", " ");
}

function optionalMetaRow(label, value) {
  return value ? `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>` : "";
}

function coordinateConfidenceText(value) {
  if (value === "high_confidence_locality") return "automated locality match";
  if (value === "provisional_locality") return "provisional locality/feature match";
  if (value === "coarse_province_centroid") return "coarse province/territory centroid";
  if (value === "centroid_fallback") return "coarse centroid fallback";
  if (value === "provisional_coordinate") return "provisional coordinate";
  if (value === "reviewed_coordinate_override") return "reviewed coordinate override";
  if (value === "raw_plausible_coordinate") return "unreviewed UFOCAT coordinate";
  return String(value || "").replaceAll("_", " ");
}

function coordinateTier(properties) {
  const tier = String(properties.CoordinateTier || "");
  if (tier) return tier;
  const source = String(properties.CoordinateSource || "");
  if (source.startsWith("Centroid fallback")) return "centroid_fallback";
  if (source.startsWith("Provisional coordinate")) return "provisional_coordinate";
  if (source.startsWith("Reviewed coordinate override")) return "reviewed_coordinate_override";
  return "";
}

function isUfocatFeature(properties) {
  return properties.SourceType === "UFOCAT" || properties.SourceType === "UFOCAT_APRO";
}

function isSourceFirstFeature(properties) {
  return properties.SourceType === "SOURCE_FIRST" || properties.SourceType === "SOURCE_FIRST_LOCAL";
}

function isGeipanFeature(properties) {
  return properties.SourceType === "GEIPAN";
}

function isLacUfoFeature(properties) {
  return properties.SourceType === "LAC_UFO";
}

function sourceStatusText(source) {
  if (source.page_mapping_status === "needs_review") return "page needs review";
  if (source.validation_status === "text_validated" || source.validation_status === "search_hit_text_validated") return "text validated";
  if (source.validation_status === "mapped_page_valid") return "page mapped";
  if (source.validation_status === "issue_resolved") return "issue resolved";
  return source.validation_status || source.page_mapping_status || "";
}

function isAllowedEvidenceUrl(value) {
  try {
    const url = new URL(value);
    const isPublic = url.origin === "https://files.afu.se" && url.pathname === "/Downloads/search/pdfjs/web/viewer.html";
    const isPublicArchivePdf = url.origin === "https://files.afu.se"
      && url.pathname.startsWith("/Downloads/")
      && /\.pdf$/i.test(decodeURIComponent(url.pathname));
    const isLocal = localMode
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      && url.pathname === "/pdfjs/web/viewer.html";
    return isPublic || isPublicArchivePdf || isLocal;
  } catch (error) {
    return false;
  }
}

function evidenceMeta(source) {
  return [
    source.issue_label,
    evidencePrecisionText(source),
    source.search_anchor_term ? `highlight ${source.search_anchor_term}` : "",
    sourceStatusText(source),
  ].filter(Boolean).join(" | ");
}

function evidenceUrlHasPage(value) {
  try {
    return Boolean(new URL(value).hash.match(/(?:^#|&)page=\d+/));
  } catch (error) {
    return false;
  }
}

function evidencePrecisionText(source) {
  const actionUrl = source.evidence_url || source.online_source_url || "";
  return evidenceUrlHasPage(actionUrl) ? "highlighted page" : "search within issue";
}

function sourceTrailStats(source) {
  const page = source.online_source_page || source.search_hit_page || "";
  return [
    page ? `page ${page}` : "page pending",
    source.search_anchor_term ? `anchor ${source.search_anchor_term}` : "",
    evidencePrecisionText(source),
    sourceStatusText(source),
  ].filter(Boolean);
}

function openEvidencePanel(url, title, meta) {
  if (!isAllowedEvidenceUrl(url)) return;
  evidencePanelTitle.textContent = title || "Highlighted archive evidence";
  evidencePanelMeta.textContent = meta || "";
  evidenceExternalLink.href = url;
  evidenceFrame.src = url;
  evidencePanel.hidden = false;
  mapPanel.classList.add("evidence-open");
  map.updateSize();
}

function closeEvidencePanel() {
  evidencePanel.hidden = true;
  evidenceFrame.removeAttribute("src");
  evidenceExternalLink.href = "#";
  mapPanel.classList.remove("evidence-open");
  map.updateSize();
}

function archiveFolderForSource(source) {
  return source.archive_folder || sourceArchiveFolders[source.source_code] || `Magazines / United States / ${source.source_label || source.source_code || "Source"}`;
}

function archiveSearchUrl(source) {
  if (source.source_code === "LAC-UFO" && (source.source_url || source.official_source_url)) {
    return source.source_url || source.official_source_url;
  }
  const documentId = source.afu_document_id || source.online_source_document_id;
  if (!documentId) return "";
  const url = new URL(ARCHIVE_SEARCH_URL, window.location.href);
  url.searchParams.set("issue", documentId);
  const query = source.search_anchor_term || source.online_source_search_term;
  if (query) url.searchParams.set("q", query);
  const page = source.online_source_page || source.search_hit_page;
  if (page) url.searchParams.set("page", page);
  url.searchParams.set("fulltext", "1");
  url.searchParams.set("autorun", "1");
  return withMapHandoff(url.href);
}

function archiveSearchQueryUrl(query) {
  const value = String(query || "").trim();
  if (!value) return "";
  const url = new URL(ARCHIVE_SEARCH_URL, window.location.href);
  url.searchParams.set("q", value);
  url.searchParams.set("fulltext", "1");
  url.searchParams.set("autorun", "1");
  return withMapHandoff(url.href);
}

function syncArchiveSearchLinks() {
  const query = searchInput.value.trim();
  const returnUrl = urlParams.get("from") === "search"
    ? validatedHandoffUrl(urlParams.get("return_search"), SEARCH_UI_BASE_URL)
    : "";
  const url = query ? archiveSearchQueryUrl(query) : returnUrl || searchUiUrl();
  document.querySelectorAll("[data-archive-search-link]").forEach(link => {
    link.href = url;
    link.title = query
      ? `Search archive material for “${query}”`
      : returnUrl ? "Return to archive results" : "Open archive search";
  });
}

function mapAreaSearchUrl() {
  const size = map.getSize();
  if (!size) return {url: "", recordCount: 0, availableCount: 0};
  const center = ol.proj.toLonLat(map.getView().getCenter());
  const candidates = currentFilteredFeatures
    .filter(feature => {
      const coordinates = feature.geometry?.coordinates || [];
      if (coordinates.length < 2) return false;
      const pixel = map.getPixelFromCoordinate(ol.proj.fromLonLat(coordinates));
      return pixel && pixel[0] >= 0 && pixel[0] <= size[0] && pixel[1] >= 0 && pixel[1] <= size[1];
    })
    .map(feature => {
      const recordId = String(feature.properties?.RecordId || feature.properties?.Fold3ImageNumber || "");
      const coordinates = feature.geometry.coordinates;
      const distance = Math.hypot(coordinates[0] - center[0], coordinates[1] - center[1]);
      return {recordId, distance, hasSources: sourcesForRecordId(recordId).length > 0};
    })
    .filter(row => row.recordId && row.hasSources)
    .sort((left, right) => left.distance - right.distance || left.recordId.localeCompare(right.recordId));
  const recordIds = [...new Set(candidates.map(row => row.recordId))].slice(0, 80);
  if (!recordIds.length) return {url: "", recordCount: 0, availableCount: candidates.length};
  const url = new URL(ARCHIVE_SEARCH_URL, window.location.href);
  url.searchParams.set("map_record", recordIds.join(","));
  url.searchParams.set("fulltext", "0");
  url.searchParams.set("autorun", "1");
  return {url: withMapHandoff(url.href), recordCount: recordIds.length, availableCount: candidates.length};
}

function updateMapAreaSearchStatus() {
  if (!searchMapArea || !searchMapAreaStatus) return;
  const container = searchMapArea.closest(".map-area-search");
  if (!dataReady) {
    if (container) container.hidden = true;
    searchMapArea.disabled = true;
    searchMapArea.textContent = "Search archive for cases";
    searchMapAreaStatus.textContent = "";
    return;
  }
  const result = mapAreaSearchUrl();
  searchMapArea.disabled = !result.recordCount;
  searchMapArea.textContent = result.recordCount
    ? `Search archive for ${result.recordCount.toLocaleString()} case${result.recordCount === 1 ? "" : "s"}`
    : "No linked cases here";
  const matchCount = currentFilteredFeatures.length;
  const userHasMapIntent = activeDataFilterCount() > 0 || deepLinkedRecordIds.size > 0 || Boolean(activeTrailKey);
  if (container) container.hidden = matchCount === 0 || !result.recordCount || (isOverviewZoom() && !userHasMapIntent);
  const overviewNote = isOverviewZoom() ? " \u00b7 grouped overview" : "";
  searchMapAreaStatus.textContent = matchCount
    ? `${matchCount.toLocaleString()} map case${matchCount === 1 ? "" : "s"} match${overviewNote}`
    : "No map cases match";
}

function archiveCollectionSearchUrl(collectionId, query = "") {
  const url = new URL(ARCHIVE_SEARCH_URL, window.location.href);
  const value = String(query || "").trim();
  if (value) url.searchParams.set("q", value);
  if (collectionId) url.searchParams.set("collection", collectionId);
  url.searchParams.set("fulltext", "1");
  url.searchParams.set("autorun", "1");
  return withMapHandoff(url.href);
}

function mapSearchActions(properties) {
  const year = dateParts(properties).year;
  const nearbyQuery = [properties.Location, year].filter(Boolean).join(" ");
  const actions = [
    ["Search location", properties.Location],
    ["Search names", properties.Names],
    ["Search date", formatCaseDate(properties) === "Date unknown" ? "" : formatCaseDate(properties)],
    ["Nearby archive material", nearbyQuery],
    ["Search record ID", properties.RecordId],
  ]
    .map(([label, query]) => [label, archiveSearchQueryUrl(query)])
    .filter(([, url]) => url);
  if (!actions.length) return "";
  return `
    <details class="map-search-tools">
      <summary>Search related archive material</summary>
      <div class="map-search-actions" aria-label="Archive search shortcuts">
        ${actions.map(([label, url]) => `<a class="popup-link search-shortcut-link" href="${escapeHtml(url)}">${escapeHtml(label)}</a>`).join("")}
      </div>
    </details>
  `;
}

function sourcesForRecordId(recordId) {
  return ufocatSourceLinks.get(String(recordId || "")) || [];
}

function sourceLinkCount(feature) {
  const properties = feature.properties || {};
  if (isUfocatFeature(properties) || isSourceFirstFeature(properties) || isGeipanFeature(properties) || isLacUfoFeature(properties)) {
    return sourcesForRecordId(properties.RecordId).length;
  }
  return properties.RecordUrl || properties.SourceUrl || properties.Fold3Url ? 1 : 0;
}

function sourceRichListRows(features) {
  return features
    .map((feature) => ({feature, count: sourceLinkCount(feature)}))
    .filter((row) => row.count > 0)
    .sort((left, right) =>
      right.count - left.count ||
      String(left.feature.properties.Date || left.feature.properties.RawDate || "").localeCompare(String(right.feature.properties.Date || right.feature.properties.RawDate || "")) ||
      String(left.feature.properties.Location || "").localeCompare(String(right.feature.properties.Location || ""))
    )
    .slice(0, 10);
}

function sourceLabelsForFeature(feature) {
  const properties = feature.properties || {};
  if (!isUfocatFeature(properties) && !isSourceFirstFeature(properties) && !isGeipanFeature(properties) && !isLacUfoFeature(properties)) {
    return properties.RecordUrl || properties.SourceUrl || properties.Fold3Url ? ["Project Blue Book"] : [];
  }
  return [...new Set(sourcesForRecordId(properties.RecordId)
    .map((source) => source.source_label || source.source_code)
    .filter(Boolean))];
}

function bestArchiveSourceForFeature(feature) {
  const properties = feature.properties || {};
  return sourcesForRecordId(properties.RecordId).find((source) =>
    source.evidence_url || source.online_source_url || source.source_url || source.official_source_url || source.afu_document_id || source.online_source_document_id
  );
}

function renderSourceRichList(features) {
  if (!sourceRichList) return;
  const rows = sourceRichListRows(features);
  if (!rows.length) {
    sourceRichList.innerHTML = `<p class="source-detail">No visible cases have online source links yet.</p>`;
    return;
  }
  sourceRichList.innerHTML = rows.map(({feature, count}) => {
    const properties = feature.properties || {};
    const title = properties.Location || properties.MapLabel || properties.RecordId || "Mapped case";
    const date = formatCaseDate(properties);
    const labels = sourceLabelsForFeature(feature).slice(0, 3).join(", ");
    const bestSource = bestArchiveSourceForFeature(feature);
    const archiveUrl = bestSource ? archiveSearchUrl(bestSource) : archiveSearchQueryUrl([properties.Location, dateParts(properties).year].filter(Boolean).join(" "));
    return `
      <article class="source-rich-item">
        <button type="button" data-record-id="${escapeHtml(properties.RecordId || properties.Fold3ImageNumber || "")}">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(date)} / ${count.toLocaleString()} source link${count === 1 ? "" : "s"}</span>
          ${labels ? `<span>${escapeHtml(labels)}</span>` : ""}
        </button>
        ${archiveUrl ? `<a class="source-rich-archive-link" href="${escapeHtml(archiveUrl)}">Open archive evidence</a>` : ""}
      </article>
    `;
  }).join("");
}

function sourceLinkStableId(source) {
  return source.source_link_id || [
    source.ufocat_prn || source.record_id || "",
    source.source_code || "",
    source.afu_document_id || source.online_source_document_id || "",
    source.citation_raw || "",
  ].filter(Boolean).join(" | ");
}

function sourceLinkNeedsCheck(source) {
  const pageStatus = String(source.page_mapping_status || "").toLowerCase();
  const validation = String(source.validation_status || "").toLowerCase();
  const confidence = String(source.link_confidence || "").toLowerCase();
  return pageStatus.includes("review") ||
    validation.includes("review") ||
    validation.includes("issue_resolved") ||
    confidence === "low" ||
    !String(source.online_source_page || source.search_hit_page || "").trim();
}

function countBy(records, field, fallback = "unknown") {
  const counts = new Map();
  for (const record of records) {
    const key = String(record[field] || fallback).trim() || fallback;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function countPills(counts, limit = 4) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => `<span><strong>${count.toLocaleString()}</strong><small>${escapeHtml(label.replaceAll("_", " "))}</small></span>`)
    .join("");
}

function renderMappingDataPanel() {
  if (!mappingDataPanel) return;
  const records = allPublicSourceRecords.filter((record) => record.afu_document_id || record.online_source_document_id);
  if (!records.length) {
    mappingDataPanel.innerHTML = `<p class="source-detail">No public source-link records are loaded.</p>`;
    return;
  }
  const bySource = countBy(records, "source_code");
  const confidence = countBy(records, "link_confidence");
  const pageStatus = countBy(records, "page_mapping_status");
  const needsCheck = records.filter(sourceLinkNeedsCheck);
  const sourceRows = [...bySource.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([source, count]) => `<li><span>${escapeHtml(source)}</span><strong>${count.toLocaleString()}</strong></li>`)
    .join("");
  const checkRows = needsCheck
    .slice(0, 4)
    .map((source) => {
      const stableId = sourceLinkStableId(source);
      const doc = source.afu_document_id || source.online_source_document_id || "";
      const searchUrl = archiveSearchUrl(source);
      return `<article class="mapping-check-row">
        <strong>${escapeHtml(source.source_label || source.source_code || "Source link")}</strong>
        <span>${escapeHtml([`PRN ${source.ufocat_prn || source.record_id || "unknown"}`, source.issue_label || doc, sourceStatusText(source)].filter(Boolean).join(" | "))}</span>
        <div>
          ${searchUrl ? `<a href="${escapeHtml(searchUrl)}">Open search</a>` : ""}
          <button type="button" data-copy-source-link-id="${escapeHtml(stableId)}">Copy id</button>
        </div>
      </article>`;
    })
    .join("");
  const exportedCount = Number(sourceLinkExportSummary?.record_count || 0);
  const exportNote = exportedCount && exportedCount !== records.length
    ? `<p class="mapping-note">Export file reports ${exportedCount.toLocaleString()} rows; loaded sidecars contain ${records.length.toLocaleString()} rows.</p>`
    : `<p class="mapping-note">Download URLs are current AFU navigation links; use source IDs and document IDs for durable checks.</p>`;
  mappingDataPanel.innerHTML = `
    <div class="mapping-downloads">
      <a href="${mapDataUrl(SOURCE_LINK_EXPORT_CSV_URL)}" download>CSV</a>
      <a href="${mapDataUrl(SOURCE_LINK_EXPORT_JSON_URL)}" download>JSON</a>
      <a href="${mapDataUrl("data/source-link-export/README.md")}">Notes</a>
    </div>
    <div class="mapping-stat-grid">
      <span><strong>${records.length.toLocaleString()}</strong><small>source links</small></span>
      <span><strong>${bySource.size.toLocaleString()}</strong><small>sources</small></span>
      <span><strong>${new Set(records.map((record) => record.ufocat_prn || record.record_id).filter(Boolean)).size.toLocaleString()}</strong><small>mapped records</small></span>
      <span><strong>${needsCheck.length.toLocaleString()}</strong><small>check rows</small></span>
    </div>
    <div class="mapping-pill-row">${countPills(confidence)}${countPills(pageStatus)}</div>
    <ul class="mapping-source-list">${sourceRows}</ul>
    ${exportNote}
    ${checkRows ? `<div class="mapping-check-list">${checkRows}</div>` : ""}
  `;
}

function timelineBucketStats(features, bucketForFeature) {
  const buckets = new Map();
  for (const feature of features) {
    const bucket = bucketForFeature(feature);
    if (!bucket) continue;
    if (!buckets.has(bucket)) buckets.set(bucket, { count: 0, evidence: 0 });
    const stats = buckets.get(bucket);
    stats.count += 1;
    if (hasOnlineEvidence(feature)) stats.evidence += 1;
  }
  return buckets;
}

function timelineButtonMarkup({bucket, stats, active, mode, max, label = bucket}) {
  const height = Math.max(4, Math.round((stats.count / Math.max(max, 1)) * 42));
  const title = `${label}: ${stats.count.toLocaleString()} cases / ${stats.evidence.toLocaleString()} with evidence`;
  return `
    <button type="button" class="${active ? "active" : ""}" data-timeline-${mode}="${escapeHtml(bucket)}"
      aria-pressed="${active}" ${stats.count ? "" : "disabled"} title="${escapeHtml(title)}">
      <span class="timeline-bar" style="height:${height}px"></span>
      <span class="timeline-tick">${escapeHtml(label)}</span>
    </button>
  `;
}

function enabledFeatures() {
  return [
    ...(fold3LayerToggle.checked ? rawFeatures : []),
    ...(aproLayerToggle.checked ? aproFeatures : []),
    ...(geipanLayerToggle.checked ? geipanFeatures : []),
    ...(lacUfoLayerToggle.checked ? lacUfoFeatures : []),
  ];
}

function renderTimeline(allEnabledFeatures, visibleFeatures) {
  if (!yearTimeline || !monthTimeline || !collectionTimeline) return;
  const timeContext = allEnabledFeatures.filter(feature => passesFilters(feature, {ignoreTime: true}));
  const collectionContext = allEnabledFeatures.filter(feature => passesFilters(feature, {ignoreArchive: true}));
  const years = [...timelineBucketStats(timeContext, feature => dateParts(feature.properties).year).entries()]
    .sort((left, right) => left[0].localeCompare(right[0]));
  const monthContext = yearFilter.value
    ? timeContext.filter(feature => dateParts(feature.properties).year === yearFilter.value)
    : timeContext;
  const months = timelineBucketStats(monthContext, feature => dateParts(feature.properties).month);
  const collections = new Map();
  for (const feature of collectionContext) {
    for (const folder of archiveFoldersForFeature(feature)) {
      if (!collections.has(folder)) collections.set(folder, {count: 0, evidence: 0});
      const stats = collections.get(folder);
      stats.count += 1;
      if (hasOnlineEvidence(feature)) stats.evidence += 1;
    }
  }

  if (years.length) {
    const max = Math.max(...years.map(([, stats]) => stats.count), 1);
    yearTimeline.innerHTML = years.map(([bucket, stats]) => timelineButtonMarkup({
      bucket, stats, max, mode: "year", active: yearFilter.value === bucket,
    })).join("");
  } else {
    yearTimeline.innerHTML = `<span class="timeline-empty">No dated cases match these filters</span>`;
  }

  const monthMax = Math.max(...Array.from(months.values(), stats => stats.count), 1);
  monthTimeline.innerHTML = Array.from({length: 12}, (_, index) => {
    const bucket = String(index + 1).padStart(2, "0");
    const stats = months.get(bucket) || {count: 0, evidence: 0};
    return timelineButtonMarkup({
      bucket,
      stats,
      max: monthMax,
      mode: "month",
      active: monthFilter.value === bucket,
      label: monthNames[index].slice(0, 1),
    });
  }).join("");

  const collectionRows = [...collections.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .slice(0, 6);
  const collectionMax = Math.max(...collectionRows.map(([, stats]) => stats.count), 1);
  collectionTimeline.innerHTML = collectionRows.map(([folder, stats]) => {
    const label = folder.split(" / ").at(-1);
    const width = Math.max(3, Math.round((stats.count / collectionMax) * 100));
    const active = selectedArchiveFolders.has(folder);
    return `<button type="button" data-timeline-collection="${escapeHtml(folder)}" aria-pressed="${active}"
      class="${active ? "active" : ""}" title="${escapeHtml(`${folder}: ${stats.count.toLocaleString()} cases`)}">
      <span><i style="width:${width}%"></i></span><strong>${escapeHtml(label)}</strong><em>${stats.count.toLocaleString()}</em>
    </button>`;
  }).join("") || `<span class="timeline-empty">No collections match</span>`;

  const datedVisible = visibleFeatures.filter(feature => dateParts(feature.properties).year).length;
  const selection = [yearFilter.value, monthFilter.value ? monthNames[Number(monthFilter.value) - 1] : ""].filter(Boolean).join(" / ");
  timelineStatus.textContent = `${datedVisible.toLocaleString()} dated of ${visibleFeatures.length.toLocaleString()} visible${selection ? ` · ${selection}` : ""}`;
  yearTimeline.querySelector(".active")?.scrollIntoView({block: "nearest", inline: "center"});
}

function featureByRecordId(recordId) {
  const id = String(recordId || "");
  return [...rawFeatures, ...aproFeatures, ...geipanFeatures, ...lacUfoFeatures].find((feature) =>
    String(feature.properties.RecordId || feature.properties.Fold3ImageNumber || "") === id
  );
}

function openFeaturePopup(feature) {
  if (!feature?.geometry?.coordinates) return;
  const coordinate = ol.proj.fromLonLat(feature.geometry.coordinates);
  map.getView().animate({center: coordinate, zoom: Math.max(map.getView().getZoom() || 0, 7), duration: 180});
  popupContent.innerHTML = popupHtml(feature.properties || {});
  window.IsaacKoiResearch?.render();
  positionPopup(coordinate);
}

function focusDeepLinkedRecords() {
  if (!deepLinkedRecordIds.size) return;
  const linked = [...deepLinkedRecordIds].map(featureByRecordId).filter(feature => feature?.geometry?.coordinates);
  if (!linked.length) return;
  if (linked.length === 1) {
    openFeaturePopup(linked[0]);
    return;
  }
  const extent = ol.extent.createEmpty();
  for (const feature of linked) {
    const coordinate = ol.proj.fromLonLat(feature.geometry.coordinates);
    ol.extent.extend(extent, [coordinate[0], coordinate[1], coordinate[0], coordinate[1]]);
  }
  map.getView().fit(extent, { padding: [70, 70, 70, 70], duration: 220, maxZoom: 8 });
}

function focusFilteredCases() {
  const matches = currentFilteredFeatures.filter(feature => feature?.geometry?.coordinates?.length >= 2);
  if (!matches.length) return;
  const extent = ol.extent.createEmpty();
  for (const feature of matches) {
    const coordinate = ol.proj.fromLonLat(feature.geometry.coordinates);
    ol.extent.extend(extent, [coordinate[0], coordinate[1], coordinate[0], coordinate[1]]);
  }
  map.getView().fit(extent, {padding: [64, 64, 64, 64], duration: 220, maxZoom: 9});
}

function sourceMatchesDeepLink(source) {
  if (!deepLinkedSourceDoc && !deepLinkedSourceCode) return false;
  const doc = String(source.afu_document_id || source.online_source_document_id || "");
  const code = String(source.source_code || "");
  if (deepLinkedSourceDoc && doc !== deepLinkedSourceDoc) return false;
  if (deepLinkedSourceCode && code !== deepLinkedSourceCode) return false;
  return true;
}

function openDeepLinkedEvidence() {
  if (!deepLinkedRecordIds.size || (!deepLinkedSourceDoc && !deepLinkedSourceCode)) return;
  for (const recordId of deepLinkedRecordIds) {
    const source = sourcesForRecordId(recordId).find(sourceMatchesDeepLink);
    const actionUrl = source?.evidence_url || source?.online_source_url || source?.source_url;
    if (!source || !actionUrl || !isAllowedEvidenceUrl(actionUrl)) continue;
    openEvidencePanel(actionUrl, source.source_label || source.document_filename || "Archive source", evidenceMeta(source));
    return;
  }
}

function hasOnlineEvidence(feature) {
  const properties = feature.properties || {};
  if (isGeipanFeature(properties)) {
    return sourcesForRecordId(properties.RecordId).some((source) => Boolean(source.source_url || source.online_source_url));
  }
  if (isLacUfoFeature(properties)) {
    return sourcesForRecordId(properties.RecordId).some((source) => Boolean(source.source_url || source.official_source_url || source.image_urls));
  }
  if (!isUfocatFeature(properties) && !isSourceFirstFeature(properties)) {
    return Boolean(properties.RecordUrl || properties.SourceUrl || properties.Fold3Url);
  }
  return sourcesForRecordId(properties.RecordId).some((source) =>
    Boolean(source.evidence_url || source.online_source_url || source.afu_document_id || source.online_source_document_id)
  );
}

function trailShareUrl(key = activeTrailKey) {
  const trail = mapTrails[key];
  if (!trail) return window.location.href;
  const url = new URL(window.location.href);
  url.searchParams.set("trail", key);
  url.searchParams.set("evidence", trail.evidence ? "1" : "0");
  url.searchParams.delete("q");
  url.searchParams.delete("prn");
  return url.href;
}

function updateTrailStatus() {
  const trail = mapTrails[activeTrailKey];
  if (!trailStatus || !trailStatusLabel || !trailArchiveLink) return;
  if (!trail) {
    trailStatus.hidden = true;
    document.querySelectorAll("[data-map-trail]").forEach(button => button.classList.remove("active"));
    return;
  }
  trailStatus.hidden = false;
  trailStatusLabel.textContent = trail.label;
  trailArchiveLink.href = archiveSearchQueryUrl(trail.archiveQuery || trail.query || trail.country || trail.label);
  document.querySelectorAll("[data-map-trail]").forEach(button => {
    button.classList.toggle("active", button.dataset.mapTrail === activeTrailKey);
  });
}

function clearActiveTrail() {
  if (!activeTrailKey) return;
  activeTrailKey = "";
  updateTrailStatus();
  if (window.history?.replaceState) {
    const url = new URL(window.location.href);
    url.searchParams.delete("trail");
    window.history.replaceState({}, "", url.href);
  }
}

function replaceTrailUrl(key) {
  if (!window.history?.replaceState) return;
  window.history.replaceState({}, "", trailShareUrl(key));
}

function applyMapTrail(key, {updateUrl = true} = {}) {
  const trail = mapTrails[key];
  if (!trail) return;
  if (key === "geipan" || key === "france") {
    geipanLayerToggle.checked = true;
    geipanClusterLayer.setVisible(true);
  }
  if (key === "geipan-d") {
    geipanLayerToggle.checked = true;
    geipanClusterLayer.setVisible(true);
  }
  if (key === "canada-lac") {
    lacUfoLayerToggle.checked = true;
    lacUfoClusterLayer.setVisible(true);
  }
  activeClassificationFilter = trail.classification || "";
  selectedArchiveFolders = new Set();
  if (trail.archiveFolder) selectedArchiveFolders.add(trail.archiveFolder);
  updateArchiveTreeState();
  stateFilter.value = "";
  countryFilter.value = "";
  decadeFilter.value = "";
  yearFilter.value = "";
  monthFilter.value = "";
  searchInput.value = trail.query || "";
  if (trail.year && [...yearFilter.options].some(option => option.value === trail.year)) yearFilter.value = trail.year;
  if (trail.country && [...countryFilter.options].some(option => option.value === trail.country)) countryFilter.value = trail.country;
  if (evidenceOnlyToggle) evidenceOnlyToggle.checked = Boolean(trail.evidence);
  if (sourceRichToggle) sourceRichToggle.checked = false;
  activeTrailKey = key;
  setFilterPanelOpen(true);
  updateTrailStatus();
  if (updateUrl) replaceTrailUrl(key);
  render();
}

function applyInitialUrlFilters() {
  const query = urlParams.get("q");
  if (query) searchInput.value = query;
  if (urlParams.get("evidence") === "1" && evidenceOnlyToggle) evidenceOnlyToggle.checked = true;
  if (urlParams.get("source_rich") === "1" && sourceRichToggle) sourceRichToggle.checked = true;
  const setSelectFromUrl = (element, key) => {
    const value = urlParams.get(key) || "";
    if (value && [...element.options].some(option => option.value === value)) element.value = value;
  };
  applyInitialGeographyFilters();
  setSelectFromUrl(decadeFilter, "decade");
  setSelectFromUrl(yearFilter, "year");
  setSelectFromUrl(monthFilter, "month");
  setSelectFromUrl(recordExtentFilter, "record_extent");
  setSelectFromUrl(coordinateTierFilter, "coordinate_tier");
  setSelectFromUrl(sourceAccessFilter, "source_access");
  selectedArchiveFolders = new Set(
    urlParams.getAll("collection").filter(folder => featureArchiveFolders.size && [...featureArchiveFolders.values()].some(folders => folders.includes(folder)))
  );
  updateArchiveTreeState();
  const layers = urlParams.get("layers");
  if (layers !== null) {
    const enabled = new Set(layers.split(",").filter(Boolean));
    fold3LayerToggle.checked = enabled.has("fold3");
    aproLayerToggle.checked = enabled.has("archive");
    geipanLayerToggle.checked = enabled.has("geipan");
    lacUfoLayerToggle.checked = enabled.has("lac-ufo");
    clusterLayer.setVisible(fold3LayerToggle.checked);
    aproClusterLayer.setVisible(aproLayerToggle.checked);
    geipanClusterLayer.setVisible(geipanLayerToggle.checked);
    lacUfoClusterLayer.setVisible(lacUfoLayerToggle.checked);
  }
  if (deepLinkedRecordIds.size && sourceRichToggle) sourceRichToggle.checked = false;
  const trail = urlParams.get("trail");
  if (trail) {
    applyMapTrail(trail, {updateUrl: false});
    return true;
  }
  return Boolean(query || urlParams.get("evidence") === "1" || urlParams.get("year") || urlParams.get("month") || selectedArchiveFolders.size || deepLinkedRecordIds.size);
}

function groupSourceLinks(sources) {
  const grouped = new Map();
  for (const source of sources) {
    const prn = String(source.ufocat_prn || source.record_id || "");
    if (!prn) continue;
    source.archive_folder = archiveFolderForSource(source);
    if (!grouped.has(prn)) grouped.set(prn, []);
    grouped.get(prn).push(source);
  }
  for (const links of grouped.values()) {
    links.sort((left, right) =>
      String(left.source_label || "").localeCompare(String(right.source_label || "")) ||
      String(left.issue_label || "").localeCompare(String(right.issue_label || "")) ||
      String(left.citation_raw || "").localeCompare(String(right.citation_raw || ""))
    );
  }
  return grouped;
}

function sourcesHtml(properties) {
  const sources = sourcesForRecordId(properties.RecordId);
  if (!sources.length) return `<p class="source-detail">No public archive source links are available for this UFOCAT record yet.</p>`;
  const byLabel = new Map();
  for (const source of sources) {
    const label = archiveFolderForSource(source);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(source);
  }
  return [...byLabel.entries()].map(([label, rows]) => `
    <section class="source-group">
      <div class="source-group-heading">
        <h${Math.min(6, 4)} class="source-group-title">${escapeHtml(label)}</h${Math.min(6, 4)}>
        <a class="source-group-search" href="${escapeHtml(archiveSearchQueryUrl(label))}">Search this source</a>
      </div>
      ${rows.map((source) => {
        const detailParts = [
          source.issue_label,
          source.citation_raw ? `citation ${source.citation_raw}` : "",
        ].filter(Boolean);
        const trailStats = sourceTrailStats(source);
        const actionUrl = source.evidence_url || source.online_source_url;
        const searchUrl = archiveSearchUrl(source);
        const action = actionUrl && isAllowedEvidenceUrl(actionUrl)
          ? `<div class="popup-links">
              <button class="inline-link evidence-view-button" type="button"
                data-evidence-url="${escapeHtml(actionUrl)}"
                data-evidence-title="${escapeHtml(source.source_label || "Archive source")}"
                data-evidence-meta="${escapeHtml(evidenceMeta(source))}">View beside map</button>
              <a class="popup-link" href="${escapeHtml(actionUrl)}" target="_blank" rel="noopener">Open in new tab</a>
              ${searchUrl ? `<a class="popup-link primary-source-link" href="${escapeHtml(searchUrl)}">Open in archive search</a>` : ""}
            </div>`
          : searchUrl
            ? `<div class="popup-links"><a class="popup-link primary-source-link" href="${escapeHtml(searchUrl)}">Open in archive search</a></div>`
            : "";
        return `<div class="source-row">
          <p class="source-detail">${escapeHtml(detailParts.join(" | ") || source.source_label || "Archive source")}</p>
          <p class="source-trail-stats">${trailStats.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</p>
          ${action}
        </div>`;
      }).join("")}
    </section>
  `).join("");
}

function ufocatCardHtml(properties, headingLevel = 2) {
  const title = properties.Location || properties.RecordId || "UFOCAT record";
  const headingTag = `h${headingLevel}`;
  const sourceCount = sourcesForRecordId(properties.RecordId).length;
  const sourceCountBadge = sourceCount ? `<span class="source-count">${sourceCount.toLocaleString()} source link${sourceCount === 1 ? "" : "s"}</span>` : "";
  return `
    <p class="source-label">Record linked to sources in the Isaac Koi archive ${sourceCountBadge}</p>
    <${headingTag} class="popup-title">${escapeHtml(title)}</${headingTag}>
    <dl class="popup-meta">
      <dt>Date</dt><dd>${escapeHtml(formatCaseDate(properties))}</dd>
      ${optionalMetaRow("Time", properties.Time)}
      ${optionalMetaRow("Location", properties.Location)}
      ${optionalMetaRow("Names", properties.Names)}
      ${optionalMetaRow("Hynek", properties.Hynek)}
      ${optionalMetaRow("Vallee", properties.Vallee)}
      ${optionalMetaRow("Country", properties.Country)}
      ${optionalMetaRow("State / province", properties.StateProvince)}
      ${optionalMetaRow("Coordinate confidence", coordinateConfidenceText(coordinateTier(properties)))}
      ${optionalMetaRow("Coordinate precision", properties.CoordinatePrecision)}
      ${optionalMetaRow("Uncertainty radius", properties.CoordinateUncertaintyKm ? `${properties.CoordinateUncertaintyKm} km` : "")}
      <dt>UFOCAT PRN</dt><dd>${escapeHtml(properties.RecordId)}</dd>
    </dl>
    ${mapSearchActions(properties)}
    <div class="source-section">
      <p class="source-section-title">Sources</p>
      ${sourcesHtml(properties)}
    </div>
    ${casePermalinkMarkup(properties)}
    ${relatedCasesMarkup(properties)}
  `;
}

function sourceFirstCardHtml(properties, headingLevel = 2) {
  const title = properties.Location || properties.RecordId || "Source-first sighting";
  const headingTag = `h${headingLevel}`;
  const sourceCount = sourcesForRecordId(properties.RecordId).length;
  const sourceCountBadge = sourceCount ? `<span class="source-count">${sourceCount.toLocaleString()} source link${sourceCount === 1 ? "" : "s"}</span>` : "";
  return `
    <p class="source-label">Local source-first sighting extracted from archive documents ${sourceCountBadge}</p>
    <${headingTag} class="popup-title">${escapeHtml(title)}</${headingTag}>
    <dl class="popup-meta">
      <dt>Date</dt><dd>${escapeHtml(formatCaseDate(properties))}</dd>
      ${optionalMetaRow("Date precision", properties.DatePrecision)}
      ${optionalMetaRow("Location", properties.Location)}
      ${optionalMetaRow("Country", properties.Country)}
      ${optionalMetaRow("State / province", properties.StateProvince)}
      ${optionalMetaRow("Coordinate precision", properties.CoordinatePrecision)}
      ${optionalMetaRow("Catalogue crossrefs", properties.CatalogCrossrefs)}
      <dt>Event ID</dt><dd>${escapeHtml(properties.RecordId)}</dd>
    </dl>
    ${mapSearchActions(properties)}
    <div class="source-section">
      <p class="source-section-title">Sources</p>
      ${sourcesHtml(properties)}
    </div>
    ${casePermalinkMarkup(properties)}
    ${relatedCasesMarkup(properties)}
  `;
}

function popupHtml(properties) {
  return caseCardHtml(properties, 2);
}

function sortedMembers(members) {
  return [...members].sort((a, b) => {
    const left = a.getProperties();
    const right = b.getProperties();
    return String(left.Date || left.RawDate || "").localeCompare(String(right.Date || right.RawDate || "")) ||
      String(left.Location || "").localeCompare(String(right.Location || "")) ||
      String(left.Fold3ImageNumber || "").localeCompare(String(right.Fold3ImageNumber || ""));
  });
}

function membersShareCoordinate(members) {
  const coordinates = new Set(
    members.map((member) => {
      const [x, y] = member.getGeometry().getCoordinates();
      return `${x.toFixed(3)},${y.toFixed(3)}`;
    })
  );
  return coordinates.size === 1;
}

function multiPopupHtml(members) {
  const sorted = sortedMembers(members);
  const first = sorted[0]?.getProperties() || {};
  const location = first.Location || "this location";
  const count = sorted.length.toLocaleString();
  const cards = sorted
    .map((member) => `<article class="case-card">${caseCardHtml(member.getProperties(), 3)}</article>`)
    .join("");

  return `
    <h2 class="popup-title">${count} records at ${escapeHtml(location)}</h2>
    <p class="popup-summary">These records share the same mapped position, so they are shown together here.</p>
    <div class="case-list">${cards}</div>
  `;
}

function passesFilters(feature, {ignoreTime = false, ignoreArchive = false} = {}) {
  const p = feature.properties;
  const query = searchInput.value.trim().toLowerCase();
  const state = stateFilter.value;
  const country = countryFilter.value;
  const decade = decadeFilter.value;
  const year = yearFilter.value;
  const month = monthFilter.value;
  const parts = dateParts(p);

  if (deepLinkedRecordIds.size && !deepLinkedRecordIds.has(String(p.RecordId || p.Fold3ImageNumber || ""))) return false;
  if (activeClassificationFilter && String(p.Classification || "").toUpperCase() !== activeClassificationFilter) return false;
  if (!ignoreArchive && selectedArchiveFolders.size && !archiveFoldersForFeature(feature).some((folder) => selectedArchiveFolders.has(folder))) return false;
  if (state && p.StateProvince !== state) return false;
  if (country && p.Country !== country) return false;
  if (!ignoreTime && decade && decadeFor(p) !== decade) return false;
  if (!ignoreTime && year && parts.year !== year) return false;
  if (!ignoreTime && month && parts.month !== month) return false;
  if (recordExtentFilter?.value && p.RecordExtent !== recordExtentFilter.value) return false;
  if (coordinateTierFilter?.value && p.CoordinateTier !== coordinateTierFilter.value) return false;
  if (sourceAccessFilter?.value && p.SourceAccess !== sourceAccessFilter.value) return false;
  if (evidenceOnlyToggle?.checked && !hasOnlineEvidence(feature)) return false;
  if (sourceRichToggle?.checked && sourceLinkCount(feature) < 2) return false;
  if (query && !p.SearchText.includes(query)) return false;
  return true;
}

function featureToOl(feature) {
  if (olFeatureCache.has(feature)) return olFeatureCache.get(feature);
  const [lon, lat] = feature.geometry.coordinates;
  const olFeature = new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
    ...feature.properties,
  });
  olFeatureCache.set(feature, olFeature);
  return olFeature;
}

function activeDataFilterCount() {
  return [
    deepLinkedRecordIds.size ? "record" : "",
    searchInput.value.trim(),
    selectedArchiveFolders.size ? "archive" : "",
    stateFilter.value,
    countryFilter.value,
    decadeFilter.value,
    yearFilter.value,
    monthFilter.value,
    recordExtentFilter?.value,
    coordinateTierFilter?.value,
    sourceAccessFilter?.value,
    evidenceOnlyToggle?.checked ? "evidence" : "",
    sourceRichToggle?.checked ? "source-rich" : "",
    [fold3LayerToggle, aproLayerToggle, geipanLayerToggle, lacUfoLayerToggle].every(toggle => toggle.checked) ? "" : "layers",
  ].filter(Boolean).length;
}

function updateFilterSummary() {
  const count = activeDataFilterCount();
  activeFilterCount.textContent = String(count);
  activeFilterCount.hidden = count === 0;
  resetButton.hidden = count === 0;
  controlBar?.classList.toggle("has-active-filters", count > 0);
}

function setFilterPanelOpen(isOpen) {
  advancedFilters.hidden = !isOpen;
  filterToggle.setAttribute("aria-expanded", String(isOpen));
}

function syncFilterUrl() {
  if (!dataReady || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  const setOrDelete = (key, value) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  setOrDelete("q", searchInput.value.trim());
  setOrDelete("state", stateFilter.value);
  setOrDelete("country", countryFilter.value);
  setOrDelete("decade", decadeFilter.value);
  setOrDelete("year", yearFilter.value);
  setOrDelete("month", monthFilter.value);
  setOrDelete("record_extent", recordExtentFilter?.value);
  setOrDelete("coordinate_tier", coordinateTierFilter?.value);
  setOrDelete("source_access", sourceAccessFilter?.value);
  setOrDelete("evidence", evidenceOnlyToggle?.checked ? "1" : "");
  setOrDelete("source_rich", sourceRichToggle?.checked ? "1" : "");
  url.searchParams.delete("collection");
  [...selectedArchiveFolders].sort().forEach(folder => url.searchParams.append("collection", folder));
  const enabledLayers = [
    fold3LayerToggle.checked ? "fold3" : "",
    aproLayerToggle.checked ? "archive" : "",
    geipanLayerToggle.checked ? "geipan" : "",
    lacUfoLayerToggle.checked ? "lac-ufo" : "",
  ].filter(Boolean);
  if (enabledLayers.length === 4) url.searchParams.delete("layers");
  else url.searchParams.set("layers", enabledLayers.join(","));
  if (!activeTrailKey) url.searchParams.delete("trail");
  window.history.replaceState({}, "", url.href);
}

function render() {
  const allEnabledFeatures = enabledFeatures();
  const filtered = fold3LayerToggle.checked ? rawFeatures.filter(passesFilters) : [];
  const filteredApro = aproLayerToggle.checked ? aproFeatures.filter(passesFilters) : [];
  const filteredGeipan = geipanLayerToggle.checked ? geipanFeatures.filter(passesFilters) : [];
  const filteredLacUfo = lacUfoLayerToggle.checked ? lacUfoFeatures.filter(passesFilters) : [];
  vectorSource.clear(true);
  vectorSource.addFeatures(filtered.map(featureToOl));
  aproVectorSource.clear(true);
  aproVectorSource.addFeatures(filteredApro.map(featureToOl));
  geipanVectorSource.clear(true);
  geipanVectorSource.addFeatures(filteredGeipan.map(featureToOl));
  lacUfoVectorSource.clear(true);
  lacUfoVectorSource.addFeatures(filteredLacUfo.map(featureToOl));
  const visibleFeatures = [...filtered, ...filteredApro, ...filteredGeipan, ...filteredLacUfo];
  currentFilteredFeatures = visibleFeatures;
  overviewVectorSource.clear(true);
  overviewVectorSource.addFeatures(visibleFeatures.map(featureToOl));
  visibleCount.textContent = visibleFeatures.length.toLocaleString();
  totalCount.textContent = (
    (fold3LayerToggle.checked ? rawFeatures.length : 0) +
    (aproLayerToggle.checked ? aproFeatures.length : 0) +
    (geipanLayerToggle.checked ? geipanFeatures.length : 0) +
    (lacUfoLayerToggle.checked ? lacUfoFeatures.length : 0)
  ).toLocaleString();
  if (evidenceCount) evidenceCount.textContent = visibleFeatures.filter(hasOnlineEvidence).length.toLocaleString();
  if (sourceRichPanel && !sourceRichPanel.hidden) renderSourceRichList(visibleFeatures);
  if (timelineDisclosure?.open) renderTimeline(allEnabledFeatures, visibleFeatures);
  closeMapPopup();
  updateFilterSummary();
  syncClusterLayerVisibility();
  updateMapAreaSearchStatus();
  if (!dataReady) {
    updateMapState({
      title: visibleFeatures.length ? "Loading source links…" : "Loading mapped cases…",
      detail: visibleFeatures.length ? "The map is ready; archive evidence is still being connected." : "Preparing the public research map.",
      loading: true,
    });
  } else if (!visibleFeatures.length) {
    updateMapState({
      title: "No cases match these filters",
      detail: "Broaden the search or reset the map to see all available cases.",
      action: "Reset filters",
    });
  } else {
    updateMapState();
  }
  syncFilterUrl();
  syncArchiveSearchLinks();
}

function isUsefulCountryOption(country, count) {
  if (!country) return false;
  if (count >= 2) return true;
  return country.length <= 42 && !/[0-9()#]/.test(country);
}

function archiveFoldersForFeature(feature) {
  const recordId = String(feature.properties.RecordId || feature.properties.Fold3ImageNumber || "");
  if (featureArchiveFolders.has(recordId)) return featureArchiveFolders.get(recordId);
  if (isUfocatFeature(feature.properties) || isSourceFirstFeature(feature.properties) || isGeipanFeature(feature.properties) || isLacUfoFeature(feature.properties)) {
    const folders = (ufocatSourceLinks.get(String(feature.properties.RecordId || "")) || [])
      .map(archiveFolderForSource)
      .filter(Boolean);
    return [...new Set(folders)];
  }
  return [FOLD3_ARCHIVE_FOLDER];
}

function populateArchiveFolderFilter(features) {
  const counts = new Map();
  for (const feature of features) {
    for (const folder of archiveFoldersForFeature(feature)) {
      counts.set(folder, (counts.get(folder) || 0) + 1);
    }
  }
  populateArchiveTree(counts);
}

function makeArchiveTreeNode(label = "", path = "") {
  return { label, path, count: 0, children: new Map() };
}

function buildArchiveTree(counts) {
  const root = makeArchiveTreeNode();
  for (const [folder, count] of counts.entries()) {
    const parts = folder.split(" / ").filter(Boolean);
    let node = root;
    let path = "";
    for (const part of parts) {
      path = path ? `${path} / ${part}` : part;
      if (!node.children.has(part)) node.children.set(part, makeArchiveTreeNode(part, path));
      node = node.children.get(part);
      node.count += count;
    }
  }
  return root;
}

function childNodes(node) {
  return [...node.children.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function leafPaths(node) {
  if (!node.children.size) return [node.path];
  return childNodes(node).flatMap(leafPaths);
}

function renderArchiveNode(node, depth = 0) {
  const row = document.createElement("div");
  row.className = "archive-tree-row";
  row.style.setProperty("--depth", depth);

  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.path = node.path;
  checkbox.dataset.leaves = JSON.stringify(leafPaths(node));
  label.appendChild(checkbox);

  const text = document.createElement("span");
  text.textContent = `${node.label} (${node.count.toLocaleString()})`;
  label.appendChild(text);
  row.appendChild(label);

  const wrapper = document.createElement("div");
  wrapper.appendChild(row);
  for (const child of childNodes(node)) wrapper.appendChild(renderArchiveNode(child, depth + 1));
  return wrapper;
}

function updateArchiveTreeState() {
  archiveTree.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    const leaves = JSON.parse(checkbox.dataset.leaves || "[]");
    const checkedCount = leaves.filter((leaf) => selectedArchiveFolders.has(leaf)).length;
    checkbox.checked = checkedCount > 0 && checkedCount === leaves.length;
    checkbox.indeterminate = checkedCount > 0 && checkedCount < leaves.length;
  });
}

function populateArchiveTree(counts) {
  archiveTree.innerHTML = "";
  const root = buildArchiveTree(counts);
  for (const node of childNodes(root)) archiveTree.appendChild(renderArchiveNode(node));
  updateArchiveTreeState();
}

function setArchiveSelection(checkbox, checked) {
  const leaves = JSON.parse(checkbox.dataset.leaves || "[]");
  leaves.forEach((leaf) => {
    if (checked) selectedArchiveFolders.add(leaf);
    else selectedArchiveFolders.delete(leaf);
  });
  if (checked && leaves.some((leaf) => leaf.startsWith("Documents / "))) {
    fold3LayerToggle.checked = true;
    clusterLayer.setVisible(true);
  }
  if (checked && leaves.some((leaf) => leaf.startsWith("Documents / France / GEIPAN"))) {
    geipanLayerToggle.checked = true;
    geipanClusterLayer.setVisible(true);
  }
  if (checked && leaves.some((leaf) => leaf.startsWith("Documents / Canada / Library and Archives Canada UFO files"))) {
    lacUfoLayerToggle.checked = true;
    lacUfoClusterLayer.setVisible(true);
  }
  if (checked && leaves.some((leaf) => leaf.startsWith("Magazines / "))) {
    aproLayerToggle.checked = true;
    aproClusterLayer.setVisible(true);
  }
  updateArchiveTreeState();
  render();
}

function populateFilters(features) {
  const states = [...new Set(features.map((f) => f.properties.StateProvince).filter(Boolean))].sort();
  const countryCounts = new Map();
  features.forEach((feature) => {
    const country = feature.properties.Country;
    if (country) countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
  });
  const countries = [...countryCounts.entries()]
    .filter(([country, count]) => isUsefulCountryOption(country, count))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const decades = [...new Set(features.map((f) => decadeFor(f.properties)))].sort();
  const years = [...new Set(features.map((f) => dateParts(f.properties).year).filter(Boolean))].sort();
  const months = [...new Set(features.map((f) => dateParts(f.properties).month).filter(Boolean))].sort();
  states.forEach((state, index) => {
    const option = document.createElement("option");
    option.value = state;
    option.textContent = state;
    stateFilter.appendChild(option);
    stateColors.set(state, statePalette[index % statePalette.length]);
  });
  countries.forEach(([country, count]) => {
    const option = document.createElement("option");
    option.value = country;
    option.textContent = `${country} (${count.toLocaleString()})`;
    countryFilter.appendChild(option);
  });
  decades.forEach((decade) => {
    const option = document.createElement("option");
    option.value = decade;
    option.textContent = decade;
    decadeFilter.appendChild(option);
  });
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    yearFilter.appendChild(option);
  });
  months.forEach((month) => {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = monthNames[Number(month) - 1];
    monthFilter.appendChild(option);
  });
  populateArchiveFolderFilter(features);
}

function setColorMode(mode) {
  colorMode = mode;
  styleCache.clear();
  colorUniform?.classList.toggle("active", mode === "uniform");
  colorByDecade.classList.toggle("active", mode === "decade");
  colorByState.classList.toggle("active", mode === "state");
  clusterLayer.changed();
  aproClusterLayer.changed();
  geipanClusterLayer.changed();
  lacUfoClusterLayer.changed();
  overviewClusterLayer.changed();
}

map.on("click", (event) => {
  const hit = map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
  if (!hit) {
    closeMapPopup();
    return;
  }

  const members = hit.get("features") || [];
  if (members.length > 1) {
    if (membersShareCoordinate(members)) {
      popupContent.innerHTML = multiPopupHtml(members);
      window.IsaacKoiResearch?.render();
      positionPopup(event.coordinate);
      return;
    }

    const extent = ol.extent.createEmpty();
    members.forEach((member) => ol.extent.extend(extent, member.getGeometry().getExtent()));
    const zoom = map.getView().getZoom() || 0;
    if (zoom >= 13 || (ol.extent.getWidth(extent) < 1000 && ol.extent.getHeight(extent) < 1000)) {
      popupContent.innerHTML = multiPopupHtml(members);
      window.IsaacKoiResearch?.render();
      positionPopup(event.coordinate);
      return;
    }

    map.getView().fit(extent, { padding: [60, 60, 60, 60], duration: 180, maxZoom: 13 });
    return;
  }

  const properties = members[0]?.getProperties();
  if (!properties) return;
  popupContent.innerHTML = popupHtml(properties);
  window.IsaacKoiResearch?.render();
  positionPopup(event.coordinate);
});

popupClose.addEventListener("click", closeMapPopup);
evidencePanelClose.addEventListener("click", closeEvidencePanel);
popupContent.addEventListener("click", async (event) => {
  const citationButton = event.target?.closest("[data-copy-case-citation]");
  if (citationButton) {
    const feature = featureByRecordId(citationButton.dataset.copyCaseCitation || "");
    if (!feature) return;
    try {
      await writeClipboardText(mapCaseCitation(feature.properties || {}));
      citationButton.textContent = "Citation copied";
      window.setTimeout(() => { citationButton.textContent = "Copy citation"; }, 1500);
    } catch (error) {
      citationButton.textContent = "Copy unavailable";
    }
    return;
  }
  const button = event.target?.closest(".evidence-view-button");
  if (!button) return;
  openEvidencePanel(button.dataset.evidenceUrl, button.dataset.evidenceTitle, button.dataset.evidenceMeta);
});
sourceRichList?.addEventListener("click", (event) => {
  const button = event.target?.closest("[data-record-id]");
  const feature = featureByRecordId(button?.dataset.recordId || "");
  if (feature) openFeaturePopup(feature);
});
mappingDataPanel?.addEventListener("click", (event) => {
  const button = event.target?.closest("[data-copy-source-link-id]");
  if (!button) return;
  const stableId = button.dataset.copySourceLinkId || "";
  navigator.clipboard?.writeText(stableId).then(() => {
    const original = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1100);
  }).catch(() => {
    button.textContent = stableId;
  });
});
function stopTimelinePlayback() {
  if (timelinePlaybackTimer) window.clearInterval(timelinePlaybackTimer);
  timelinePlaybackTimer = null;
  if (timelinePlay) {
    timelinePlay.textContent = "Play";
    timelinePlay.setAttribute("aria-pressed", "false");
  }
}

function advanceTimelinePlayback() {
  const years = [...yearTimeline.querySelectorAll("[data-timeline-year]")].map(button => button.dataset.timelineYear);
  if (!years.length) {
    stopTimelinePlayback();
    return;
  }
  const currentIndex = years.indexOf(yearFilter.value);
  yearFilter.value = years[(currentIndex + 1) % years.length];
  decadeFilter.value = "";
  activeClassificationFilter = "";
  clearActiveTrail();
  render();
}

function handleTimelineClick(event) {
  const yearButton = event.target?.closest("[data-timeline-year]");
  const monthButton = event.target?.closest("[data-timeline-month]");
  const collectionButton = event.target?.closest("[data-timeline-collection]");
  if (!yearButton && !monthButton && !collectionButton) return;
  stopTimelinePlayback();
  if (yearButton) {
    yearFilter.value = yearFilter.value === yearButton.dataset.timelineYear ? "" : yearButton.dataset.timelineYear;
    decadeFilter.value = "";
  } else if (monthButton) {
    monthFilter.value = monthFilter.value === monthButton.dataset.timelineMonth ? "" : monthButton.dataset.timelineMonth;
  } else {
    const folder = collectionButton.dataset.timelineCollection;
    selectedArchiveFolders = selectedArchiveFolders.has(folder) ? new Set() : new Set([folder]);
    updateArchiveTreeState();
  }
  activeClassificationFilter = "";
  clearActiveTrail();
  render();
}

yearTimeline?.addEventListener("click", handleTimelineClick);
monthTimeline?.addEventListener("click", handleTimelineClick);
collectionTimeline?.addEventListener("click", handleTimelineClick);
timelinePlay?.addEventListener("click", () => {
  if (timelinePlaybackTimer) {
    stopTimelinePlayback();
    return;
  }
  timelinePlay.textContent = "Pause";
  timelinePlay.setAttribute("aria-pressed", "true");
  advanceTimelinePlayback();
  timelinePlaybackTimer = window.setInterval(advanceTimelinePlayback, 1200);
});
timelineClear?.addEventListener("click", () => {
  stopTimelinePlayback();
  decadeFilter.value = "";
  yearFilter.value = "";
  monthFilter.value = "";
  selectedArchiveFolders = new Set();
  updateArchiveTreeState();
  clearActiveTrail();
  render();
});
mobileTimelineToggle?.addEventListener("click", () => {
  timelineDisclosure?.classList.add("mobile-requested");
  if (timelineDisclosure) timelineDisclosure.open = true;
  if (mobileSurfaceMenu) mobileSurfaceMenu.open = false;
});
timelineDisclosure?.addEventListener("toggle", () => {
  if (timelineDisclosure.open) renderTimeline(enabledFeatures(), currentFilteredFeatures);
  if (!timelineDisclosure.open) timelineDisclosure.classList.remove("mobile-requested", "desktop-requested");
});
desktopTimelineToggle?.addEventListener("click", () => {
  timelineDisclosure?.classList.add("desktop-requested");
  if (timelineDisclosure) timelineDisclosure.open = true;
  if (desktopSurfaceMenu) desktopSurfaceMenu.open = false;
});
desktopCoverageToggle?.addEventListener("click", () => {
  statsDisclosure?.classList.add("desktop-requested");
  if (statsDisclosure) statsDisclosure.open = true;
  if (desktopSurfaceMenu) desktopSurfaceMenu.open = false;
});
statsDisclosure?.addEventListener("toggle", () => {
  if (!statsDisclosure.open) statsDisclosure.classList.remove("desktop-requested");
});
filterToggle.addEventListener("click", () => {
  setFilterPanelOpen(advancedFilters.hidden);
});
sourceRichPanelToggle?.addEventListener("click", () => {
  setAuxiliaryPanel(sourceRichPanel?.hidden ? "source-rich" : "");
});
mappingDataPanelToggle?.addEventListener("click", () => {
  setAuxiliaryPanel(mappingDataAside?.hidden ? "mapping-data" : "");
});
desktopMappingDataToggle?.addEventListener("click", () => {
  setAuxiliaryPanel(mappingDataAside?.hidden ? "mapping-data" : "");
  const menu = desktopMappingDataToggle.closest("details");
  if (menu) menu.open = false;
});
mobileMappingDataToggle?.addEventListener("click", () => {
  setAuxiliaryPanel(mappingDataAside?.hidden ? "mapping-data" : "");
  if (mobileSurfaceMenu) mobileSurfaceMenu.open = false;
});
sourceRichPanelClose?.addEventListener("click", () => setAuxiliaryPanel());
mappingDataPanelClose?.addEventListener("click", () => setAuxiliaryPanel());
searchInput.addEventListener("input", () => {
  activeClassificationFilter = "";
  clearActiveTrail();
  if (searchRenderTimer) window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(render, 120);
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (searchRenderTimer) window.clearTimeout(searchRenderTimer);
  render();
  focusFilteredCases();
});
archiveTree.addEventListener("change", (event) => {
  if (event.target?.matches("input[type='checkbox']")) {
    clearActiveTrail();
    setArchiveSelection(event.target, event.target.checked);
  }
});
stateFilter.addEventListener("change", () => { clearActiveTrail(); render(); });
countryFilter.addEventListener("change", () => { clearActiveTrail(); render(); });
decadeFilter.addEventListener("change", () => { stopTimelinePlayback(); clearActiveTrail(); render(); });
yearFilter.addEventListener("change", () => { stopTimelinePlayback(); clearActiveTrail(); render(); });
monthFilter.addEventListener("change", () => { stopTimelinePlayback(); clearActiveTrail(); render(); });
[recordExtentFilter, coordinateTierFilter, sourceAccessFilter].forEach(filter => {
  filter?.addEventListener("change", () => { clearActiveTrail(); render(); });
});
fold3LayerToggle.addEventListener("change", () => {
  clearActiveTrail();
  clusterLayer.setVisible(fold3LayerToggle.checked);
  render();
});
aproLayerToggle.addEventListener("change", () => {
  clearActiveTrail();
  aproClusterLayer.setVisible(aproLayerToggle.checked);
  render();
});
geipanLayerToggle.addEventListener("change", () => {
  clearActiveTrail();
  geipanClusterLayer.setVisible(geipanLayerToggle.checked);
  render();
});
lacUfoLayerToggle.addEventListener("change", () => {
  clearActiveTrail();
  lacUfoClusterLayer.setVisible(lacUfoLayerToggle.checked);
  render();
});
evidenceOnlyToggle?.addEventListener("change", render);
sourceRichToggle?.addEventListener("change", render);
document.querySelectorAll("[data-map-trail]").forEach(button => {
  button.addEventListener("click", () => applyMapTrail(button.dataset.mapTrail));
});
copyTrailLink?.addEventListener("click", async () => {
  const url = trailShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    copyTrailLink.textContent = "Copied";
    window.setTimeout(() => { copyTrailLink.textContent = "Copy trail link"; }, 1600);
  } catch (error) {
    if (window.history?.replaceState && activeTrailKey) window.history.replaceState({}, "", url);
  }
});
colorUniform?.addEventListener("click", () => setColorMode("uniform"));
colorByDecade.addEventListener("click", () => setColorMode("decade"));
colorByState.addEventListener("click", () => setColorMode("state"));
resetButton.addEventListener("click", () => {
  stopTimelinePlayback();
  searchInput.value = "";
  activeClassificationFilter = "";
  activeTrailKey = "";
  selectedArchiveFolders = new Set();
  updateArchiveTreeState();
  stateFilter.value = "";
  countryFilter.value = "";
  decadeFilter.value = "";
  yearFilter.value = "";
  monthFilter.value = "";
  if (recordExtentFilter) recordExtentFilter.value = "";
  if (coordinateTierFilter) coordinateTierFilter.value = "";
  if (sourceAccessFilter) sourceAccessFilter.value = "";
  fold3LayerToggle.checked = true;
  aproLayerToggle.checked = true;
  geipanLayerToggle.checked = true;
  lacUfoLayerToggle.checked = true;
  if (evidenceOnlyToggle) evidenceOnlyToggle.checked = false;
  if (sourceRichToggle) sourceRichToggle.checked = false;
  setColorMode("uniform");
  clusterLayer.setVisible(true);
  aproClusterLayer.setVisible(true);
  geipanClusterLayer.setVisible(true);
  lacUfoClusterLayer.setVisible(true);
  setFilterPanelOpen(false);
  updateTrailStatus();
  map.getView().animate({ center: ol.proj.fromLonLat([0, 20]), zoom: 2, duration: 180 });
  render();
});

searchMapArea?.addEventListener("click", () => {
  const result = mapAreaSearchUrl();
  if (result.url) window.location.href = result.url;
});

mapStateAction?.addEventListener("click", () => {
  if (mapStateAction.dataset.action === "retry") {
    window.location.reload();
    return;
  }
  resetButton.click();
});

map.on("moveend", () => {
  syncClusterLayerVisibility();
  updateMapAreaSearchStatus();
});

function compressedMapDataUrl(resolvedUrl) {
  const url = new URL(resolvedUrl);
  url.pathname = `${url.pathname}.gz`;
  return url.href;
}

async function readCompressedMapJson(response) {
  if (!response.body || !("DecompressionStream" in window)) {
    throw new Error("This browser cannot decompress the optimized map data.");
  }
  const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(decompressed).text());
}

async function fetchJson(url) {
  const resolvedUrl = mapDataUrl(url);
  const relativePath = String(url).split(/[?#]/, 1)[0].replace(/^\/+/, "");
  if (COMPRESSED_MAP_DATA_FILES.has(relativePath) && "DecompressionStream" in window) {
    const compressedUrl = compressedMapDataUrl(resolvedUrl);
    try {
      const compressedResponse = await fetchMapResponse(compressedUrl);
      if (compressedResponse.ok) {
        document.documentElement.dataset.mapDataEncoding = "gzip";
        return await readCompressedMapJson(compressedResponse);
      }
      if (compressedResponse.status !== 404) {
        throw new Error(`Unable to load ${compressedUrl}`);
      }
    } catch (error) {
      console.warn(`Compressed map data unavailable for ${relativePath}; using JSON fallback.`, error);
    }
  }
  const response = await fetchMapResponse(resolvedUrl);
  if (!response.ok) throw new Error(`Unable to load ${resolvedUrl}`);
  if (!document.documentElement.dataset.mapDataEncoding) {
    document.documentElement.dataset.mapDataEncoding = "json-fallback";
  }
  return response.json();
}

function fetchUfocatSources() {
  if (!localMode) return fetchJson(PUBLIC_UFOCAT_SOURCES_URL);
  return fetchJson(LOCAL_UFOCAT_SOURCES_URL).catch((error) => {
    console.warn("Local source sidecar unavailable; falling back to public evidence links.", error);
    return fetchJson(PUBLIC_UFOCAT_SOURCES_URL);
  });
}

function fetchSourceFirstEvents() {
  const dataUrl = localMode ? SOURCE_FIRST_LOCAL_DATA_URL : SOURCE_FIRST_PUBLIC_DATA_URL;
  return fetchJson(dataUrl).catch((error) => {
    console.warn("Source-first event data unavailable.", error);
    return { features: [] };
  });
}

function fetchSourceFirstSources() {
  const sourcesUrl = localMode ? SOURCE_FIRST_LOCAL_SOURCES_URL : SOURCE_FIRST_PUBLIC_SOURCES_URL;
  return fetchJson(sourcesUrl).catch((error) => {
    console.warn("Source-first source sidecar unavailable.", error);
    return { records: [] };
  });
}

function fetchGeipanEvents() {
  return fetchJson(GEIPAN_DATA_URL).catch((error) => {
    console.warn("GEIPAN map layer unavailable.", error);
    return { features: [] };
  });
}

function fetchGeipanSources() {
  return fetchJson(GEIPAN_SOURCES_URL).catch((error) => {
    console.warn("GEIPAN source sidecar unavailable.", error);
    return { records: [] };
  });
}

function fetchLacUfoEvents() {
  return fetchJson(LAC_UFO_DATA_URL).catch((error) => {
    console.warn("LAC UFO map layer unavailable.", error);
    return { features: [] };
  });
}

function fetchLacUfoSources() {
  return fetchJson(LAC_UFO_SOURCES_URL).catch((error) => {
    console.warn("LAC UFO source sidecar unavailable.", error);
    return { records: [] };
  });
}

function fetchSourceLinkExportSummary() {
  return fetchJson(SOURCE_LINK_EXPORT_SUMMARY_URL).catch((error) => {
    console.warn("Source-link export summary unavailable.", error);
    return null;
  });
}

function fetchIncidentClusters() {
  return fetchJson(INCIDENT_CLUSTERS_URL).catch((error) => {
    console.warn("Incident clusters unavailable.", error);
    return {records: [], clusters: []};
  });
}

function fetchCaseDossiers() {
  return fetchJson(CASE_DOSSIERS_URL).catch((error) => {
    console.warn("Case dossier index unavailable.", error);
    return {dossiers: []};
  });
}

initializeMapDataRelease()
  .then(async () => {
    document.documentElement.dataset.mapEnrichment = "loading";
    const [fold3Data, aproData, sourceFirstData, geipanData, lacUfoData, caseDossiers] = await Promise.all([
      fetchJson(DATA_URL),
      fetchJson(APRO_DATA_URL),
      fetchSourceFirstEvents(),
      fetchGeipanEvents(),
      fetchLacUfoEvents(),
      fetchCaseDossiers(),
    ]);
    rawFeatures = fold3Data.features || [];
    aproFeatures = [...(aproData.features || []), ...(sourceFirstData.features || [])];
    geipanFeatures = geipanData.features || [];
    lacUfoFeatures = lacUfoData.features || [];
    caseDossierByRecordId = new Map((caseDossiers.dossiers || []).map(row => [String(row.record_id || ""), row]));
    featureArchiveFolders = new Map(
      rawFeatures.map((feature) => [
        String(feature.properties.RecordId || feature.properties.Fold3ImageNumber || ""),
        [FOLD3_ARCHIVE_FOLDER],
      ])
    );
    const allFeatures = [...rawFeatures, ...aproFeatures, ...geipanFeatures, ...lacUfoFeatures];
    populateFilters(allFeatures);
    applyInitialGeographyFilters();
    render();
    focusInitialScopeIfRequested();
    document.documentElement.dataset.mapCore = "ready";

    const [ufocatSourcesData, sourceFirstSources, geipanSources, lacUfoSources, exportSummary, incidentClusters] = await Promise.all([
      fetchUfocatSources(),
      fetchSourceFirstSources(),
      fetchGeipanSources(),
      fetchLacUfoSources(),
      fetchSourceLinkExportSummary(),
      fetchIncidentClusters(),
    ]);
    allPublicSourceRecords = [
      ...(ufocatSourcesData.records || ufocatSourcesData || []),
      ...(sourceFirstSources.records || sourceFirstSources || []),
      ...(geipanSources.records || geipanSources || []),
      ...(lacUfoSources.records || lacUfoSources || []),
    ];
    sourceLinkExportSummary = exportSummary;
    const clustersById = new Map((incidentClusters.clusters || []).map(cluster => [String(cluster.cluster_id || ""), cluster]));
    incidentClusterByRecordId = new Map((incidentClusters.records || []).map(row => {
      const cluster = clustersById.get(String(row.cluster_id || "")) || {};
      return [String(row.record_key || ""), {
        ...row,
        member_count: cluster.member_count || 0,
        collection_count: cluster.collection_count || 0,
        members: cluster.members || [],
      }];
    }));
    ufocatSourceLinks = groupSourceLinks(allPublicSourceRecords);
    featureArchiveFolders = new Map([
      ...rawFeatures.map((feature) => [String(feature.properties.RecordId || feature.properties.Fold3ImageNumber || ""), [FOLD3_ARCHIVE_FOLDER]]),
      ...aproFeatures.map((feature) => [String(feature.properties.RecordId || ""), archiveFoldersForFeature(feature)]),
      ...geipanFeatures.map((feature) => [String(feature.properties.RecordId || ""), archiveFoldersForFeature(feature)]),
      ...lacUfoFeatures.map((feature) => [String(feature.properties.RecordId || ""), archiveFoldersForFeature(feature)]),
    ]);
    const requestedArchiveFolders = urlParams.getAll("collection");
    if (requestedArchiveFolders.length) {
      selectedArchiveFolders = new Set(
        requestedArchiveFolders.filter(folder => [...featureArchiveFolders.values()].some(folders => folders.includes(folder)))
      );
    }
    populateArchiveFolderFilter(allFeatures);
    applyInitialUrlFilters();
    dataReady = true;
    document.documentElement.dataset.mapEnrichment = "ready";
    styleCache.clear();
    render();
    focusInitialScopeIfRequested();
    focusDeepLinkedRecords();
    window.setTimeout(openDeepLinkedEvidence, deepLinkedRecordIds.size > 1 ? 280 : 120);
  })
  .catch((error) => {
    visibleCount.textContent = "0";
    totalCount.textContent = "0";
    updateMapState({
      title: "The map could not be loaded",
      detail: "Check the connection, then try loading the public map again.",
      action: "Try again",
    });
    console.error(error);
  });
