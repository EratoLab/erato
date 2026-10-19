# Composer context fixes harness

Measures, in a real browser at the Office task-pane width (340 px), the shared
pieces the add-in's composer context fixes rely on:

- a dropped email's Remove pinned beside its collapsed card's disclosure;
- attachment boxes under an unticked thread message reading unticked;
- an image upload shown under a display name ("Image") still drawn as a
  thumbnail, and as an image row in a picked message;
- the staged count reading files shown elsewhere against the limit;
- stacked dialogs each named by their own title.

No theme pack is needed. Start Storybook from `frontend/`; the providers need
an API root to render, though nothing is fetched:

```bash
VITE_API_ROOT_URL=http://localhost:4180/api/ \
  pnpm exec storybook dev -p 6300 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-composer-context-fixes/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port.
