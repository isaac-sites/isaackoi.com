(function () {
  "use strict";

  function initialise(directory) {
    var input = directory.querySelector("[data-network-filter]");
    var result = directory.querySelector("[data-network-results]");
    var cards = Array.prototype.slice.call(directory.querySelectorAll("[data-network-site-card]"));
    var categories = Array.prototype.slice.call(directory.querySelectorAll("[data-network-category]"));
    if (!input || !result || !cards.length) return;

    function update() {
      var query = input.value.trim().toLocaleLowerCase();
      var visible = 0;
      cards.forEach(function (card) {
        var matches = !query || (card.getAttribute("data-search-text") || "").indexOf(query) !== -1;
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      categories.forEach(function (category) {
        var categoryVisible = category.querySelector("[data-network-site-card]:not([hidden])");
        category.hidden = !categoryVisible;
        var heading = category.querySelector("[id]");
        if (heading) {
          var link = directory.querySelector('[data-network-category-link="' + heading.id + '"]');
          if (link) link.hidden = !categoryVisible;
        }
      });
      result.textContent = query
        ? "Showing " + visible + " of " + cards.length + " sites"
        : "Showing all " + cards.length + " sites";
    }

    input.addEventListener("input", update);
    update();
  }

  document.querySelectorAll("[data-network-directory]").forEach(initialise);
})();
