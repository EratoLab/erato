# Outlook context chips harness

Measures, in a real browser, the Outlook add-in's chips in the composer's
lane (ERMAIN-1024), as the stories under `Chat/ComposerContextOutlook` play
the add-in's resolvers from data.

What each story and each flow has to draw is not written here: the add-in's
parity test (`office-addin/src/outlook/utils/__tests__/outlookStoryParity.test.ts`)
runs the add-in's own resolvers on the stories' scenarios
(`frontend/src/stories/chat/composerContextOutlookScenarios.ts`) and writes
`outlook-chips.expected.json`: every chip's kind, state, tone, label, meta,
control name, lock and detail actions, and the mode. The test fails when the
add-in no longer gives that file, and this spec fails when a story no longer
draws it, so the stories cannot drift from the add-in unnoticed. After a
deliberate change, rewrite the file from `office-addin/`:

```bash
pnpm exec vitest run src/outlook/utils/__tests__/outlookStoryParity.test.ts -u
```

The spec checks:

- every story's lane against the add-in's file, and every flow (Delete, +,
  "Try again", "Sign in", a send, ending scheduling) landing where the
  add-in's handlers land; every detail offering exactly the add-in's actions;

- order and names over every story: the ambient chips first in a fixed order
  (selection, draft or appointment, open thread, attachments), then the
  dropped emails in drop order with the drop progress last; each open
  button's name ending with the chip's state; the (x)/(+) named as the add-in
  names them, including "Dismiss email thread" and "Dismiss {name}" on error
  chips; no chip at all for a thread already sent in the chat or dropped as an
  email;
- geometry at the task pane (340 px) and the 480 px breakpoint: 54 px chips
  inside the lane, controls inside their chip, long metas such as
  "3 of 5 messages · 1.2 MB of 25 MB" cut with an ellipsis, no horizontal
  page overflow, a quote label of at most 61 characters;
- tones: error borders (load error, trim failure, cloud file, dropped email
  that can't be trimmed), the warning border of a sign-in, the muted
  superseded look ("Unchanged, not re-sent", "Not sent while scheduling",
  "Replaced by selection", "Sent earlier, not re-sent", "Not sent with
  dropped emails"), dashed suggested chips, and label and meta contrast at
  4.5:1 in light and dark;
- the scheduling mode chip: in the controls row after the add control and
  before Send, 28 px, never in the lane, its end button named and described
  by the "until" text; ending it gives the draft back in the same frame,
  announces the outcome and returns focus to the composer, from the chip or
  from the draft's detail; locked while sending;
- the read flows: Delete and + on a partial thread bringing the earlier ticks
  back, unticking every message ("Nothing chosen") and "Include every
  message", ticking in the detail of a thread left out, a load error turned
  off and retried, a retry that fails again, "Try again", a slow sign-in that
  still announces "Email thread loaded.", a loading thread that can be left
  out while the composer waits, a follow-up's suggested thread, a trim the
  bytes refuse, dropped emails removed outright with focus moving on, their
  read-only body row, the locked drop progress chip, and a send that hides
  the thread;
- the compose flows: dismissing the selection gives the draft back in the
  same frame, "Send this instead" for a draft and an appointment, the draft's
  Delete and +, the attachment group's checklist keeping earlier ticks across
  Delete and +, a group with nothing ticked coming back whole, a follow-up
  attachment included for one message, a cloud file that lands back in its
  error, the appointment's fields, and every control locked with its reason
  while sending;
- the detail as a sheet in the pane and as a popover at 1280 px: the thread
  checklist scrolling inside the sheet with the actions in view, the draft's
  focusable "Draft text" box, and the notes by tone that say why something is
  not sent;
- the lane's own words in German, and no mode chip in the web composer.

The "+" menu rows come from the add-in's registry slot, which Storybook does
not fill; the office-addin unit tests pin them.

Start Storybook from `frontend/`; the providers need an API root to render,
though nothing is fetched:

```bash
VITE_API_ROOT_URL=http://localhost:4180/api/ \
  pnpm exec storybook dev -p 6303 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-outlook-context-chips/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port.
