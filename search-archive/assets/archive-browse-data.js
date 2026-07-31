(() => {
  "use strict";

  const AFU_PUBLIC_SEARCH_DATA_BASE = "https://files.afu.se/Downloads/search/";
  const searchDataMeta = document.querySelector('meta[name="afu-search-data-base"]')?.content.trim();
  const searchUiMeta = document.querySelector('meta[name="afu-search-ui-base"]')?.content.trim();
  const mapUiMeta = document.querySelector('meta[name="afu-map-ui-base"]')?.content.trim();
  const scriptBase = document.currentScript?.src
    ? new URL("../", document.currentScript.src)
    : new URL("./", window.location.href);
  const SEARCH_UI_BASE_URL = new URL(searchUiMeta || scriptBase.href, window.location.href);
  const MAP_UI_BASE_URL = new URL(mapUiMeta || "../mapview/", window.location.href);

  function isLocalPreview() {
    return window.location.protocol === "file:"
      || ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname.toLocaleLowerCase());
  }

  const previewParams = new URLSearchParams(window.location.search);
  const publicDataPreview = previewParams.get("publicData") === "1";
  const SEARCH_DATA_ROOT_URL = isLocalPreview() && !publicDataPreview
    ? new URL(SEARCH_UI_BASE_URL)
    : new URL(searchDataMeta || AFU_PUBLIC_SEARCH_DATA_BASE, window.location.href);
  let searchDataBaseUrl = SEARCH_DATA_ROOT_URL;
  let activeRelease = "";
  let loadPromise = null;

  function validatedReleaseDataUrl(pointer) {
    if (pointer?.schema_version !== 1 || pointer?.package_kind !== "search" || !pointer?.release_id) return null;
    const dataPath = String(pointer.data_path || "");
    if (!dataPath || dataPath.startsWith("/") || dataPath.includes("..") || !dataPath.endsWith("/")) return null;
    const resolved = new URL(dataPath, SEARCH_DATA_ROOT_URL);
    if (resolved.origin !== SEARCH_DATA_ROOT_URL.origin || !resolved.href.startsWith(SEARCH_DATA_ROOT_URL.href)) return null;
    return resolved;
  }

  async function initializeRelease() {
    if (isLocalPreview() && !publicDataPreview && previewParams.get("releaseData") !== "1") return;
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
      activeRelease = String(pointer.release_id);
      document.documentElement.dataset.archiveBrowseRelease = activeRelease;
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

  async function readOptionalJson(path) {
    try {
      return await readJson(path);
    } catch (error) {
      return null;
    }
  }

  async function readGzipJson(path) {
    if (!("DecompressionStream" in window)) throw new Error("This browser cannot read the compressed catalogue.");
    const resolvedUrl = new URL(path, searchDataBaseUrl).href;
    const response = await fetch(resolvedUrl, {mode: "cors", credentials: "omit"});
    if (!response.ok) throw new Error(`${resolvedUrl} returned HTTP ${response.status}`);
    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(decompressed).text());
  }

  function normalizeRow(entry, collection, issues) {
    const normalizedCollection = {
      ...collection,
      id: collection.id || entry.id,
      title: collection.title || entry.title || entry.id,
      path: entry.path,
      indexed_at_utc: collection.indexed_at_utc || entry.indexed_at_utc || "",
    };
    normalizedCollection.series = Array.isArray(normalizedCollection.series)
      ? normalizedCollection.series.map(series => ({
        ...series,
        collection_id: normalizedCollection.id,
        collection_title: normalizedCollection.title,
      }))
      : [];
    const normalizedIssues = (Array.isArray(issues) ? issues : []).map(issue => ({
      ...issue,
      collection_id: issue.collection_id || normalizedCollection.id,
      collection_title: issue.collection_title || normalizedCollection.title,
    }));
    return {collection: normalizedCollection, issues: normalizedIssues};
  }

  async function perCollectionRows(registry) {
    const rows = await Promise.all(registry.map(async entry => {
      try {
        const [collection, issues] = await Promise.all([
          readJson(`${entry.path}/collection.json`),
          readJson(`${entry.path}/issues.json`),
        ]);
        return normalizeRow(entry, collection, issues);
      } catch (error) {
        console.warn(`Skipping unavailable collection ${entry.id || entry.path}.`, error);
        return null;
      }
    }));
    return rows.filter(Boolean);
  }

  async function loadCatalogue() {
    await initializeRelease();
    const registry = await readJson("collections.json");
    if (!Array.isArray(registry) || !registry.length) throw new Error("The public collection registry is unavailable.");
    let rows = null;
    const descriptor = registry.find(entry => entry?.catalogue_bundle?.path)?.catalogue_bundle;
    if (descriptor?.path) {
      try {
        const payload = await readGzipJson(descriptor.path);
        if (payload?.schema_version !== 1 || !Array.isArray(payload.collections)) {
          throw new Error("The compact catalogue has an unsupported schema.");
        }
        const entryById = new Map(registry.map(entry => [String(entry.id || ""), entry]));
        rows = payload.collections.map(row => {
          const entry = entryById.get(String(row?.id || ""));
          return entry && row?.collection && Array.isArray(row?.issues)
            ? normalizeRow(entry, row.collection, row.issues)
            : null;
        }).filter(Boolean);
        document.documentElement.dataset.archiveBrowseLoadMode = "compact-bundle";
      } catch (error) {
        console.warn("Compact catalogue unavailable; loading collection files.", error);
      }
    }
    if (!rows?.length) {
      rows = await perCollectionRows(registry);
      document.documentElement.dataset.archiveBrowseLoadMode = "per-collection";
    }
    if (!rows.length) throw new Error("No public catalogue collections could be loaded.");
    const landingSummary = await readOptionalJson("data/collection_landing_summary.json");
    const summaryByCollection = new Map(
      (Array.isArray(landingSummary?.collections) ? landingSummary.collections : [])
        .map(row => [String(row.collection_id || ""), row])
    );
    return {
      activeRelease,
      collections: rows.map(row => row.collection),
      issues: rows.flatMap(row => row.issues),
      summaryByCollection,
    };
  }

  function load() {
    if (!loadPromise) loadPromise = loadCatalogue();
    return loadPromise;
  }

  function searchUrl({collection = "", query = "", fulltext = true} = {}) {
    const url = new URL(SEARCH_UI_BASE_URL);
    if (collection) url.searchParams.set("collection", collection);
    if (query) url.searchParams.set("q", query);
    if (fulltext) url.searchParams.set("fulltext", "1");
    if (query) url.searchParams.set("autorun", "1");
    return url.href;
  }

  function documentUrl(issue) {
    const url = new URL("document/", SEARCH_UI_BASE_URL);
    url.searchParams.set("id", issue.document_id || issue.id);
    if (issue.collection_id) url.searchParams.set("collection", issue.collection_id);
    return url.href;
  }

  function collectionsUrl(collection = "") {
    const url = new URL("collections/", SEARCH_UI_BASE_URL);
    if (collection) url.searchParams.set("collection", collection);
    return url.href;
  }

  function timelineUrl({collection = "", mode = "documents", decade = ""} = {}) {
    const url = new URL("timeline/", SEARCH_UI_BASE_URL);
    if (collection) url.searchParams.set("collection", collection);
    if (mode !== "documents") url.searchParams.set("mode", mode);
    if (decade) url.searchParams.set("decade", decade);
    return url.href;
  }

  function mapUrl(query = "") {
    const url = new URL(MAP_UI_BASE_URL);
    if (query) url.searchParams.set("q", query);
    url.searchParams.set("evidence", "1");
    return url.href;
  }

  function validYear(value) {
    const year = Number.parseInt(String(value || ""), 10);
    const currentYear = new Date().getUTCFullYear();
    return Number.isInteger(year) && year >= 1800 && year <= currentYear ? year : null;
  }

  function documentYear(issue) {
    for (const field of ["publication_year", "document_year"]) {
      const year = validYear(issue?.[field]);
      if (year) return {year, provenance: "catalogue_field"};
    }
    const haystack = `${issue?.title || ""} ${issue?.filename || ""}`;
    const year = [...haystack.matchAll(/\b(?:18|19|20)\d{2}\b/g)]
      .map(match => validYear(match[0]))
      .find(Boolean);
    return year
      ? {year, provenance: "title_or_filename_parsed"}
      : null;
  }

  window.IsaacKoiCatalogue = {
    load,
    searchUrl,
    documentUrl,
    collectionsUrl,
    timelineUrl,
    mapUrl,
    documentYear,
  };
})();
