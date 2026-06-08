const DATA_URL = "data/fold3_all_geocoded.geojson";
const APRO_DATA_URL = "data/ufocat_apro.geojson?v=20260607-coordinate-batch-2";
const UFOCAT_SOURCES_URL = "data/ufocat_sources_public.json?v=20260607-coordinate-batch-2";

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
const searchInput = document.getElementById("searchInput");
const archiveTree = document.getElementById("archiveTree");
const stateFilter = document.getElementById("stateFilter");
const countryFilter = document.getElementById("countryFilter");
const decadeFilter = document.getElementById("decadeFilter");
const yearFilter = document.getElementById("yearFilter");
const monthFilter = document.getElementById("monthFilter");
const colorByDecade = document.getElementById("colorByDecade");
const colorByState = document.getElementById("colorByState");
const filterToggle = document.getElementById("filterToggle");
const activeFilterCount = document.getElementById("activeFilterCount");
const advancedFilters = document.getElementById("advancedFilters");
const resetButton = document.getElementById("resetButton");
const popup = document.getElementById("popup");
const popupContent = document.getElementById("popupContent");
const popupClose = document.getElementById("popupClose");
const fold3LayerToggle = document.getElementById("fold3LayerToggle");
const aproLayerToggle = document.getElementById("aproLayerToggle");

let rawFeatures = [];
let aproFeatures = [];
let ufocatSourceLinks = new Map();
let featureArchiveFolders = new Map();
let selectedArchiveFolders = new Set();
let colorMode = "decade";
let stateColors = new Map();
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

const FOLD3_ARCHIVE_FOLDER = "Documents / Project Blue Book / Fold3";
const sourceArchiveFolders = {
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

const baseLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: "https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attributions:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }),
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
  visible: true,
});

const popupOverlay = new ol.Overlay({
  element: popup,
  autoPan: { animation: { duration: 180 } },
  positioning: "bottom-center",
  stopEvent: true,
  offset: [0, -12],
});

const map = new ol.Map({
  target: "map",
  layers: [baseLayer, clusterLayer, aproClusterLayer],
  overlays: [popupOverlay],
  view: new ol.View({
    center: ol.proj.fromLonLat([0, 20]),
    zoom: 2,
  }),
});

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  if (isUfocatFeature(properties)) return "#c3552a";
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
  const key = `${colorMode}:${color}:${size > 1 ? "cluster" : "single"}:${size}`;
  if (styleCache.has(key)) return styleCache.get(key);

  const radius = size > 1 ? Math.min(30, 14 + Math.log(size) * 4) : 7;
  const style = new ol.style.Style({
    image: new ol.style.Circle({
      radius,
      fill: new ol.style.Fill({ color }),
      stroke: new ol.style.Stroke({ color: "#ffffff", width: 2 }),
    }),
    text:
      size > 1
        ? new ol.style.Text({
            text: String(size),
            fill: new ol.style.Fill({ color: "#ffffff" }),
            font: "700 12px Arial, Helvetica, sans-serif",
          })
        : undefined,
  });
  styleCache.set(key, style);
  return style;
}

