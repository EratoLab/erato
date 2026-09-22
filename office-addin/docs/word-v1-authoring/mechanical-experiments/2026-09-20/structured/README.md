# Structured Apply/Revert reliability validation

20 September 2026 · Word for Mac 16.113.1 · Office.js host version 16.113.917.1.

This validates the **active structured implementation**, using its production capture, compile, Apply, verification and Revert functions in a real Word task pane. No model-generated OOXML or full-file import is used by the production write path. DOCX import is used only to reset disposable synthetic fixtures between cases. It does not test the backend/model turn, consent UI, Windows or Word web.

## Result

All integrated native assertions passed. [Native command results](native-results.json), [passing summary](passed.json) and [independent content checks](independent-profiles.json) remain tracked. The [local evidence archive](../../README.md#local-archive) retains `2026-09-20/structured/native-structured-evidence.zip` for reproduction.

| Case                                              | Native outcome                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 source blocks → 49 requested blocks            | Applied and verified; 31 list items in eight distinct groups; Word supplied one empty terminal paragraph.                                                         |
| Mixed content, 16 → 17 blocks                     | Prose enriched/reordered and native table moved; table, image, two sections, field, control, bookmark, hyperlink, comment and note retained.                      |
| Long document, 336 → 337 blocks                   | Applied and verified with retained native objects and stories; 340 source paragraphs including paragraphs inside grouped/native blocks.                           |
| Original-body recovery after clearing native Undo | Four independent restorations succeeded: ordinary rewrite, interrupted write, mixed content, long document.                                                       |
| Actual user edit before Apply                     | Reported source-changed; zero rewrite writes; the later edit remained.                                                                                            |
| Actual user edit before Revert                    | Reported source-changed; zero restoration writes; the later edit remained.                                                                                        |
| Injected exception after a real native write sync | Reported interrupted with sanitized API diagnostic; original saved before the write; fresh post-state observed; guarded restoration succeeded. No mutation retry. |

The final passing run is commands 22–44. Fixture operations include extra readback/profile work: successful Apply took roughly 1.1 seconds for the 49-block case, 1.5 seconds for mixed content and 2.6 seconds for the long document. These are local measurements, not performance guarantees.

The independent Python checker parses the returned package XML without importing production comparison code. It checks exact draft text, list types/group count, table cells, image-byte hashes and dimensions, section stories/margins, comments, notes, links, fields, bookmarks, controls and relationship completeness. All four restored profiles matched their original profiles. These are **body-package** observations, not full-DOCX snapshot evidence.

## What native testing exposed

1. Consecutive unchanged exports vary in revision and session metadata. Literal XML fingerprints could reject a current proposal before writing.
2. Import may split equal text runs and regenerate paragraph, row and drawing identifiers. Retained-content checks now share the same normalization used for capture comparison; modern comment references resolve within their proper part. Unknown references and ambiguous IDs remain significant.
3. Word can reorder abstract numbering definitions when importing new lists. Verification resolves each list's abstract definition and compares preserved definitions by content and multiplicity. It retains list-instance identity, start values, formats, indents and overrides.
4. A rewrite ending in text can acquire one unformatted terminal paragraph. Only post-write verification accepts that specific addition. It does not remove arbitrary blank paragraphs from fingerprints, allow a second extra paragraph, or ignore layout properties on the terminal paragraph.
5. An unverified or interrupted write must retain its original body. The card now saves it before the write boundary, retains it through failed restoration, offers guarded restoration when a post-state was observed, and offers an XML download on failure. The download's exact original bytes and recovery controls are covered by component tests; native download UI was not tested in this run.

Earlier failed native commands 5–7 and 20–21 supplied the permanent regression fixtures under `src/test/fixtures/word-authoring-state`. The final native run used rebuilt production modules, not a patched verifier inside the harness.

## Recovery and remaining boundaries

The backup is the original body OOXML package, not a full-document DOCX backup. It lives in the pane's single recovery slot and is replaced by the next write or lost on pane reload. A failed restoration keeps the original; a verified successful restoration clears it. With no readable post-state, the UI retains the download but offers no blind overwrite. New requests must capture fresh state after reloading this patch; old fingerprint versions expire.

This patch does not broaden the model's supported block types, enable rewriting protected native objects, relax section ordering, or enable structural edits while Track Changes is active. It fixes comparison, verification and recovery for the structured contract.

## Reproduction

Obtain and verify the [local evidence archive](../../README.md#local-archive), then extract its `native-structured-evidence.zip` to `/private/tmp/erato-word-structured-20260920`. Its harness refuses any document except `erato-structured-validation.docx` in that directory, accepting macOS's `/tmp` alias for the same path. Synthetic rich/long/empty fixtures are included. The queue expires undelivered commands after 45 seconds.

Run `node build.mjs /absolute/path/to/llmchat`, then start `python3 server.py` using the existing Office development TLS certificate in `~/.office-addin-dev-certs`. The server binds only `127.0.0.1:3044`. Copy the test manifest to Word's `wef` folder and open a copy of `fixtures/rich-source.docx` named `erato-structured-validation.docx`. Restart Word for new sideload registration when necessary; open **Home → Add-ins → Erato Structured Validation**. Run `python3 run_native.py`. Native Undo clearing names only that fixture. Run `python3 check_profiles.py` to independently inspect the captured body packages.

Remove the temporary manifest and close the fixture without saving when finished. Do not clear the user's global Office cache, stop their linked server, or run this harness on a user document. The original validation server and manifest were removed after the run; production configuration was untouched.

## Microsoft references

- [Paragraph and table-row identifier extensions](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/059c4b7b-899d-4045-8456-329872b44002)
- [Paragraph IDs and their per-part scope](https://learn.microsoft.com/en-us/openspecs/office_standards/MS-DOCX/a0e7d2e2-2246-44c6-96e8-1cf009823615)
- [Modern comment ID references](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/9c360cd7-653f-4d82-82be-7bda2488c0c1)
- [Drawing edit identifier](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/a0a968bc-de52-41e3-9869-76ae0ceea0f4), [drawing anchor identifier](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/7d291cf6-38e8-403b-95dc-f132c8b02021)
- [Mac sideload instructions](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)
