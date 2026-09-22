# Word v1: real backend, GPT-5.2 and native Word validation

19 September 2026. **The proposed OOXML interface worked through the real Erato backend and Word for Mac.** Six evaluated model-generated proposals passed package validation, native application, deterministic content checks and independent full-DOCX recovery. Seventeen fixed invalid-input and guard checks passed.

One long-document proposal was applied and verified by replaying its saved response after correcting a harness delivery problem. It is not counted as an uninterrupted end-to-end run. Five other evaluated proposals completed the full automated sequence. An additional clear-generation attempt was stopped during the harness correction and excluded from the evaluated cases.

This supports implementing the adjusted v1. **The experimental OOXML adapter and snapshot recovery are not integrated into the production task pane.** Production still uses the earlier typed document plan and its existing Revert implementation.

## What actually ran

- Current Erato Rust backend source, commit `06b0df487946274d8eda8df92c4f486a7cff07e6`, built without backend source changes. An isolated instance ran on `127.0.0.1:3134`; the user's existing instance on port 3130 was left running.
- The existing `gpt-5-2-responses` provider from `backend/erato.toml`: `gpt-5.2`, configured medium reasoning. Provider configuration and credentials were read in place. This was a real model call through Erato, not a direct provider script or a mock.
- Real `/messages/submitstream` requests, client-tool events and `/messages/clienttoolresult` replies, followed by the backend's validated `propose_client_action` output. The experiment used a temporary `word_ooxml_experiment` facet and `word.apply_ooxml_package` action.
- A temporary Python client adapter exposed immutable OOXML parts, checked complete reads of changed parts, parsed the completed proposal and assembled its DOCX. It retained unmodified parts and binary assets from the original snapshot. It exercised the backend protocol; it did not exercise the production React event handler or consent card.
- An isolated task pane running real Office.js in **Word for Mac 16.113.1**, diagnostics `16.113.917.1`, with Track Changes off. It captured real DOCX snapshots and applied candidates using document-level `insertFileFromBase64(..., "Replace", options)`.
- Explicit automated approval limited to the disposable fixture and candidate. Production consent UI was not bypassed or changed; that UI was outside this experiment.

The sequence was: Word capture → backend/model reads → completed action proposal → package validation → unchanged-source check → fixture approval → native Word import → assertions → clear native Undo history → independently restore the full original DOCX → compare.

## Results

| Case                                       | Evaluated runs |   Generation time | Backend completion tokens | Outcome                                                                   |
| ------------------------------------------ | -------------: | ----------------: | ------------------------: | ------------------------------------------------------------------------- |
| Mixed content, complete XML parts          |              2 |   67.96 / 73.80 s |             6,796 / 6,745 | Both applied and recovered correctly                                      |
| Complete clear, complete XML parts         |              2 | 109.10 / 103.42 s |           10,385 / 10,071 | Both cleared and recovered correctly                                      |
| Long document, complete main XML part      |              1 |          573.85 s |                    51,470 | Generated proposal passed; native application/recovery verified by replay |
| Same long-document task, exact XML patches |              1 |           38.64 s |                     2,546 | Full sequence passed                                                      |

Times cover the backend/model exchange, including client reads, but exclude native application. Completion counts are the backend's recorded totals, including reasoning and intermediate turns. These are small-sample observations, not a performance guarantee.

**Mixed content:** move the recommendation paragraph, rename a real heading, change a table value and add a row, update both section headers, and edit an unlocked, unbound content control. Assert preservation of unrelated text, paragraph styles/run formatting, footers, margins, image hashes and dimensions, lists, comments, footnote, bookmark, field and hyperlink.

**Long document:** 320 numbered fact passages plus mixed content, 339 paragraphs in the source. Read the complete main XML in three pages, move the final fact to the front, change its prefix and remove only fact 160. All remaining text and order matched the expected result; paragraph formatting and the other tested objects remained intact. The whole-part and patch runs used equivalent native fixture content; Word's serialization metadata differed between captures.

**Complete clear:** remove body content and objects, empty both sections' headers and footers, and clear annotation/note content. Word retained its mandatory paragraph; whitespace normalization was allowed. The check did not require physical removal of unreferenced image files from the ZIP package. Restoring the original snapshot recovered the tested content in both runs.

**Independent recovery:** every evaluated proposal was restored after Word's native Undo history was deliberately cleared. The experimental adapter checked its known post-apply content profile before restoring. This establishes the recovery mechanism for these fixtures. Its fixture comparator is not a general replacement for the production stale-state guard.

The 17 fixed checks covered truncated XML/JSON, wrong snapshot, unsafe part path, duplicate replacement, removal of a required part, broken relationships, XML entities, unread source, missing/ambiguous patch targets, missing action authorization, an incomplete stream containing an otherwise valid proposal, wrong-document delivery, expired commands, unchanged Word state after rejected inputs, and refusal to overwrite a later edit. All passed. No model judge or prose-quality rating was used.