function caseCardHtml(properties, headingLevel = 2) {
  if (isUfocatFeature(properties)) return ufocatCardHtml(properties, headingLevel);
  const title = properties.Location || properties.MapLabel || properties.Fold3ImageNumber || "Project Blue Book case";
  const date = formatCaseDate(properties);
  const recordUrl = properties.RecordUrl || properties.SourceUrl || properties.Fold3Url || "";
  const link = recordUrl
    ? `<a class="popup-link" href="${escapeHtml(recordUrl)}" target="_blank" rel="noopener">Open Project Blue Book documents on Fold3</a>`
    : "";
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
    ${link}
  `;
}

function optionalMetaRow(label, value) {
  return value ? `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>` : "";
}

function coordinateConfidenceText(value) {
  if (value === "reviewed_coordinate_override") return "reviewed coordinate override";
  if (value === "raw_plausible_coordinate") return "unreviewed UFOCAT coordinate";
  return String(value || "").replaceAll("_", " ");
}

function isUfocatFeature(properties) {
  return properties.SourceType === "UFOCAT" || properties.SourceType === "UFOCAT_APRO";
}

function sourceStatusText(source) {
  if (source.page_mapping_status === "needs_review") return "page needs review";
  if (source.validation_status === "text_validated" || source.validation_status === "search_hit_text_validated") return "text validated";
  if (source.validation_status === "mapped_page_valid") return "page mapped";
  if (source.validation_status === "issue_resolved") return "issue resolved";
  return source.validation_status || source.page_mapping_status || "";
}

function archiveFolderForSource(source) {
  return source.archive_folder || sourceArchiveFolders[source.source_code] || `Magazines / United States / ${source.source_label || source.source_code || "Source"}`;
}

function groupSourceLinks(sources) {
  const grouped = new Map();
  for (const source of sources) {
    const prn = String(source.ufocat_prn || "");
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
  const sources = ufocatSourceLinks.get(String(properties.RecordId || "")) || [];
  if (!sources.length) return `<p class="source-detail">No public archive source links are available for this UFOCAT record yet.</p>`;
  const byLabel = new Map();
  for (const source of sources) {
    const label = archiveFolderForSource(source);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(source);
  }
  return [...byLabel.entries()].map(([label, rows]) => `
    <section class="source-group">
      <h${Math.min(6, 4)} class="source-group-title">${escapeHtml(label)}</h${Math.min(6, 4)}>
      ${rows.map((source) => {
        const detailParts = [
          source.issue_label,
          source.citation_raw ? `citation ${source.citation_raw}` : "",
          source.search_anchor_term ? `highlight ${source.search_anchor_term}` : "",
          sourceStatusText(source),
        ].filter(Boolean);
        const actionUrl = source.evidence_url || source.online_source_url;
        const action = actionUrl
          ? `<a class="popup-link" href="${escapeHtml(actionUrl)}" target="_blank" rel="noopener">Open highlighted evidence</a>`
          : "";
        return `<div class="source-row"><p class="source-detail">${escapeHtml(detailParts.join(" | "))}</p>${action}</div>`;
      }).join("")}
    </section>
  `).join("");
}

function ufocatCardHtml(properties, headingLevel = 2) {
  const title = properties.Location || properties.RecordId || "UFOCAT record";
  const headingTag = `h${headingLevel}`;
  return `
    <p class="source-label">Record linked to sources in the Isaac Koi archive</p>
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
      ${optionalMetaRow("Coordinate confidence", coordinateConfidenceText(properties.CoordinateTier))}
      <dt>UFOCAT PRN</dt><dd>${escapeHtml(properties.RecordId)}</dd>
    </dl>
    <div class="source-section">
      <p class="source-section-title">Sources</p>
      ${sourcesHtml(properties)}
    </div>
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

function passesFilters(feature) {
  const p = feature.properties;
  const query = searchInput.value.trim().toLowerCase();
  const state = stateFilter.value;
  const country = countryFilter.value;
  const decade = decadeFilter.value;
  const year = yearFilter.value;
  const month = monthFilter.value;
  const parts = dateParts(p);

  if (selectedArchiveFolders.size && !archiveFoldersForFeature(feature).some((folder) => selectedArchiveFolders.has(folder))) return false;
  if (state && p.StateProvince !== state) return false;
  if (country && p.Country !== country) return false;
  if (decade && decadeFor(p) !== decade) return false;
  if (year && parts.year !== year) return false;
  if (month && parts.month !== month) return false;
  if (query && !p.SearchText.includes(query)) return false;
  return true;
}

function featureToOl(feature) {
  const [lon, lat] = feature.geometry.coordinates;
  const olFeature = new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
    ...feature.properties,
  });
  return olFeature;
}

function activeDataFilterCount() {
  return [
    searchInput.value.trim(),
    selectedArchiveFolders.size ? "archive" : "",
    stateFilter.value,
    countryFilter.value,
    decadeFilter.value,
    yearFilter.value,
    monthFilter.value,
  ].filter(Boolean).length;
}

function updateFilterSummary() {
  const count = activeDataFilterCount();
  activeFilterCount.textContent = String(count);
  activeFilterCount.hidden = count === 0;
}

function setFilterPanelOpen(isOpen) {
  advancedFilters.hidden = !isOpen;
  filterToggle.setAttribute("aria-expanded", String(isOpen));
}

function render() {
  const filtered = fold3LayerToggle.checked ? rawFeatures.filter(passesFilters) : [];
  const filteredApro = aproLayerToggle.checked ? aproFeatures.filter(passesFilters) : [];
  vectorSource.clear();
  vectorSource.addFeatures(filtered.map(featureToOl));
  aproVectorSource.clear();
  aproVectorSource.addFeatures(filteredApro.map(featureToOl));
  visibleCount.textContent = (filtered.length + filteredApro.length).toLocaleString();
  totalCount.textContent = (
    (fold3LayerToggle.checked ? rawFeatures.length : 0) +
    (aproLayerToggle.checked ? aproFeatures.length : 0)
  ).toLocaleString();
  popupOverlay.setPosition(undefined);
  updateFilterSummary();
}

