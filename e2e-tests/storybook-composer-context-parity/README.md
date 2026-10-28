# Composer context parity harness

Measures, in a real browser, the composer context after the send
(ERMAIN-1027): the read-only "Sent with" row on a sent user message, the
edit-message composer on the shared lane, the selected tools as chips next to
+, and the send gate the composer runs on items whose estimate is an upload.

What the sent-with chips say is not written here. The add-in's parity test
(`office-addin/src/test/__tests__/sentWithStoryParity.test.ts`) builds each
story's facet with the add-in's real resolvers (`resolveWordActionFacet`,
`resolveWordSelectionFacet`, `resolveWordCommentThreadFacet`,
`resolveOutlookActionFacet`) from the recipes in
`frontend/src/stories/chat/composerContextParityScenarios.ts`, names it with
the add-in's real descriptors in English and German, sizes it with the
library's `actionFacetEstimate`, and writes
`frontend/src/stories/chat/composerContextParity.generated.json`. The
`Chat/ComposerContextParity` stories register descriptors that answer from that
file, and this harness reads it to know what each story must show. After a
deliberate change in the add-in, rewrite the file from `office-addin/`:

```bash
pnpm exec vitest run src/test/__tests__/sentWithStoryParity.test.ts -u
```

`sent-with.spec.ts` checks:

- every sent story against the file: the list named "Sent with" inside the
  bubble's body and under the message text, each chip's kind, label, title
  "label · meta" and spoken "label, meta"; no row where the facet carries no
  content or no host describes it (the quote stays); none on the answer;
- nothing focusable in the row, glyphs hidden;
- the look: an 11 px uppercase muted label, 22 px chips with 12 px text, the
  attachment border colour, the base radius and the secondary text colour;
- a long name cut with an ellipsis inside the bubble at 340 px, the row inside
  the bubble at 480 and 1280 px, no horizontal page overflow;
- label and chip text at 4.5:1 in light and dark;
- German: "GESENDET MIT" and the add-in's German names and dates.

`edit-composer.spec.ts` checks the real `MessageEditor`:

- the lane above the message field, named "Attachments of this message";
- a Teams transcript read from its stored file as one 32 px chip whose (x) is
  drawn without hover inside the chip and takes the transcript and its shared
  files out of the edit (announced with the count, focus back on the message);
  Delete does the same; an unchanged edit sends every file;
- the transcript's detail as a sheet at 340 px and a popover at its chip at
  1280 px, without "Edit selection"; Escape closes only the detail and puts
  focus back on the chip, a second Escape cancels the edit; Escape in the
  message field or on a file cancels too;
- a transcript still being read as a loading chip that claims its files, and
  one that can't be read as an included chip whose files never show as tiles,
  in any frame;
- "Remove all" taking only the files, the transcript keeping its chip;
- the stored Word selection, Word document and Outlook draft as locked
  "Sent as before" chips with a disabled (x) titled with the reason; Delete
  says the reason; Enter opens the passage as a focusable scroll region with
  the reason; the facet is never sent as a file; a facet the server no longer
  offers shows no chip;
- a component kit's chip face and attachment preview drawing the edit lane;
- contrast in light and dark, and German.

`tool-chips.spec.ts` checks the real `ChatInput`:

- two tools as 28 px chips named "Deselect …" in a group named "Selected
  tools", after + and the model selector, inside the composer at 340 px, Send
  keeping its corner, and no count badge on +;
- the control radius, the secondary background and text, 12 px / 500, hidden
  glyphs;
- a click or Enter or Space deselecting, "{tool} deselected." said, focus on
  the next chip, then the one before, then +; the model selector not moving;
  the live region outliving the last chip;
- an assistant's enforced tools as locked chips with the reason as their title
  and description, a click changing nothing;
- a long name cut within the chip's width;
- with room, the chips on one row with + (add-menu content registered, as in
  the add-ins), and the wide web composer keeping its Tools dropdown with no
  chips;
- Outlook's scheduling mode chip before the tool chip;
- contrast in light and dark, and German.

`send-gate.spec.ts` checks the send gate: an email over the upload size and
emails plus staged files past the per-message count each block Send with the
error placeholder and the matching Send name, and removing the item or a file
clears it; and the German placeholder.

Start Storybook from `frontend/`. The providers need an API root to render,
though nothing is fetched; any address works, and one that refuses
connections keeps the harness off a running dev stack:

```bash
VITE_API_ROOT_URL=http://127.0.0.1:9/api/ \
  pnpm exec storybook dev -p 6306 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-composer-context-parity/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port.
