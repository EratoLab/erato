# Composer context lane harness

Measures, in a real browser, the composer's context lane from the frontend
library (ERMAIN-1022):

- the lane's semantics: one named list, one tab stop, each open button's name
  ending with the chip's state;
- geometry at the Office task-pane width (340 px): 32 px chips, 54 px file
  tiles, always-visible 24 px (x)/(+) controls beside the open button, no
  horizontal overflow, no extra space from a host that has nothing to show;
- state looks against their tokens (dashed suggested, muted superseded,
  warning and error tones, a spinner without a second status region) and
  label and meta contrast at 4.5:1 in light and dark;
- the keyboard model: arrows, Home and End, Delete and + with the outcome
  announced only after the host answers, focus moving on when a chip leaves,
  and no announcement for ambient churn;
- the detail as a bottom sheet in the pane and as a popover anchored to its
  chip on the wide app, with focus moving in, staying in and coming back;
- one capped scroll area shared with files: "+N more", "Show less", a pinned
  "Remove all", an unclipped focus outline, and the German strings;
- the web app's composer unchanged, a kit face inside the host's chip, and
  notices above the lane with a role by tone;
- every host state of the target prototype (Word, Outlook reading and
  composing, Teams) as `composer-context-hosts.spec.ts` checks it: each chip's
  kind, state, tone, name and (x)/(+) name as the prototype has them, all of
  them in view at 340 and 480 px, contrast in light and dark, and the host
  flows the prototype settles (an error dismissed to suggested, + retrying,
  host-worded removals, locked chips, the last chip handing focus back).

No host feeds the lane yet; the stories under `Chat/ComposerContextLane` and
`Chat/ComposerContextHosts` play the host resolver from data. Start Storybook from `frontend/`; the providers need an API
root to render, though nothing is fetched:

```bash
VITE_API_ROOT_URL=http://localhost:4180/api/ \
  pnpm exec storybook dev -p 6301 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-composer-context-lane/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port.