function isUsefulCountryOption(country, count) {
  if (!country) return false;
  if (count >= 2) return true;
  return country.length <= 42 && !/[0-9()#]/.test(country);
}

function archiveFoldersForFeature(feature) {
  const recordId = String(feature.properties.RecordId || feature.properties.Fold3ImageNumber || "");
  if (featureArchiveFolders.has(recordId)) return featureArchiveFolders.get(recordId);
  if (isUfocatFeature(feature.properties)) {
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
  colorByDecade.classList.toggle("active", mode === "decade");
  colorByState.classList.toggle("active", mode === "state");
  clusterLayer.changed();
  aproClusterLayer.changed();
}

map.on("click", (event) => {
  const hit = map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
  if (!hit) {
    popupOverlay.setPosition(undefined);
    return;
  }

  const members = hit.get("features") || [];
  if (members.length > 1) {
    if (membersShareCoordinate(members)) {
      popupContent.innerHTML = multiPopupHtml(members);
      popupOverlay.setPosition(event.coordinate);
      return;
    }

    const extent = ol.extent.createEmpty();
    members.forEach((member) => ol.extent.extend(extent, member.getGeometry().getExtent()));
    const zoom = map.getView().getZoom() || 0;
    if (zoom >= 13 || (ol.extent.getWidth(extent) < 1000 && ol.extent.getHeight(extent) < 1000)) {
      popupContent.innerHTML = multiPopupHtml(members);
      popupOverlay.setPosition(event.coordinate);
      return;
    }

    map.getView().fit(extent, { padding: [60, 60, 60, 60], duration: 180, maxZoom: 13 });
    return;
  }

  const properties = members[0]?.getProperties();
  if (!properties) return;
  popupContent.innerHTML = popupHtml(properties);
  popupOverlay.setPosition(event.coordinate);
});

popupClose.addEventListener("click", () => popupOverlay.setPosition(undefined));
filterToggle.addEventListener("click", () => {
  setFilterPanelOpen(advancedFilters.hidden);
});
searchInput.addEventListener("input", render);
archiveTree.addEventListener("change", (event) => {
  if (event.target?.matches("input[type='checkbox']")) setArchiveSelection(event.target, event.target.checked);
});
stateFilter.addEventListener("change", render);
countryFilter.addEventListener("change", render);
decadeFilter.addEventListener("change", render);
yearFilter.addEventListener("change", render);
monthFilter.addEventListener("change", render);
fold3LayerToggle.addEventListener("change", () => {
  clusterLayer.setVisible(fold3LayerToggle.checked);
  render();
});
aproLayerToggle.addEventListener("change", () => {
  aproClusterLayer.setVisible(aproLayerToggle.checked);
  render();
});
colorByDecade.addEventListener("click", () => setColorMode("decade"));
colorByState.addEventListener("click", () => setColorMode("state"));
resetButton.addEventListener("click", () => {
  searchInput.value = "";
  selectedArchiveFolders = new Set();
  updateArchiveTreeState();
  stateFilter.value = "";
  countryFilter.value = "";
  decadeFilter.value = "";
  yearFilter.value = "";
  monthFilter.value = "";
  fold3LayerToggle.checked = true;
  aproLayerToggle.checked = true;
  clusterLayer.setVisible(true);
  aproClusterLayer.setVisible(true);
  setFilterPanelOpen(false);
  map.getView().animate({ center: ol.proj.fromLonLat([0, 20]), zoom: 2, duration: 180 });
  render();
});

Promise.all([DATA_URL, APRO_DATA_URL, UFOCAT_SOURCES_URL].map((url) =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Unable to load ${url}`);
    return response.json();
  })
))
  .then(([fold3Data, aproData, ufocatSourcesData]) => {
    rawFeatures = fold3Data.features || [];
    aproFeatures = aproData.features || [];
    ufocatSourceLinks = groupSourceLinks(ufocatSourcesData.records || ufocatSourcesData || []);
    featureArchiveFolders = new Map([
      ...rawFeatures.map((feature) => [String(feature.properties.RecordId || feature.properties.Fold3ImageNumber || ""), [FOLD3_ARCHIVE_FOLDER]]),
      ...aproFeatures.map((feature) => [String(feature.properties.RecordId || ""), archiveFoldersForFeature(feature)]),
    ]);
    populateFilters([...rawFeatures, ...aproFeatures]);
    render();
  })
  .catch((error) => {
    visibleCount.textContent = "0";
    totalCount.textContent = "0";
    console.error(error);
  });
