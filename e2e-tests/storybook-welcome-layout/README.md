# Welcome layout geometry harness

Measures the `Chat/EmptyStateLayout` stories in a real browser: composer
shell on the pane midline, independent scrolling of the upper and lower
halves, composer growth, and the bottom-aligned variant.

Start Storybook from `frontend/`:

```bash
VITE_API_ROOT_URL=http://localhost:4180/api/ pnpm exec storybook dev -p 6136 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-welcome-layout/playwright.config.ts
```

Set `STORYBOOK_URL` to point at a Storybook on another port.
