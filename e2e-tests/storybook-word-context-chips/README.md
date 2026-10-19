# Word context chips harness

Measures, in a real browser, the Word add-in's selection and document chips
in the composer's lane (ERMAIN-1023), as the stories under
`Chat/ComposerContextWord` play the add-in's resolver from data:

- order and names: the selection before the document in the one lane, each
  open button's name ending with the chip's state, the (x)/(+) named as the
  add-in names them;
- geometry at the task pane (340 px) and the 480 px breakpoint for every
  story: 32 px chips inside the lane, controls inside their chip, long metas
  cut with an ellipsis, no horizontal page overflow, a quote label of at most
  61 characters;
- tones: warning and error borders from their tokens with the item's own
  glyph, the muted superseded look, dashed suggested chips, and label and
  meta contrast at 4.5:1 in light and dark;
- the keyboard flows: Delete and + with the outcome announced, the document
  given back when the selection leaves, Erato's passage taken over, "Send
  this instead" and "Try again" announcing their outcome, a locked document;
- the detail as a sheet in the pane (quote scrolling on its own, actions in
  view) and as a popover at 1280 px, and the lane's own words in German.

Start Storybook from `frontend/`; the providers need an API root to render,
though nothing is fetched:

```bash
VITE_API_ROOT_URL=http://localhost:4180/api/ \
  pnpm exec storybook dev -p 6302 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-word-context-chips/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port.
