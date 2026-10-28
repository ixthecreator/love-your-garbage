# Three Days, One Table

A fullscreen, interactive 3D scan of three days of discarded objects gathered on one table. The page opens directly into the scan.

Drag to orbit, scroll or pinch to zoom, and double-click to reset the view.

## Files

- `index.html`, `styles.css`, `app.js`, `scene-bundle.js`: ready-to-publish website.
- `assets/tabletop-scan.glb`: the complete current scan, copied without modification.
- `src/scene.js`: editable renderer source.
- `scripts/export-standalone.mjs`: creates a self-contained offline HTML file.
- `SOURCE_SNAPSHOT.json`: source commit, original file hashes and the two maintenance path adjustments.
- `SHA256SUMS`: hashes of the files in this publishing snapshot, excluding the checksum file itself.

## Update

Replace `assets/tabletop-scan.glb` with a self-contained GLB using the same filename. Update its `?v=` value in `app.js` when replacing the scan so returning visitors fetch the new file. Update the `app.js?v=` value in `index.html` at the same time.

To change the renderer, edit `src/scene.js`, then run:

```sh
npm ci
npm run build:scene
```

The build writes `scene-bundle.js` at the repository root. No build is needed to publish the supplied files.

To make an offline copy:

```sh
node scripts/export-standalone.mjs "/absolute/path/Three-Days-One-Table.html"
```

The export embeds the scan, styles and scripts into one HTML file.

## Publish with GitHub Pages

Repository: [ixthecreator/love-your-garbage](https://github.com/ixthecreator/love-your-garbage). Publishing branch: `codex/github-pages`. Website address: [ixthecreator.github.io/love-your-garbage](https://ixthecreator.github.io/love-your-garbage/).

1. Push this directory's contents to `codex/github-pages`, with `index.html` at the repository root.
2. In repository **Settings → Pages**, choose **Deploy from a branch**, select **codex/github-pages**, and choose **/(root)**.
3. Save. The included `.nojekyll` keeps this a plain static site. No custom Actions workflow is required.

All runtime asset paths are relative, so the page works under a repository Pages URL. Keep the assets together when copying the site.

## Snapshot

Source commit: `bdd9455dcc03f7ce36c4d40bb445a4a5a023108e`. The source working tree was clean when copied. Website assets and the scan are byte-for-byte copies of this snapshot; only the package build target and export helper paths were adjusted for the root layout.

Check files against `SHA256SUMS` before publishing. On systems with `sha256sum`, run `sha256sum -c SHA256SUMS`; on PowerShell, use `Get-FileHash -Algorithm SHA256 <path>`. Regenerate the checksum manifest after intentional edits.
