(function () {
  const copyButton = document.querySelector("[data-copy-dossier-citation]");
  const status = document.querySelector("[data-citation-status]");
  if (!copyButton) return;

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await Promise.race([
          navigator.clipboard.writeText(value),
          new Promise(function (_, reject) { window.setTimeout(function () { reject(new Error("Clipboard timed out.")); }, 900); }),
        ]);
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

  copyButton.addEventListener("click", async function () {
    try {
      const response = await fetch("dossier.json");
      if (!response.ok) throw new Error("Citation metadata is unavailable.");
      const dossier = await response.json();
      const citation = String(dossier?.citation?.plain_text || "").trim();
      if (!citation) throw new Error("Citation metadata is incomplete.");
      await copyText(citation);
      copyButton.textContent = "Citation copied";
      if (status) status.textContent = "Copied the stable dossier citation.";
      window.setTimeout(function () { copyButton.textContent = "Copy citation"; }, 1600);
    } catch (error) {
      if (status) status.textContent = error?.message || "Unable to copy the citation.";
    }
  });
}());
