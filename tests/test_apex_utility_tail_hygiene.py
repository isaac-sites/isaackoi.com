"""Deterministic falsifiers for the apex utility-tail orphan cure (fu008).

Full-coverage crawl + orphan audit on 2026-10-13 (AW#6060) found 18
sitemap-listed pages on isaackoi.com with zero static inbound links.
Each must either gain >=1 inbound link in rendered markup or carry
noindex + sitemap-exclusion. These tests assert both legs are encoded
in the repository so a Jekyll build honours them.

Classes:
  WIRE   -> privacy-policy, terms (footer legal row)
            map-viewer, archive-search (footer_primary nav)
            ufo-history tail trio (category index cards)
  EXEMPT -> uncategorised x5, cors-test x2 (front matter)
            mapview tests x3, search-archive shells x2 (static HTML)
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as handle:
        return handle.read()


def _front_matter(path):
    text = _read(path)
    assert text.startswith("---"), f"{path} has no front matter"
    return text.split("---", 2)[1]


# --- WIRED: legal pages must sit in the shared footer legal row ---

def test_footer_links_privacy_and_terms():
    footer = _read("_includes/footer.html")
    assert "/privacy-policy/" in footer, "privacy-policy missing from shared footer"
    assert "/terms/" in footer, "terms missing from shared footer"


def test_footer_nav_covers_utility_pages():
    nav = json.loads(_read("_data/navigation.json"))
    urls = {item["url"].rstrip("/") for item in nav["footer_primary"]}
    assert "/map-viewer" in urls, "map-viewer missing from footer_primary"
    assert "/archive-search" in urls, "archive-search missing from footer_primary"


# --- WIRED: ufo-history tail trio reach category index cards ---

def test_personalities_tail_in_index():
    index = _read("pages/category-ufo-history__ufo-personalities.html")
    for slug in ("zechel-w-todd", "zinsstag-louise"):
        assert f"/ufo-history/ufo-personalities/{slug}" in index, (
            f"{slug} has no card/child_link in personalities index"
        )


def test_books_tail_in_index():
    index = _read("pages/category-ufo-history__ufo-books.html")
    assert "yin-amorah-quan-pleiadian-perspectives-on-human-evolution" in index, (
        "yin-amorah book missing from ufo-books index"
    )


# --- EXEMPT: Jekyll pages carry sitemap:false + noindex ---

EXEMPT_JEKYLL = [
    "pages/uncategorised/404.md",
    "pages/uncategorised/article-references-interesting-articles.md",
    "pages/uncategorised/article-references-nothing-yet.md",
    "pages/uncategorised/book-reference-koi-chrono-intro.md",
    "pages/uncategorised/book-references-nothing-yet.md",
    "pages/archive-search-cors-test.html",
    "pages/search-archive-cors-test.html",
]


def test_exempt_jekyll_pages_flagged():
    for path in EXEMPT_JEKYLL:
        fm = _front_matter(path)
        assert "sitemap: false" in fm, f"{path} missing sitemap:false"
        assert re.search(r"noindex:\s*true", fm), f"{path} missing noindex:true"


def test_layout_emits_robots_meta_for_noindex():
    head = _read("_includes/head.html")
    assert "noindex" in head, "head.html does not honour page.noindex"


# --- EXEMPT: static HTML shells excluded via config defaults + meta ---

EXEMPT_STATIC = [
    "mapview/openlayers-test.html",
    "mapview/raw-tile-test.html",
    "mapview/tile-test.html",
    "search-archive/case/index.html",
    "search-archive/document/index.html",
]


def test_static_shells_covered_by_config_defaults():
    config = _read("_config.yml")
    for path in EXEMPT_STATIC:
        # find a defaults scope whose path is a prefix of the file
        scopes = re.findall(
            r'scope:\s*\n\s*path:\s*"?([^"\n]+)"?\s*\n\s*values:\s*\n'
            r"\s*sitemap:\s*false", config)
        assert any(path.startswith(s) for s in scopes), (
            f"{path} has no sitemap:false defaults scope in _config.yml; "
            f"scopes found: {scopes}"
        )


def test_static_shells_carry_noindex_meta():
    for path in EXEMPT_STATIC:
        body = _read(path)
        assert 'name="robots"' in body and "noindex" in body, (
            f"{path} missing <meta name=robots noindex>"
        )
