# Structured rich-content native validation

20–21 September 2026 · Word for Mac 16.113.1 · Office.js host 16.113.917.1.

This run exercises the expanded **typed structured contract** with the production capture, parser, compiler, full-document Apply, readback comparison and Revert functions inside a real Word task pane. The model-facing interface remains JSON. The host compiles and imports a complete DOCX and saves the exact original before any mutation.

Only the disposable synthetic document `erato-structured-validation.docx` was changed. No user document, production service or global Office cache was modified by this harness. The native harness does not exercise a backend/model conversation or click the production consent UI; those interfaces have separate automated coverage. Windows and Word web were not tested in this run.

## Evidence

- [Native result summary](native-results-summary.json) retains every production outcome, diagnostic, write count and timing. Fingerprints are hashed and inventories counted; the complete original remains in the local archive.
- [Independent DOCX profiles](independent-profiles.json) compare restored documents without importing production comparison code.
- [Host provenance](provenance.json) and [implementation file hashes](source-sha256.json) identify the environment and tested working-tree source.
- The [local evidence archive](../../README.md#local-archive) contains `2026-09-21/structured-rich/native-rich-evidence.zip`: synthetic DOCX/XML states, typed proposals, the event journal and harness scripts. Earlier failed experiments remain in the journal; they are not counted as passes.

| Native case                     | Observed outcome                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paragraph typography            | Alignment, font, size, emphasis, color, shading and spacing applied and verified; original restored.                                                                                     |
| Existing table                  | Source rows reordered and a cell replaced, with other cells retained and table formatting changed; original restored.                                                                    |
| Document parts and layout       | New header, footer, footnote, endnote and comment, with anchors and landscape columns; original restored.                                                                                |
| All six content families        | Body replaced with a heading, paragraphs, table, image, native shape, bookmark, content control and field; document parts and two section layouts changed; original restored.            |
| Complete clear                  | Body, native objects and annotations removed; one genuinely empty required Word paragraph remains; original restored.                                                                    |
| Locked content controls         | Ordinary locks temporarily released after the backup; both a formatted rewrite and complete clear applied; original content and locks restored.                                          |
| Many edits in a long document   | A 368-block result applied and verified. The saved DOCX restored the original after Word's native Undo history was explicitly cleared.                                                   |
| Fresh document                  | Starting without numbering or annotation parts, created heading styles, a multilevel list, an attached PNG, table, native shape, notes/comment and sections; original restored.          |
| Exception after an actual write | A test injection threw after Word completed its import. The writer reported an interrupted operation, retained the backup and observed the changed state; guarded restoration succeeded. |
| Later edit before Apply         | Reported source changed; zero rewrite imports; the later edit remained.                                                                                                                  |
| Later edit before Revert        | Reported source changed; zero restoration imports; the later edit remained.                                                                                                              |

Existing-object updates also passed in native commands 107–108: image resizing/cropping/borders, a changed locked field instruction, a renamed bookmark and replaced control content/metadata. Final native commands 105–128 reran six content cases and their restorations with the completed comparison code. The fresh-document case is 97–99; locked-control and interrupted/long-document recovery cases are recorded separately in the results.

All eleven independent restoration profiles match. They cover paragraph text and formatted runs, table cells, image bytes/dimensions, sections and running content, annotations, fields, bookmarks, controls, links and relationship completeness. These checks supplement the production verifier; they do not assert byte-identical native exports or exhaustive rendering equivalence. Word's own export may retain unused registrations after a successful restore. The recovery download still contains the exact saved original bytes.

## What the native tests changed

The expanded compiler creates valid Word definitions and relationships for new styles, numbering, media and document parts. Native import is not a byte-preserving XML operation. The tests exposed and constrained normalization of annotation IDs, duplicated running-content parts, compatible drawing fallbacks, table layout defaults, field/control serialization and inherited formatting.

Fresh-document testing additionally required complete linked heading styles, note separator settings and handling of unused numbering/style registrations retained after restoration. The comparator resolves active references and list identities; changed text, geometry, fixed widths, list continuation, annotation anchors, active styles and unknown content remain significant. Regression tests include negative mutations, not only successful round trips. The strict fingerprints used to reject later edits do not use these broader post-write comparison rules.

Word inserts a literal space when importing an otherwise empty paragraph. A narrowly guarded cleanup removes only that import placeholder after a requested full clear. It does not trim ordinary document whitespace or erase object-bearing paragraphs.

The long-document test exposed duplicate paragraph text in the read projection and an inappropriate reuse of input budgets during output verification. Uniform run formatting is now projected once; mixed runs remain explicit. A valid expanded output can be verified and restored without relaxing the model's input limits.

## UI validation

The review uses the frontend library's controls and theme tokens. Literal document formatting uses its existing DOCX paper colors so, for example, a document's dark blue text remains legible in a dark application theme. Wide tables scroll within the preview at 320 and 400 pixels without overflowing the task pane. Browser checks covered keyboard scrolling and light/dark contrast; component tests cover exact DOCX recovery downloads and retry behavior.

- [320 px dark review](draft-320-dark.png)
- [400 px dark formatting preview](formatting-400-dark.png)
- [400 px section details](sections-400-light.png)

These are semantic previews of the structured plan. Word remains responsible for final pagination, floating-object positioning and field calculation.

## Automated checks

The final full suite passed **1,997 tests in 178 files**, with formatting, strict ESLint, TypeScript, locale extraction and the production build also passing. Locale extraction retained 28 pre-existing missing translations in each non-English catalog; all new Word messages are translated. The build retained the existing large-chunk warnings. Final command logs are included in the evidence archive.

An earlier full run overlapped other checks and hit two default five-second test timeouts. The full rerun passed without changing assertions or timeouts. Native host tests and automated simulation are reported separately above.

## Reproduction and boundaries

Obtain and verify the [local evidence archive](../../README.md#local-archive), then extract its `native-rich-evidence.zip` into `/private/tmp/erato-word-rich-20260920`. The harness permits writes only to `/private/tmp/erato-word-structured-20260920/erato-structured-validation.docx` or its macOS `/tmp` alias. Create that disposable file from an included fixture. `build.mjs` bundles the production functions from a supplied checkout; it does not substitute a test-only compiler or verifier.

Run `node build.mjs /absolute/path/to/llmchat`, then `python3 server.py`. The HTTPS server binds only `127.0.0.1:3044` and uses the existing local Office development certificate; no certificates are included in the archive. Sideload the supplied temporary manifest and activate **Erato Structured Validation** only in the fixture. `run_cases.py`, `locked_cases.py` and `recovery_cases.py` contain the case sequences. `command.py` can prepare/apply/restore the `fresh` case after reopening the minimal fixture. Do not run a fixture reset over a user's document.

Remove the temporary manifest, stop this test server and close the fixture without saving when finished. The add-in's normal linked server, backend and login setup are separate. For product retesting, follow the [current implementation status](../../../implementation-status.md) and [configuration deployment notes](../../../structured-rich-content-deployment.md).

The temporary native manifest and test server were removed after this run, and the disposable document was closed without saving. The separate browser preview server was also stopped.

Complete document editing requires WordApi 1.7, compressed-file capture, Track Changes off and a resulting DOCX within the native 4 MiB import limit. The saved original is held in the pane's recovery slot; reloading the pane loses that in-memory slot. The full original remains downloadable after an uncertain operation. Native document protection, unsupported host operations and later edits remain observable boundaries.
