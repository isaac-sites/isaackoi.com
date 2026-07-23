(() => {
  "use strict";

  const page = document.querySelector("[data-investigation-slug]");
  if (!page) return;
  const slug = page.dataset.investigationSlug || "";
  const storageKey = "isaac-koi-investigation-progress-v1";
  const checkpoints = [...page.querySelectorAll("[data-investigation-checkpoint]")];
  const progress = page.querySelector("[data-investigation-progress]");
  const progressLabel = page.querySelector("[data-investigation-progress-label]");
  const statusElements = [...page.querySelectorAll("[data-investigation-status]")];

  function readProgress() {
    try {
      const payload = JSON.parse(localStorage.getItem(storageKey) || "{}");
      const completed = Array.isArray(payload?.trails?.[slug]) ? payload.trails[slug] : [];
      return new Set(completed.map(String));
    } catch (error) {
      return new Set();
    }
  }

  function writeProgress(completed) {
    try {
      const payload = JSON.parse(localStorage.getItem(storageKey) || "{}");
      const trails = payload?.trails && typeof payload.trails === "object" ? payload.trails : {};
      trails[slug] = [...completed];
      localStorage.setItem(storageKey, JSON.stringify({schema_version: 1, trails}));
    } catch (error) {}
  }

  let completed = readProgress();

  function renderProgress() {
    checkpoints.forEach(checkpoint => {
      const id = checkpoint.dataset.investigationCheckpoint || "";
      const checked = completed.has(id);
      checkpoint.classList.toggle("is-complete", checked);
      const button = checkpoint.querySelector("[data-investigation-check]");
      if (button) {
        button.setAttribute("aria-pressed", String(checked));
        button.textContent = checked ? "Checkpoint complete" : "Mark checkpoint complete";
      }
    });
    if (progress) progress.value = completed.size;
    if (progressLabel) progressLabel.textContent = `${completed.size} of ${checkpoints.length} complete`;
  }

  page.addEventListener("click", event => {
    const button = event.target.closest("[data-investigation-check]");
    if (!button) return;
    const checkpoint = button.closest("[data-investigation-checkpoint]");
    const id = checkpoint?.dataset.investigationCheckpoint || "";
    if (!id) return;
    if (completed.has(id)) completed.delete(id);
    else completed.add(id);
    writeProgress(completed);
    renderProgress();
  });

  document.querySelectorAll("[data-trail-add-records]").forEach(button => {
    button.addEventListener("click", () => {
      const research = window.IsaacKoiResearch;
      const payloadElement = document.getElementById("investigation-research-items");
      if (!research || !payloadElement) return;
      let items = [];
      try { items = JSON.parse(payloadElement.textContent || "[]"); } catch (error) {}
      const added = items.filter(item => research.add(item)).length;
      statusElements.forEach(element => {
        element.textContent = added
          ? `Added ${added} reviewed dossier${added === 1 ? "" : "s"} to this browser's research set.`
          : "The comparison dossiers are already in this browser's research set.";
      });
      research.render();
    });
  });

  renderProgress();
})();
