# Isaac Koi Archive

The homepage remains archive-led. A marker-bounded network section can list
explicitly approved UFO sites from the shared Phoenix registry without
replacing the archive navigation:

```powershell
.\.venv\Scripts\python.exe scripts\build_branchoria_hub_directory.py `
  --registry config\network_sites.json --network isaackoi `
  --index isaackoi.com-temp\index.html
```

The compatibility-named builder renders only `network=isaackoi` entries at
`[site].isaackoi.com`. It does not publish the homepage or alter DNS.

This Jekyll site is the generated public-repo source for the Isaac Koi archive.

Key paths:

- `pages/` holds the route-based Markdown source pages
- `images/`, `documents/`, `book-covers/`, and `assets/` hold site assets
- `_layouts/`, `_includes/`, and `assets/` hold the Phoenix-derived theme
- `navigation-tree.json` holds the client-side sidebar navigation tree

Local development:

```powershell
bundle install
bundle exec jekyll serve
```

Production deploys should use the GitHub Actions workflow in `.github/workflows/pages.yml`.