## Consequence for the v1 interface

**Keep OOXML as the editable format and allow both complete-part replacement and exact XML patches.** Both approaches assemble a complete candidate DOCX locally before the single approved Word write. Patches do not imply incremental writes into the open document, and they do not constrain editing to paragraphs.

In the measured long-document pair, normalized proposal JSON was **163,806 bytes** for complete XML and **2,226 bytes** for patches. Generation was about **15 times faster** with patches. Native writes took 116 ms and 125 ms respectively. That difference came mainly from the amount of output the model had to reproduce, rather than Word's insertion cost.

The patch case still read the whole source. Aggregate prompt usage stayed similar: 167,102 versus 166,815 tokens across the backend's model calls. Patch output reduces reproduction cost; it does not make input/context limits disappear. A genuine rewrite of most content will also have larger output than this small-edit case.

A simple v1 can use one consent decision and a compact completed receipt. Detailed in-pane diffs are not required for these mechanics. The host must derive any displayed counts from a defined measure; counts of XML changes should not be described as a precise number of semantic edits.

## Harness corrections and limits

Word's native file-access prompt interrupted the initial fixture switch before a long-document model call. Later, timer-based task-pane polling paused during the long generation. A queued command completed after the runner switched synthetic fixtures. That execution was excluded from the clean-run count, the following clear attempt was stopped, and the saved long proposal was replayed against its exact original source.

The corrected runner uses one disposable host document, long-poll command delivery, explicit document binding, command expiry/cancellation, foreground activation and stop-on-timeout behavior. Wrong-document and expired delivery are included in the passing negative tests. Original logs are retained in the archive; these harness issues are not reported as model failures or silently removed.

Raw full-DOCX package bytes also changed between unchanged-source reads, including settings and note parts. A raw ZIP/part hash is therefore not an established substitute for the metadata-sensitive production fingerprint. See [observed read differences](full-file-read-stability.json). Production integration still needs a stable, sufficiently complete state comparison and full-scope snapshot storage/restoration.

This run did not certify production consent UI, shipping action routing, recovery across task-pane loss, concurrent coauthors, tracking-on documents, Windows/web/LTSC, every Word object type or pixel-level layout. The earlier [native mechanics report](../README.md) records the import-size and document-settings caveats. These experiments introduce no production changes or new release claims for those areas.

Model writing quality was deliberately excluded. A live model's ability to obey the serialization contract still matters, so real-model results are recorded separately from deterministic failure tests. No manual repair of the six evaluated model proposals was needed.

## Evidence and reproduction

- [Results, assertions and original run log](results.json)
- [Measured timings and token counts](metrics.json)
- [Fixed invalid-input and guard checks](failure-cases.json)
- [Native command ledger](commands.json)
- [Backend provenance](provenance.json)
- [Local evidence archive](../../README.md#local-archive), containing `2026-09-19/backend-e2e/reproduction-harness.zip` with the harness, fixtures and model responses

The original run used `/private/tmp/erato-word-e2e-20260919`. The sanitized harness retained in the local archive contains synthetic documents and responses, the adapter and native runner logs. Behavioral instructions and the temporary facet configuration are distributed privately in `erato-subscription-content/docs/word-authoring-experiment/`. Credential files, database credentials and private provider configuration are excluded.

On 2026-09-21, the prompt and configuration were moved out of the public archive. `setup.py` now loads those private files, and the exporter excludes them. Captured results, fixture documents and model responses are byte-identical to the original run; no experiment was rerun. Historical provenance records describe the original run and archive. The private fixture directory records both the original and sanitized archive hashes.

To reproduce locally, obtain and verify the [local evidence archive](../../README.md#local-archive), extract its `reproduction-harness.zip` into the original run directory, and obtain `experiment-prompt.txt` and `experiment-config.toml` from the private fixture directory. Place them beside `setup.py`, run `python3 setup.py`, start the isolated backend from `/private/tmp/erato-word-e2e-runtime-20260919`, and start `python3 server.py` from the harness directory. The backend uses the existing provider configuration through local symlinks; runtime configuration mirroring is disabled. Load the included temporary manifest into Word and open only `erato-mechanics-rich.docx`. The scripts require the local Word development certificate and the paths shown in `setup.py`.

Run `python3 run_cases.py rich-parts:1 long-parts:1 clear-parts:1 rich-parts:2 clear-parts:2 long-patches:1`, then `python3 failure_cases.py`. The live-model command makes billable requests to the configured provider. `python3 collect_metrics.py` reads only these recorded message IDs from the local database. `python3 export_evidence.py` rebuilds the compact evidence files.

After the recorded run, the temporary add-in manifest and configuration symlinks are removed and the isolated backend/harness servers are stopped. Test inputs and results remain for review. Production files, the user's backend configuration and the running backend on port 3130 are unchanged by this experiment.
