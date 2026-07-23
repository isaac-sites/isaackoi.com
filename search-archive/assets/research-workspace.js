(() => {
  "use strict";

  const research = window.IsaacKoiResearch;
  if (!research) return;
  const sharedItems = research.sharedItemsFromUrl();
  let items = sharedItems.length ? sharedItems : research.getItems();
  let selectedIds = new Set(items.slice(0, 4).map(item => item.id));

  const listElement = document.getElementById("research-item-list");
  const comparisonElement = document.getElementById("research-comparison");
  const emptyElement = document.getElementById("research-empty-state");
  const countElement = document.getElementById("research-selection-count");
  const statusElement = document.getElementById("research-workspace-status");
  const sharedNoteElement = document.getElementById("shared-set-note");
  const saveSharedButton = document.getElementById("save-shared-set");

  function typeLabel(type) {
    return {"archive-document": "Archive document", "mapped-case": "Mapped case", dossier: "Evidence dossier"}[type] || type;
  }

  function valueOrDash(value) {
    if (Array.isArray(value)) return value.length ? value.join(" · ") : "—";
    return value === null || value === undefined || value === "" ? "—" : String(value);
  }

  function comparisonFields() {
    return [
      ["Record type", item => typeLabel(item.type)],
      ["Date", item => item.date],
      ["Location", item => item.location],
      ["Collection", item => item.collection],
      ["Document ID", item => item.document_id],
      ["Record ID", item => item.record_id],
      ["Source families", item => item.source_families],
      ["Source links", item => item.source_count],
      ["Evidence status", item => item.evidence_status],
      ["Citation", item => item.citation],
    ];
  }

  function createItemRow(item) {
    const label = document.createElement("label");
    label.className = "research-item-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = item.id;
    checkbox.checked = selectedIds.has(item.id);
    checkbox.setAttribute("aria-label", `Compare ${item.title}`);
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = item.title;
    const small = document.createElement("small");
    small.textContent = [typeLabel(item.type), item.subtitle, item.date].filter(Boolean).join(" · ");
    copy.append(strong, small);
    const link = document.createElement("a");
    link.href = item.url;
    link.textContent = "Open";
    label.append(checkbox, copy, link);
    return label;
  }

  function renderList() {
    listElement.replaceChildren(...items.map(createItemRow));
    emptyElement.hidden = Boolean(items.length);
    countElement.textContent = `${selectedIds.size} selected`;
    sharedNoteElement.hidden = !sharedItems.length;
    saveSharedButton.hidden = !sharedItems.length;
  }

  function renderComparison() {
    const selected = items.filter(item => selectedIds.has(item.id)).slice(0, 4);
    if (!selected.length) {
      comparisonElement.innerHTML = `<p class="research-comparison-empty">Select at least one research item to begin comparing public metadata.</p>`;
      return;
    }
    const table = document.createElement("table");
    table.className = "research-comparison-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.scope = "col";
    corner.textContent = "Field";
    headRow.appendChild(corner);
    selected.forEach(item => {
      const cell = document.createElement("th");
      cell.scope = "col";
      const link = document.createElement("a");
      link.href = item.url;
      link.textContent = item.title;
      cell.appendChild(link);
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    const body = document.createElement("tbody");
    comparisonFields().forEach(([label, getter]) => {
      const row = document.createElement("tr");
      const heading = document.createElement("th");
      heading.scope = "row";
      heading.textContent = label;
      row.appendChild(heading);
      selected.forEach(item => {
        const cell = document.createElement("td");
        cell.textContent = valueOrDash(getter(item));
        if (label === "Citation") cell.className = "research-citation-cell";
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.append(head, body);
    const wrapper = document.createElement("div");
    wrapper.className = "research-comparison-scroll";
    wrapper.appendChild(table);
    comparisonElement.replaceChildren(wrapper);
  }

  function render() {
    renderList();
    renderComparison();
  }

  function downloadJson() {
    const payload = JSON.stringify({schema_version: 1, exported_at: new Date().toISOString(), items}, null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([payload], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "isaac-koi-research-set.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    statusElement.textContent = `Exported ${items.length} public research item${items.length === 1 ? "" : "s"}.`;
  }

  listElement.addEventListener("change", event => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked && selectedIds.size >= 4) {
      checkbox.checked = false;
      statusElement.textContent = "Compare up to four items at a time.";
      return;
    }
    if (checkbox.checked) selectedIds.add(checkbox.value);
    else selectedIds.delete(checkbox.value);
    render();
  });

  document.getElementById("copy-research-share").addEventListener("click", async () => {
    if (!items.length) {
      statusElement.textContent = "Add an item before sharing.";
      return;
    }
    const copied = await research.copyText(research.workspaceUrl(items));
    statusElement.textContent = copied ? `Copied a shareable set with ${Math.min(items.length, 20)} public item${items.length === 1 ? "" : "s"}.` : "Clipboard access is unavailable.";
  });
  document.getElementById("copy-research-citations").addEventListener("click", async () => {
    const citations = items.map(item => item.citation).filter(Boolean);
    if (!citations.length) {
      statusElement.textContent = "No citations are available in this set.";
      return;
    }
    const copied = await research.copyText(citations.join("\n\n"));
    statusElement.textContent = copied ? `Copied ${citations.length} citation${citations.length === 1 ? "" : "s"}.` : "Clipboard access is unavailable.";
  });
  document.getElementById("download-research-json").addEventListener("click", downloadJson);
  saveSharedButton.addEventListener("click", () => {
    const existing = research.getItems();
    const merged = [...items, ...existing.filter(existingItem => !items.some(item => item.id === existingItem.id))];
    research.writeItems(merged);
    statusElement.textContent = `Saved ${items.length} shared item${items.length === 1 ? "" : "s"} in this browser.`;
    saveSharedButton.disabled = true;
  });
  window.addEventListener("isaac-koi-research-set-change", () => {
    if (sharedItems.length) return;
    items = research.getItems();
    selectedIds = new Set([...selectedIds].filter(id => items.some(item => item.id === id)));
    if (!selectedIds.size) items.slice(0, 4).forEach(item => selectedIds.add(item.id));
    render();
  });

  render();
})();
