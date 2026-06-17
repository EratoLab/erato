# Erato Component Kit Example

This package builds a runtime-loaded component kit for the Erato frontend.

The kit registers one component for each current `ComponentRegistry` extension
point. Each component adds `data-component-kit="example"` at its top level so
runtime loading is easy to verify in browser dev tools.

Components live in `src/components/*.tsx`, with one file per example component.
The `src/index.tsx` entrypoint only imports those components and registers the
kit.

## Build

Build the frontend library first, then build the kit:

```sh
cd ../frontend
pnpm install
pnpm run build:lib

cd ../component-kit-example
pnpm install --no-frozen-lockfile --lockfile=false
pnpm run build
```

The output is written to `dist/` and includes:

- `index-<hash>.js`
- `style.css`

At runtime, Erato loads a small React runtime entrypoint before component kits.
This sets `window.ERATO_REACT`, so kit entrypoints can use the host React
singleton immediately and avoid bundling a separate React copy.

## Frontend Dev Server

When running the frontend through `just dev`, Vite serves the HTML directly and
the backend component-kit discovery path is not used. To load this kit in that
mode, build the kit in watch mode:

```sh
cd ../component-kit-example
pnpm exec vite build --watch
```

Then create `frontend/component-kits` with one built kit directory per line. A
line can also start with `<id> - ` to choose the URL id instead of using the
directory name:

```text
# Lines can be commented out.
example - ../component-kit-example/dist
```

The file is gitignored. The frontend dev server serves listed directories under
`/public/component-kits/<id-or-directory-name>/` and injects their root
`index-*.js`/`.css` files after the React runtime entrypoint.

## Backend Config

Point the backend at a directory whose subdirectories are component kits:

```toml
[frontend.component_kits]
directory = "./component-kits"
```

For local testing, copy or symlink this package's `dist` directory to
`./component-kits/example` before starting the backend.

## Docker Image

The Dockerfile builds the kit and places the output under:

```text
/app/component-kits/example
```
