# Word comment chips, composer notices and recording status harness

Measures, in a real browser, the Word add-in's comment chips and one-off send
prompts in the composer, and a recording's transcription status on its own
file tile (ERMAIN-1026).

What the Word stories draw is not written here. The add-in's parity test
(`office-addin/src/word/utils/__tests__/wordCommentStoryParity.test.ts`) runs
the add-in's own resolvers (`previewWordSend`, the comment, selection and
document chip models, `useWordContextItems` and `wordComposerNotice`) on the
seeds in `frontend/src/stories/chat/composerContextWordCommentScenarios.ts`,
and on every gesture one or two steps from each seed and along each seed's
flows, and writes `frontend/src/stories/chat/composerContextWordComments.generated.json`.
The `Chat/ComposerContextWordComments` stories draw from that file, and this
harness reads it to know what each story and each gesture must show. The test
also checks the hard rule on every state it writes: no chip says "included"
about something the Send does not carry. After a deliberate change in the
add-in, rewrite the file from `office-addin/`:

```bash
pnpm exec vitest run src/word/utils/__tests__/wordCommentStoryParity.test.ts -u
```

`word-comment-chips.spec.ts` checks:

- every story against the file: chip kinds in lane order, state, tone,
  origin, label, meta, the open button's name ending with the state word, the
  (x) or (+) name, a locked chip's disabled control and reason, the notice's
  text, and the carrier of the next Send;
- 32 px chips inside the lane at 340, 480 and 1280 px, controls inside their
  chip, label and meta cut with an ellipsis, no horizontal page overflow;
  label and meta at 4.5:1 in light and dark; the lane inside the composer box
  above the message field;
- a choice in the warning tokens, off chips dashed and unfilled, a replaced
  chip's italic meta, a gone pick in the error tokens;
- the comment at the cursor: (x), + and Delete with focus kept and the
  removal said; its detail (why, quote, Show in Word, the thread, What is
  sent, lifetime, footer order); Show in Word choosing the thread with the
  detail open, and changing nothing on a comment left out for the message;
  Choose comment… swapping the detail for the picker, Escape back to the chip,
  a pick chosen and announced; Send this instead on the document;
- a cursor in three comments: a card picks, the same chip element turns
  "Chosen by you" with focus kept, and its (x) brings the choice back on that
  element; with the document off the chosen chip keeps its place before Open
  comments and keeps focus; Send waits on the choice and the chip's (x)
  answers it;
- comments on their parent: the passage's checkbox flips the selection's meta
  and the section's heading; the document's count and its comment map;
- open comments: suggested, +, (x) to "Off in this chat", gone once the
  document is included; locked with the chat;
- a gone pick as an error that (x) ends;
- the lane's own words in German, and the web composer with neither lane nor
  notice.

`composer-notices.spec.ts` checks every notice story: the polite region for
info and warning and the assertive one for errors, the mark (spinner, warning
or error glyph, none for plain info), a progress count drawn but never read,
the actions by name, a dismiss button only where the prompt can be dismissed,
the notice inside the composer box above the chips with its buttons inside it
at 340 px, contrast in light and dark; then answering each prompt (Send
without comments, which also ends a gone pick, a pick from the picker, Send
without document beside a document chip that is still reading, dismiss, and
the (x) of a comment the waiting Send could not read), with focus back on the
message field and no gap left behind; and German.

`audio-status-tile.spec.ts` checks the recording stories under `UI/ChatInput`:
no status card and nothing above the composer box, the tile's meta and
`data-status`, a decorative spinner in the icon plate, the status in the
tile's accessible name, Send disabled while recording, transcribing or failed
and enabled once the transcript is ready, the error colours and the error on
hover, the preview with the status and the transcript, and German. On
`UI/FileAttachmentsPreview` `AudioStatuses` and `UI/AttachmentTile`
`StatusBusyAndError` it checks every phase, the retry inside the failed tile's
frame and outside its preview button, "Retrying…" disabled, the Tab order and
the status lines' contrast; and the recording in the Word `Busy` story's file
row.

The Word stories' detail bodies and picker stand in for the add-in's
`WordCommentDetails`, `WordContextDetails` and `WordCommentPicker`; the
add-in's unit tests pin the real components.

Start Storybook from `frontend/`. The providers need an API root to render,
though nothing is fetched; any address works, and one that refuses
connections keeps the harness off a running dev stack:

```bash
VITE_API_ROOT_URL=http://127.0.0.1:9/api/ \
  pnpm exec storybook dev -p 6305 --no-open --ci
```

Run the harness from `e2e-tests/`:

```bash
pnpm exec playwright test -c storybook-word-comments-notices-audio/playwright.config.ts
```

Set `STORYBOOK_URL` for a Storybook on another port.
