# Teams context chips harness

Measures, in a real browser, the Teams tab's transcript as one composer
context item (ERMAIN-1025), as the stories under `Chat/ComposerContextTeams`
play the add-in's picker records and composer bridge around the library's own
`useTeamsTranscriptContextItems`.

What each story and each flow has to draw is not written here: the add-in's
parity test (`office-addin/src/teams/utils/__tests__/teamsStoryParity.test.ts`)
runs the add-in's send preview (`previewTeamsSend`) and the chip hook on the
stories' scenarios (`frontend/src/stories/chat/composerContextTeamsScenarios.ts`)
and writes `teams-chips.expected.json`: every chip's kind, state, label, meta,
x name, removal announcement, detail actions, claimed upload ids and files
the composer did not take, and the ids the next send carries. The test fails when the add-in no longer gives that
file, and this spec fails when a story no longer draws it. After a deliberate
change, rewrite the file from `office-addin/`:

```bash
pnpm exec vitest run src/teams/utils/__tests__/teamsStoryParity.test.ts -u
```

The spec checks:

- every story against the add-in's file: one chip per transcript ("Product
  sync +2 · 3 conversations · 240 messages"), its open button's name ending
  with the state, its always-visible x named "Remove Teams transcript", and
  none of the files it claims in the file row; then a real send whose file ids
  are exactly the chips' claims plus the file row, with no chip left after it;
- geometry at 340, 480 and 1280 px: 32 px chips inside the composer box above
  the message field, the x inside its chip, label and meta cut with an
  ellipsis, two transcripts side by side or wrapped without overlap, no
  horizontal page overflow; label and meta contrast at 4.5:1 in light and dark;
- removal: x and Delete take the transcript and every file it brought and say
  how many; the user's own files stay; Delete on the first of two moves focus
  to the second; "Remove all: 3 files" leaves the chip; a locked composer
  disables the x, says "Teams transcript is locked." and disables the detail's
  removes;
- the detail: a sheet at 340 px and a popover anchored to the chip at 1280 px;
  each conversation with its range, selection line and a named "Open
  conversation"; picked messages with the viewer as "You"; shared files named
  as Teams named them, each with a preview and a remove that is visible without
  hover and sits inside its row; the body scrolling with "Edit selection" and
  "Remove transcript" in view; partial, skipped, pasted-image and unreadable
  transcripts, focus staying in the detail when the last file goes; a file
  the composer did not take named under its conversation; "Open conversation"
  drawn as a link and measured with the detail's text;
- the conversation view in place, with focus on "All conversations" and back;
  a file preview stacked over the detail that Escape closes alone, returning
  focus to the row; a file removed inside the detail leaving the send while the
  chip stays;
- a transcript still being read, whose detail says so and which names itself
  in place; "Edit selection"
  with "Update" replacing the chip's files in place (the same element, focus
  back on it, no frame without the chip or with a claimed file in the row),
  "Update" keeping out a file removed in the detail, "Update" with nothing
  ticked removing it, Cancel changing nothing; the chip
  following the composer's files across a chat switch;
- German in the chip, the detail and the conversation view, its times
  included; and the web
  composer without a lane.

"Edit selection" opens a stand-in for the add-in's chat picker in edit mode,
which needs Microsoft Graph; the add-in's unit tests pin the real dialog.

Start Storybook from `frontend/`. The providers need an API root to render,
though nothing is fetched; any address works, and one that refuses
connections keeps the harness off a running dev stack:

```bash
VITE_API_ROOT_URL=http://127.0.0.1:9/api/ \
  pnpm exec storybook dev -p 6304 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-teams-context-chips/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port.
