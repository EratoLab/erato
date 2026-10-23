# Composer context fixes harness

Measures, in a real browser at the Office task-pane width (340 px), the shared
pieces the add-in's composer context fixes rely on:

- a dropped email's Remove pinned beside its collapsed card's disclosure: its
  place, size, focus order and name, the header divider only while expanded,
  the sticky header keeping it above scrolled rows, and its contrast in light
  and dark;
- attachment boxes under an unticked thread message reading unticked, and a
  re-ticked attachment bringing back only itself;
- an image upload shown under a display name ("Image") still drawn as a
  thumbnail, and as an image row in a picked message whose type label does
  not repeat that name;
- the staged count reading files shown elsewhere against the limit, beside
  the files shown here, which are all that "Remove all" removes and names;
- stacked dialogs each named by their own title, including the web app's
  Archive all chats confirmation over Preferences; Escape closes the newest
  one only, and focus goes back to what opened it.

The Outlook draft row and the compose selection chip are now chips in the
composer's lane, measured by `../storybook-outlook-context-chips`; the "+"
menu rows are add-in markup with no Storybook, pinned by the office-addin
unit tests. The Word document row is now the document chip in the composer's
lane, measured by `../storybook-word-context-chips`.

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
