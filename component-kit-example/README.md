# Erato Component Kit Example

This package builds a runtime-loaded component kit for the Erato frontend.

The kit registers one component for each current `ComponentRegistry` extension
point. Each component adds `data-component-kit="example"` at its top level so
runtime loading is easy to verify in browser dev tools.

Components live in `src/components/*.tsx`, with one file per example component.
The `src/index.tsx` entrypoint only imports those components and registers the
kit.

## Import-map contract

Kits import shared host modules with plain import statements and leave them
external in the bundle; the host emits an import map (the backend in
production, the frontend dev plugin under `just dev`) that resolves every
shared specifier to the app-bundle chunk. One module instance everywhere —
the host's React, contexts, query client, router and singletons apply
directly, so kits need no react shims and no provider wrappers.

- Third-party: `react`, `react/jsx-runtime`, `react-dom`, `@lingui/core`,
  `@lingui/react`, `@tanstack/react-query`, `react-router`,
  `react-router-dom` — import normally, keep external.
- Host surface: `@erato/frontend/shared`, a frontend-owned barrel for the
  components, providers, hooks, and stores that kits may consume. Its types
  come from the same package export.
- Version handshake: import `ERATO_SHARED_SURFACE_VERSION` from that barrel and
  warn on mismatch (see `src/index.tsx`).

Values may NOT be imported from `@erato/frontend/library` — that path is
types-only for kits (the flat bundle would be duplicated wholesale into the
kit, including a second copy of every React context).

## Build

Build the frontend library first, then build the kit:

```sh
cd ../frontend
pnpm install
pnpm run build:lib

cd ../component-kit-example
pnpm install --no-frozen-lockfile --lockfile=false
pnpm run i18n:extract
pnpm run i18n:compile
pnpm run build
```

The output is written to `dist/` and includes:

- `index-<hash>.js`
- `style.css`
- `locales/<locale>/messages.json`

At runtime, Erato loads a small runtime entrypoint before component kits. This
sets `window.ERATO_REACT` and `window.ERATO_LINGUI_REACT`, so kit entrypoints
can use the host React singleton and host Lingui provider immediately without
bundling separate copies.

The example locale source catalogs live under `src/locales/`. `pnpm run
i18n:extract` updates the `.po` files, `pnpm run i18n:compile` generates
`messages.json`, and the Vite build emits those compiled catalogs into
`dist/locales/`. The main frontend loads them from
`/public/component-kits/example/locales/<locale>/messages.json` based on the
registered component kit name.

## Frontend Dev Server

When running the frontend through `just dev`, Vite serves the HTML directly and
the backend component-kit discovery path is not used. To load this kit in that
mode, build the kit in watch mode:

```sh
cd ../component-kit-example
pnpm run dev
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

## Storybook

This package has two Storybook configurations. Both install the same host
runtime globals that Erato provides before loading component kits:
`window.ERATO_REACT` and `window.ERATO_LINGUI_REACT`.

Use the live configuration while developing the kit source:

```sh
cd ../component-kit-example
pnpm run storybook:live
```

This compiles Lingui catalogs, starts Storybook on port 6007, and loads
`src/index.tsx` plus `src/style.css` through Vite so component changes can
live-reload. The reusable `eratoComponentKitLiveStorybook` helper applies the
frontend's React and Lingui source transforms, including to components reached
through `@erato/frontend/shared`.

Use the built configuration to inspect the emitted component kit:

```sh
cd ../component-kit-example
pnpm run storybook:built
```

The built preview uses the reusable `@erato/frontend/component-kit/storybook`
Vite plugin. The frontend package supplies its generated host manifest and
runtime facades; the plugin injects the import map before Storybook's module
scripts and loads the emitted kit as an untouched browser module.

This runs the normal kit build first, starts Storybook on port 6008, and loads
the generated `dist/index-*.js`, `dist/style.css`, and compiled catalogs. That
path mirrors the browser runtime path where the host app loads built kit files
after the React runtime entrypoint.

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
