# Platform Structure

This document describes how frontend platforms share static assets, translations, and theme assets.

## Overview

The system distinguishes between:

- `common`: shared assets and behavior used by the main web frontend
- `platform-*`: assets and overrides for a specific frontend platform, such as `platform-office-addin`

At runtime, assets are served from a shared `/public` hierarchy so deployments can use a consistent unauthenticated route prefix.

## Runtime Layout

### Common web frontend

The main web frontend is served from:

- `/public/common/assets`
- `/public/common/locales/<lang>/messages.json`
- `/public/common/custom-theme/<theme>/...`
- `/public/favicon.ico`
- `/public/favicon.svg`

Theme locale overrides live at:

- `/public/common/custom-theme/<theme>/locales/<lang>/messages.json`

If a theme provides `favicon.ico` or `favicon.svg`, the backend favicon handler will prefer the theme favicon over the shared default favicon.

### Platform-specific frontend

Each additional frontend platform uses its own namespace:

- `/public/<platform>/assets`
- `/public/<platform>/locales/<lang>/messages.json`
- `/public/<platform>/custom-theme/<theme>/...`

For the Office add-in, this is currently:

- `/public/platform-office-addin/...`

The Office add-in is also still exposed under `/office-addin` as a legacy bundle path for manifest compatibility, but its canonical production asset path is `/public/platform-office-addin`.

## Source Layout

### `frontend`

Authored source files remain in:

- `frontend/public`
- `frontend/public/custom-theme/<theme>`
- `frontend/src/locales/<lang>/messages.po`

During build:

- general static files from `frontend/public` are emitted under `out/public/common/...`
- compiled Lingui catalogs from `frontend/src/locales` are emitted under `out/public/common/locales/...`
- theme files from `frontend/public/custom-theme/<theme>` are emitted under `out/public/common/custom-theme/<theme>/...`

This means the authored source tree stays simple, while the built output matches the runtime `/public/common/...` structure.

### `office-addin`

Authored source files live in:

- `office-addin/public`
- `office-addin/src/locales/<lang>/messages.po`

During build:

- add-in assets are emitted under `dist/assets`
- the bundle base path is `/public/platform-office-addin/` in production
- compiled Lingui catalogs are emitted so they are available at `/public/platform-office-addin/locales/<lang>/messages.json`

## i18n Model

The shared frontend library resolves locale data using:

- `frontendPlatform`
- `frontendPublicBasePath`
- `commonPublicBasePath`

These values come from either:

- backend-injected `window.*` globals
- Vite `VITE_*` variables

For the Office add-in, startup code mirrors the add-in Vite env into `window.*` so the shared `@erato/frontend` bundle can resolve env consistently even when it is consumed as a packaged dependency.

## Theme Resolution

Theme selection is controlled by `frontend.theme` in backend config or by the corresponding frontend env globals during standalone development.

Theme assets are resolved relative to:

- `/public/common/custom-theme/<theme>` for shared theme assets
- `/public/<platform>/custom-theme/<theme>` for platform-specific theme assets when present

Theme source directories are authored in the source `public/custom-theme/<theme>` tree and do not need to be pre-expanded into a `public/common` source directory.

## Backend Serving

The backend is aware of:

- the web frontend bundle path
- each additional platform bundle path
- the public mount path for each platform

It serves:

- the main frontend from `/`
- platform bundles from `/public/<platform>`
- optional legacy bundle paths where configured
- favicon requests via a dedicated resolver that prefers theme-specific favicons first

## Practical Guidance

- Put shared web themes in `frontend/public/custom-theme/<theme>`.
- Put shared web locale catalogs in `frontend/src/locales/<lang>`.
- Put add-in locale catalogs in `office-addin/src/locales/<lang>`.
- Use `/public/common/...` and `/public/<platform>/...` as the canonical runtime URLs.
- Do not author files in a source `public/common` tree.
