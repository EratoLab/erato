# Erato Desktop UI

The UI the desktop sidecar embeds in its webview windows. It is the sidecar's
counterpart of `office-addin`: one Vite app built on the packed frontend
library (`@erato/frontend`), one set of Lingui catalogs, one entry per window.
The only window so far is the smoke window (`src/windows/smoke`), which proves
the chain: a kit `Alert` and `Button`, a translated string and the ready
message the sidecar's smoke mode waits for. The strict review window moves
onto this bundle later (ERDSCAR-93).

## Rules

- **No network.** The sidecar serves the bundle over a custom protocol with a
  CSP that blocks every network API (`connect-src 'none'`, see `index.html`
  for the backup meta tag). The app never uses `fetch`, sockets or dynamic
  `import()`; catalogs are compiled in and imported statically; the lint
  config enforces both. Custom themes and component kits stay off.
- **Only `window.ipc`.** The page talks to the host through
  `window.ipc.postMessage(JSON.stringify(message))` when the bridge exists,
  and renders without it in a browser. On mount the smoke window posts
  `{"type":"ui.ready","version":"<package version>"}`.
- **Host input.** The host may set `window.ERATO_DESKTOP_UI` before the page
  loads: `{locale?, themeMode?, version?}`. Unknown locales fall back to
  `en`, unknown theme modes to `system`.
- **Size budget: 5 MiB** of `dist/` per bundle (`scripts/package.mjs`). This
  supersedes the 400 KB JavaScript rule of the earlier design record
  (`peknow/reports/Sidecar review window - UI port and shared UI architecture.md`),
  which assumed a hand-picked source entry rather than the packed library.

## Build and package

The app consumes the packed library, so build the protocol and the library
first (the same order as the add-in):

```sh
pnpm -C ../desktop-sidecar-protocol install --frozen-lockfile
pnpm -C ../desktop-sidecar-protocol run build
pnpm -C ../frontend install
NODE_OPTIONS=--max-old-space-size=8192 pnpm -C ../frontend run build:lib
pnpm install --no-frozen-lockfile --lockfile=false
pnpm run build      # i18n:compile, tsc, vite build → dist/
pnpm run package    # dist/ → release/erato-desktop-ui-<version>.tgz
```

A frozen install fails for the `file:` tarball, whose integrity changes with
every library build. Checks: `pnpm run format:check`, `pnpm run
i18n:extract:check`, `pnpm run lint:strict`, `pnpm run typecheck`, `pnpm run
test`. The frontend CI job runs all of them and uploads the tarball as the
`erato-desktop-ui` artifact.

## Tarball contract

`pnpm run package` writes `release/erato-desktop-ui-<version>.tgz` and
`release/erato-desktop-ui-<version>.tgz.sha256` (`<hex>  <name>`, as
`shasum -c` reads it). The archive root is `package/`:

```
package/package.json    {name, version, private, files}
package/manifest.json   {name, version, commit, totalBytes, files: [{path, sha256, bytes, contentType}]}
package/dist/**         the vite output
```

`manifest.json` lists every shipped file with a path relative to the package
root (always starting with `dist/`), its SHA-256 in hex, its size and a
content type. `commit` is the source commit (`git rev-parse HEAD`) and
`totalBytes` the sum of the listed sizes. The packer refuses source maps and
anything above the budget, and checks the archive after packing: every
manifest path is present under `package/`, nothing lies outside it, no `.map`
entry exists.

## How the sidecar uses it

The sidecar repository mirrors exactly one tarball with
`scripts/mirror_desktop_ui.py`, which builds the app from a main-repo checkout
in the order above and copies the archive in. Its build script extracts the
archive, verifies every file against the manifest hashes and embeds the files
in the binary; a webview host serves them over a custom protocol and sends
the CSP as a header. The embedded bundle therefore sits inside the sidecar's
trust boundary: a change here is a change to the sidecar.
