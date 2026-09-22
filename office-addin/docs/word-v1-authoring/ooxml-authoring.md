# Word v1: native document editing

> Parked on 20 September 2026. This records the experiment preserved on `feature/word-ooxml-experiment` (`91ba3c96` in llmchat, `d8d036e` in the private configuration repository). The active branch uses [structured authoring](implementation-status.md); it no longer registers this interface.

19 September 2026 experiment: the model edits native OOXML parts. The client assembles a complete DOCX before one approved Word import. Existing paragraphs and protected inventory blocks no longer constrain the requested structure in that experiment.

## Interface

| Layer        | Contract                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Routing      | Prefer advertised `word_document_ooxml` for every included-document request, including empty documents. Capture failures remain on this route with an explicit unavailable status, without silently substituting paragraph edits.                |
| Capture      | Complete DOCX through `getFileAsync(Compressed)`, checked slices, closed file handle, immutable snapshot bound to the send and producing assistant message.                                                                                      |
| Model read   | `read_word_ooxml(snapshot, path, offset)`: empty path lists the manifest; XML paths return pages. Follow `next_offset` exactly. Offsets are JavaScript UTF-16 code units. Read each existing XML part completely before changing or removing it. |
| Model output | One complete `erato-word-ooxml` JSON fence and one successful `propose_client_action` for `word.apply_ooxml_package`. Stopped, truncated, unauthorized or ambiguous responses cannot apply.                                                      |
| Assembly     | Complete XML part replacements or exact unique XML patches on the captured copy. Both assemble a complete candidate DOCX before consent. Unmodified parts and binary assets retain their bytes.                                                  |
| Validation   | XML syntax; required package roots; content types; relationship targets/references; part paths; duplicate replacements; read coverage; ownership; sizes. This is package integrity validation, not a full OOXML schema or layout validator.      |
| Write        | Document-level `insertFileFromBase64(..., "Replace", options)`, importing styles, theme, paragraph spacing, page color and odd/even settings. No body-only fallback or automatic retry.                                                          |

The vocabulary is Word's own XML. It supports native text, headings, lists, tables, drawings, sections, headers, footers, notes, comments, fields and content-control markup. No XML inventory block is artificially protected or restricted to being retained. Real Word document permissions still apply. XML-bearing parts such as VML are identified by content type, not only by filename extension.

Binary assets can be reused or removed by reference. This interface does not synthesize image pixels or edit arbitrary embedded binary formats. Adding XML content requires valid supporting relationships/content types. Clearing can remove mixed body objects and empty headers, footers and annotations. Word retains a mandatory final paragraph, sometimes containing whitespace.

Clearing content still requires valid native markup: keep footnote/endnote separator definitions referenced by settings and clear associated comment extension/ID records when removing comments. These are package mechanics, not restrictions on which user content can be removed.

### Complete parts

```json
{
  "version": 1,
  "snapshot": "ooxml-token-from-this-send",
  "mode": "parts",
  "parts": [
    { "path": "word/document.xml", "xml": "COMPLETE XML FOR THIS PART" }
  ],
  "removeParts": []
}
```

### Exact XML patches

```json
{
  "version": 1,
  "snapshot": "ooxml-token-from-this-send",
  "mode": "patches",
  "patches": [
    {
      "path": "word/document.xml",
      "search": "exact unique source XML",
      "replace": "replacement XML"
    }
  ],
  "removeParts": []
}
```

