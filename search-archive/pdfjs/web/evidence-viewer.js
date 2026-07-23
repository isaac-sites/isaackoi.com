(() => {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const requestedPage = Number.parseInt(hash.get("page") || "", 10);
  const requestedSearch = (hash.get("search") || "").replaceAll('"', "");
  if (!requestedSearch) {
    return;
  }
  const hasRequestedPage = Number.isInteger(requestedPage) && requestedPage >= 1;

  function returnToRequestedPage() {
    const app = window.PDFViewerApplication;
    if (!hasRequestedPage || !app?.pdfViewer) return;
    app.page = requestedPage;
  }

  function closeFindBar() {
    const app = window.PDFViewerApplication;
    if (!app?.findBar) return;
    app.findBar.close();
    document.body.classList.remove("evidenceFindbarOpen");
  }

  function ensureFindBarCloseButton() {
    const findbar = document.getElementById("findbar");
    if (!findbar || document.getElementById("evidenceFindClose")) return;

    const button = document.createElement("button");
    button.id = "evidenceFindClose";
    button.className = "toolbarButton evidenceFindClose";
    button.type = "button";
    button.tabIndex = 0;
    button.title = "Close search and hide highlights";
    button.setAttribute("aria-label", "Close search and hide highlights");
    button.textContent = "x";
    button.addEventListener("click", closeFindBar);
    findbar.append(button);
  }

  function openFindBar() {
    const app = window.PDFViewerApplication;
    const findInput = document.getElementById("findInput");
    const highlightAll = document.getElementById("findHighlightAll");
    if (!app?.findBar || !findInput || !highlightAll) {
      window.setTimeout(openFindBar, 100);
      return;
    }

    ensureFindBarCloseButton();
    document.body.classList.add("evidenceFindbarOpen");
    findInput.value = requestedSearch;
    highlightAll.checked = true;
    app.findBar.open();
  }

  function bindEvidenceNavigation() {
    const app = window.PDFViewerApplication;
    if (!app?.eventBus) {
      window.setTimeout(bindEvidenceNavigation, 100);
      return;
    }
    app.eventBus.on("findbarclose", () => document.body.classList.remove("evidenceFindbarOpen"));
    app.eventBus.on("updatefindmatchescount", () => window.setTimeout(returnToRequestedPage, 150));
    app.eventBus.on("pagesloaded", () => window.setTimeout(returnToRequestedPage, 400));
    window.setTimeout(returnToRequestedPage, 1500);
  }

  openFindBar();
  bindEvidenceNavigation();
})();
