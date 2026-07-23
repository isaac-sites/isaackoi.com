(() => {
  "use strict";

  const STORAGE_KEY = "isaac-koi-research-set-v1";
  const SCHEMA_VERSION = 1;
  const MAX_ITEMS = 50;
  const MAX_SHARED_ITEMS = 20;
  const EVENT_NAME = "isaac-koi-research-set-change";
  const ALLOWED_TYPES = new Set(["archive-document", "mapped-case", "dossier"]);
  const scriptBase = document.currentScript?.src
    ? new URL("../", document.currentScript.src)
    : new URL("./", window.location.href);
  const configuredSearchUiBase = document.querySelector('meta[name="afu-search-ui-base"]')?.content.trim();
  const SEARCH_UI_BASE_URL = new URL(configuredSearchUiBase || scriptBase.href, window.location.href);

  function cleanText(value, limit = 500) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function cleanUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function cleanInteger(value) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function normalizeFamilies(value) {
    const rows = Array.isArray(value) ? value : String(value || "").split("|");
    return [...new Set(rows.map(row => cleanText(row, 120)).filter(Boolean))].slice(0, 12);
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = cleanText(raw.id, 180);
    const type = cleanText(raw.type, 40);
    const title = cleanText(raw.title, 260);
    const url = cleanUrl(raw.url);
    if (!id || !title || !url || !ALLOWED_TYPES.has(type)) return null;
    return {
      id,
      type,
      title,
      subtitle: cleanText(raw.subtitle, 260),
      url,
      citation: cleanText(raw.citation, 1200),
      date: cleanText(raw.date, 100),
      location: cleanText(raw.location, 220),
      collection: cleanText(raw.collection, 220),
      document_id: cleanText(raw.document_id, 180),
      record_id: cleanText(raw.record_id, 120),
      source_families: normalizeFamilies(raw.source_families),
      source_count: cleanInteger(raw.source_count),
      evidence_status: cleanText(raw.evidence_status, 260),
    };
  }

  function readItems() {
    try {
      const payload = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      return rows.map(normalizeItem).filter(Boolean).slice(0, MAX_ITEMS);
    } catch (error) {
      return [];
    }
  }

  function writeItems(rows) {
    const items = rows.map(normalizeItem).filter(Boolean).slice(0, MAX_ITEMS);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({schema_version: SCHEMA_VERSION, items}));
    } catch (error) {
      return false;
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {detail: {items}}));
    return true;
  }

  function add(raw) {
    const item = normalizeItem(raw);
    if (!item) return false;
    const rows = readItems().filter(row => row.id !== item.id);
    rows.unshift(item);
    return writeItems(rows);
  }

  function remove(id) {
    return writeItems(readItems().filter(row => row.id !== String(id || "")));
  }

  function toggle(raw) {
    const item = normalizeItem(raw);
    if (!item) return false;
    const rows = readItems();
    if (rows.some(row => row.id === item.id)) return remove(item.id);
    return add(item);
  }

  function clear() {
    return writeItems([]);
  }

  function encodeItems(rows = readItems()) {
    const items = rows.map(normalizeItem).filter(Boolean).slice(0, MAX_SHARED_ITEMS);
    const json = JSON.stringify({v: SCHEMA_VERSION, items});
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  function decodeItems(value) {
    if (!value || String(value).length > 24000) return [];
    try {
      const padded = String(value).replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
      const binary = window.atob(padded);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (payload?.v !== SCHEMA_VERSION || !Array.isArray(payload.items)) return [];
      return payload.items.map(normalizeItem).filter(Boolean).slice(0, MAX_SHARED_ITEMS);
    } catch (error) {
      return [];
    }
  }

  function workspaceUrl(rows = null) {
    const url = new URL("research.html", SEARCH_UI_BASE_URL);
    if (rows) url.searchParams.set("set", encodeItems(rows));
    return url.href;
  }

  function sharedItemsFromUrl(url = window.location.href) {
    try {
      return decodeItems(new URL(url).searchParams.get("set") || "");
    } catch (error) {
      return [];
    }
  }

  function itemFromButton(button) {
    return normalizeItem({
      id: button.dataset.researchId,
      type: button.dataset.researchType,
      title: button.dataset.researchTitle,
      subtitle: button.dataset.researchSubtitle,
      url: button.dataset.researchUrl,
      citation: button.dataset.researchCitation,
      date: button.dataset.researchDate,
      location: button.dataset.researchLocation,
      collection: button.dataset.researchCollection,
      document_id: button.dataset.researchDocumentId,
      record_id: button.dataset.researchRecordId,
      source_families: button.dataset.researchSourceFamilies,
      source_count: button.dataset.researchSourceCount,
      evidence_status: button.dataset.researchEvidenceStatus,
    });
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {}
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }

  function injectStyles() {
    if (document.getElementById("research-tray-styles")) return;
    const style = document.createElement("style");
    style.id = "research-tray-styles";
    style.textContent = `
      .research-tray-toggle{position:fixed;right:1rem;bottom:1rem;z-index:10020;display:flex;align-items:center;gap:.45rem;padding:.65rem .8rem;border:1px solid color-mix(in srgb,var(--brand,#176d71) 45%,#b7c3c4);border-radius:999px;background:var(--surface,#fff);color:var(--heading,#18272c);box-shadow:0 8px 28px rgba(16,34,40,.2);font:700 .72rem/1.2 Manrope,Arial,sans-serif;cursor:pointer}
      .research-tray-toggle span{display:grid;place-items:center;min-width:1.35rem;height:1.35rem;padding:0 .25rem;border-radius:999px;background:var(--brand,#176d71);color:#fff;font-size:.62rem}
      .research-tray{position:fixed;right:1rem;bottom:4.6rem;z-index:10021;width:min(390px,calc(100vw - 2rem));max-height:min(70vh,650px);overflow:auto;padding:.85rem;border:1px solid var(--border,#ccd5d6);border-radius:14px;background:var(--surface,#fff);color:var(--text,#28383e);box-shadow:0 18px 55px rgba(13,29,35,.28);font-family:Manrope,Arial,sans-serif}
      .research-tray[hidden]{display:none}.research-tray-header{display:flex;align-items:start;justify-content:space-between;gap:.7rem}.research-tray-header h2{margin:.1rem 0;font:700 1.05rem/1.3 Merriweather,Georgia,serif}.research-tray-close{padding:.3rem .45rem}.research-tray-note{margin:.45rem 0 .7rem;color:var(--muted,#66777c);font-size:.68rem;line-height:1.45}.research-tray-list{display:grid;gap:.45rem}.research-tray-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.35rem;padding:.55rem;border:1px solid var(--border,#ccd5d6);border-radius:9px;background:var(--surface-alt,#f4f7f7)}.research-tray-item a{overflow-wrap:anywhere;color:var(--heading,#18272c);font:700 .72rem/1.35 Merriweather,Georgia,serif;text-decoration:none}.research-tray-item small{grid-column:1;color:var(--muted,#66777c);font-size:.62rem;line-height:1.35}.research-tray-remove{grid-column:2;grid-row:1/3;align-self:center;padding:.28rem .4rem;font-size:.62rem}.research-tray-empty{margin:.65rem 0;color:var(--muted,#66777c);font-size:.72rem}.research-tray-actions{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.7rem}.research-tray-actions a,.research-tray-actions button{padding:.42rem .55rem;font:700 .66rem/1.2 Manrope,Arial,sans-serif}.research-tray-actions a{border-radius:6px;background:var(--brand,#176d71);color:#fff;text-decoration:none}.research-tray-status{min-height:1rem;margin:.4rem 0 0;color:var(--muted,#66777c);font-size:.64rem}.research-save-button.is-saved{border-color:var(--brand,#176d71);background:color-mix(in srgb,var(--brand,#176d71) 12%,var(--surface,#fff));color:var(--brand-dark,#11585c)}
      @media(max-width:600px){.research-tray-toggle{right:.65rem;bottom:.65rem}.research-tray{right:.65rem;bottom:4rem;width:calc(100vw - 1.3rem)}}
    `;
    document.head.appendChild(style);
  }

  function mountTray() {
    if (!document.body || document.getElementById("research-tray-toggle")) return;
    injectStyles();
    const toggleButton = document.createElement("button");
    toggleButton.id = "research-tray-toggle";
    toggleButton.className = "research-tray-toggle";
    toggleButton.type = "button";
    toggleButton.setAttribute("aria-expanded", "false");
    toggleButton.setAttribute("aria-controls", "research-tray");
    toggleButton.innerHTML = `Research set <span data-research-count>0</span>`;

    const tray = document.createElement("aside");
    tray.id = "research-tray";
    tray.className = "research-tray";
    tray.hidden = true;
    tray.setAttribute("aria-label", "Saved research set");
    tray.innerHTML = `
      <div class="research-tray-header"><div><small>Browser-local workspace</small><h2>Research set</h2></div><button class="research-tray-close" type="button" aria-label="Close research set">Close</button></div>
      <p class="research-tray-note">Selections stay in this browser unless you explicitly copy a share link. Only public metadata and archive links are retained.</p>
      <div class="research-tray-list"></div>
      <p class="research-tray-empty">No items saved yet.</p>
      <div class="research-tray-actions"><a data-research-workspace href="${workspaceUrl()}">Compare items</a><button data-research-copy-share type="button">Copy share link</button><button data-research-clear type="button">Clear</button></div>
      <p class="research-tray-status" aria-live="polite"></p>`;
    document.body.append(toggleButton, tray);

    toggleButton.addEventListener("click", () => {
      tray.hidden = !tray.hidden;
      toggleButton.setAttribute("aria-expanded", String(!tray.hidden));
      if (!tray.hidden) tray.querySelector(".research-tray-close")?.focus();
    });
    tray.querySelector(".research-tray-close")?.addEventListener("click", () => {
      tray.hidden = true;
      toggleButton.setAttribute("aria-expanded", "false");
      toggleButton.focus();
    });
    tray.addEventListener("click", async event => {
      const removeButton = event.target.closest("[data-research-remove]");
      if (removeButton) remove(removeButton.dataset.researchRemove);
      if (event.target.closest("[data-research-clear]")) clear();
      if (event.target.closest("[data-research-copy-share]")) {
        const status = tray.querySelector(".research-tray-status");
        const rows = readItems();
        if (!rows.length) {
          status.textContent = "Add an item before sharing.";
        } else {
          const copied = await copyText(workspaceUrl(rows));
          status.textContent = copied ? `Copied a link containing ${Math.min(rows.length, MAX_SHARED_ITEMS)} public item${rows.length === 1 ? "" : "s"}.` : "Clipboard access is unavailable.";
        }
      }
    });
    renderTray();
  }

  function renderTray() {
    const rows = readItems();
    document.querySelectorAll("[data-research-count]").forEach(node => { node.textContent = String(rows.length); });
    const tray = document.getElementById("research-tray");
    if (tray) {
      const list = tray.querySelector(".research-tray-list");
      const empty = tray.querySelector(".research-tray-empty");
      list.replaceChildren(...rows.slice(0, 12).map(item => {
        const article = document.createElement("article");
        article.className = "research-tray-item";
        const link = document.createElement("a");
        link.href = item.url;
        link.textContent = item.title;
        const meta = document.createElement("small");
        meta.textContent = [item.subtitle, item.date, item.type.replaceAll("-", " ")].filter(Boolean).join(" · ");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "research-tray-remove";
        button.dataset.researchRemove = item.id;
        button.textContent = "Remove";
        article.append(link, meta, button);
        return article;
      }));
      empty.hidden = Boolean(rows.length);
      tray.querySelector("[data-research-clear]").disabled = !rows.length;
      tray.querySelector("[data-research-copy-share]").disabled = !rows.length;
      tray.querySelector("[data-research-workspace]").href = workspaceUrl();
    }
    const ids = new Set(rows.map(item => item.id));
    document.querySelectorAll("[data-research-add]").forEach(button => {
      const saved = ids.has(button.dataset.researchId || "");
      button.classList.toggle("is-saved", saved);
      button.setAttribute("aria-pressed", String(saved));
      button.textContent = saved ? "Saved to research set" : "Add to research set";
    });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-research-add]");
    if (!button) return;
    event.preventDefault();
    const item = itemFromButton(button);
    if (item) toggle(item);
  });
  window.addEventListener(EVENT_NAME, renderTray);
  window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) renderTray(); });

  window.IsaacKoiResearch = {
    storageKey: STORAGE_KEY,
    schemaVersion: SCHEMA_VERSION,
    maxItems: MAX_ITEMS,
    getItems: readItems,
    normalizeItem,
    add,
    remove,
    toggle,
    clear,
    writeItems,
    encodeItems,
    decodeItems,
    workspaceUrl,
    sharedItemsFromUrl,
    copyText,
    render: renderTray,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountTray, {once: true});
  else mountTray();
})();