These explanatory strings are not valid document examples. The experiment branch contains real native proposals in `office-addin/src/test/fixtures/word-ooxml`; the [local evidence archive](mechanical-experiments/README.md#local-archive) also retains the synthetic backend responses. Patches run sequentially against the copy. Intermediate fragments may be unbalanced, but the final package must validate. A patch can move or replace an entire native structure; it does not limit authoring to paragraphs or create incremental live writes.

## Consent and completion

The card shows “Document update,” the number of **document areas affected**, and their names: main document, headers, footers, notes, comments, styles/layout or other content. These groups come from changed package paths. They are not counts of semantic edits or paragraphs. Hundreds of body edits can affect one area. There is no detailed diff, generated draft preview or XML in the card.

“Apply document update” approves the complete candidate. The private configuration requires consent each time; paragraph-edit and typed-plan grants do not transfer. Applied and declined cards collapse to compact receipts. “Show details” reopens the scope summary. Applied results offer “Revert update” and “Download original” while this pane owns the recovery slot.

Every control uses the frontend library: `Card`, `Button`, `ActionConfirmationCard`, `Alert` and `SpinnerIcon`. Layout reuses Word review classes and theme variables. Package semantics and Word copy remain in the add-in. No replacement component kit or separate button implementation was added.

## State checks and recovery

Before writing, the client re-exports the live DOCX and compares it with the captured source. The fingerprint covers every package part, binary contents, relationships, styles and stories. It normalizes known revision-session/serialization metadata, statistics and save metadata. Paragraph IDs are renamed consistently with annotation references, not simply discarded. It also normalizes calculated page-break markers and adjacent plain text runs with identical formatting: Word can move the markers or split/merge those runs during repagination without an edit. Explicit page breaks, significant whitespace, formatting and bookmark/comment/note/control identifiers remain significant. Unknown differences remain differences. [Microsoft's calculated page-break definition](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.lastrenderedpagebreak?view=openxml-3.0.1)

Immediately before entering the write, the client stores the full original DOCX. A successful write is followed by a post-state capture. If the write or that read fails, the original remains available and the operation does not retry automatically. Native API success is reported as application; it does not certify every semantic change intended by the model.

Revert imports the original **complete file**, including section stories. It checks the known post-state before restoring. If later edits exist or Word cannot provide readable state, a separate “Restore original” confirmation explains that restoring removes later edits. Consent for a changed state is checked again; another edit requires another decision. The original remains downloadable after an interrupted restoration.

Recovery is one slot in pane memory, replaced by the next write and lost on pane reload. It restores content, not historical Undo entries. Native Word Undo remains intact where supported; Erato Revert does not depend on it. Download original retains the captured file even when Word cannot import it.

## Mechanical limits

- Microsoft documents a 4 MB maximum for document-level import, no ActiveX support, and no preservation of document add-in settings. These are host limits, not protected-content policies. [Microsoft document import API](<https://learn.microsoft.com/en-us/javascript/api/word/word.document?view=word-js-preview#word-word-document-insertfilefrombase64-member(1)>)
- Track Changes must already be off. The flow does not change that setting or provide suggestion mode. Existing revision markup is not artificially blocked, but revision/coauthor cases are not broadly certified.
- Local bounds: 64 MiB expanded package, 2,048 parts, 16 MiB proposal, 24,000-code-unit XML pages and 80-part manifest pages. Model context/output limits still apply.
- Office.js provides no atomic compare-and-swap replacement here. Pane operations are serialized and checked before the import, but a coauthor can race the check.
- Windows/web/LTSC, arbitrary templates/embedded objects, locked/data-bound controls, durable recovery and pixel-level layout require further host validation.

## Deployment

To revisit the experiment, use `feature/word-ooxml-experiment` in both repositories. Its private prompt and tool definition are in `erato-subscription-content/configuration-packages/erato-action-facets.toml`. Running it also requires matching sections in the ignored `backend/erato.toml` and a backend restart. These sections were removed from the active configuration when structured authoring was restored.

Legacy paragraph, cursor-insert and typed-plan actions remain for older deployments and historical messages. They are not advertised by the OOXML facet. Their protected-block and typed-plan budget constraints do not apply to the new route.

Use the existing development checkout for manual testing. Check the active branch and matching configuration before starting `just dev-linked` from `office-addin`. Old chat cards retain their old contracts and do not gain a fresh snapshot. The current structured branch deliberately ignores the experiment's action and fence.

See [current structured implementation status](implementation-status.md), [the experiment's production native validation](mechanical-experiments/2026-09-19/production-v1/README.md), [real backend/model evidence](mechanical-experiments/2026-09-19/backend-e2e/README.md) and [earlier native mechanics evidence](mechanical-experiments/2026-09-19/README.md). These archived experiments inform later decisions; they do not change the active structured contract.
