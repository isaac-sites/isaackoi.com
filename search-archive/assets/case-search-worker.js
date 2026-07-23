"use strict";

const CASE_DISCOVERY_FIELDS = [
  "id", "collection", "title", "date", "year", "location", "region",
  "country", "type", "classification", "source_count", "source_labels", "evidence_url",
];
const CASE_FIELD = Object.freeze(Object.fromEntries(
  CASE_DISCOVERY_FIELDS.map((field, index) => [field, index])
));
let records = [];

function field(record, name) {
  return String(record?.[CASE_FIELD[name]] ?? "");
}

function numberField(record, name) {
  return Number(record?.[CASE_FIELD[name]] || 0);
}

function foldDiacritics(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function countOccurrences(text, term) {
  if (!term) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(term, offset)) >= 0) {
    count += 1;
    offset += term.length;
  }
  return count;
}

function searchText(record) {
  return foldDiacritics([
    "id", "collection", "title", "date", "year", "location", "region",
    "country", "type", "classification", "source_labels",
  ].map(name => field(record, name)).join(" ").toLocaleLowerCase());
}

function matchesCriteria(record, criteria) {
  const year = Number(field(record, "year") || 0);
  if (criteria.yearMin && (!year || year < criteria.yearMin)) return false;
  if (criteria.yearMax && (!year || year > criteria.yearMax)) return false;
  const haystack = searchText(record);
  if (criteria.all.some(term => !haystack.includes(term))) return false;
  if (criteria.phrase && !haystack.replace(/\s+/g, " ").includes(criteria.phrase)) return false;
  if (criteria.any.length && !criteria.any.some(term => haystack.includes(term))) return false;
  if (criteria.none.some(term => haystack.includes(term))) return false;
  return true;
}

function matchScore(record, criteria) {
  const id = foldDiacritics(field(record, "id").toLocaleLowerCase());
  const title = foldDiacritics(field(record, "title").toLocaleLowerCase());
  const location = foldDiacritics(field(record, "location").toLocaleLowerCase());
  const region = foldDiacritics(field(record, "region").toLocaleLowerCase());
  const country = foldDiacritics(field(record, "country").toLocaleLowerCase());
  const source = foldDiacritics(field(record, "source_labels").toLocaleLowerCase());
  const terms = [...new Set([...criteria.all, ...criteria.phraseTerms, ...criteria.any])];
  let score = numberField(record, "source_count") * 3;
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

function sortMatches(rows, mode) {
  rows.sort((left, right) => {
    const leftYear = Number(field(left.record, "year") || 0);
    const rightYear = Number(field(right.record, "year") || 0);
    const titleOrder = field(left.record, "title").localeCompare(field(right.record, "title"));
    const idOrder = field(left.record, "id").localeCompare(field(right.record, "id"));
    if (mode === "source-richness") {
      return numberField(right.record, "source_count") - numberField(left.record, "source_count")
        || right.score - left.score
        || titleOrder
        || idOrder;
    }
    if (mode === "date-newest") return rightYear - leftYear || right.score - left.score || titleOrder || idOrder;
    if (mode === "date-oldest") return leftYear - rightYear || right.score - left.score || titleOrder || idOrder;
    if (mode === "title") return titleOrder || right.score - left.score || idOrder;
    return right.score - left.score || titleOrder || idOrder;
  });
}

function countedValues(rows, name) {
  const counts = new Map();
  for (const row of rows) {
    const value = field(row.record, name);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()];
}

function searchCases(payload) {
  const startedAt = performance.now();
  const matches = records
    .filter(record => matchesCriteria(record, payload.criteria))
    .map(record => ({record, score: matchScore(record, payload.criteria)}));
  const collectionCounts = countedValues(matches, "collection");
  const countryCounts = countedValues(matches, "country");
  const filtered = matches.filter(row =>
    (!payload.filters.collection || field(row.record, "collection") === payload.filters.collection)
    && (!payload.filters.country || field(row.record, "country") === payload.filters.country)
    && (!payload.filters.evidence || Boolean(field(row.record, "evidence_url")))
  );
  sortMatches(filtered, payload.sort);
  const limit = Math.max(1, Math.min(Number(payload.limit || 25), 500));
  return {
    totalMatches: matches.length,
    filteredCount: filtered.length,
    rows: filtered.slice(0, limit),
    collectionCounts,
    countryCounts,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  };
}

async function initialize(compressedBuffer) {
  if (!("DecompressionStream" in self)) {
    throw new Error("This browser cannot decompress the mapped case index in a worker.");
  }
  const stream = new Blob([compressedBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  const payload = JSON.parse(await new Response(stream).text());
  if (payload?.schema_version !== 1 || payload?.package_kind !== "case-discovery") {
    throw new Error("The mapped case index has an unsupported schema.");
  }
  if (!Array.isArray(payload.fields) || payload.fields.join("|") !== CASE_DISCOVERY_FIELDS.join("|")) {
    throw new Error("The mapped case index fields do not match this worker.");
  }
  if (!Array.isArray(payload.records) || payload.records.some(row => !Array.isArray(row) || row.length !== CASE_DISCOVERY_FIELDS.length)) {
    throw new Error("The mapped case index contains malformed records.");
  }
  records = payload.records;
  return {
    recordCount: records.length,
    collectionCount: Object.keys(payload?.counts?.collections || {}).length,
  };
}

self.addEventListener("message", async event => {
  const {id, type, payload} = event.data || {};
  try {
    const result = type === "init"
      ? await initialize(payload.compressedBuffer)
      : type === "search"
        ? searchCases(payload)
        : (() => { throw new Error(`Unknown case-search worker request: ${type}`); })();
    self.postMessage({id, ok: true, result});
  } catch (error) {
    self.postMessage({id, ok: false, error: error?.message || String(error)});
  }
});
