# Production v1 native validation

> Historical OOXML experiment, parked on `feature/word-ooxml-experiment` on 20 September 2026. The active branch has returned to [structured authoring](../../../implementation-status.md). The measurements below apply to the preserved OOXML implementation and do not certify the structured write path.

19 September 2026. **All three native cases passed** in Word for Mac 16.113.1 (Office.js host 16.113.917.1). The harness imports the actual production snapshot, paged-read, proposal, apply and Revert implementations, bundled from this checkout. It uses a disposable synthetic document. No user document or new live-model response was used.

| Case             | Native result                                                                                                                                                              | Independent recovery                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Mixed content    | Changed a heading, table value, content control and both section headers. Preserved images, comments, notes, links, fields, bookmarks and lists.                           | Complete original restored after clearing Word's native Undo history.                          |
| Long restructure | Moved fact 320 near the start, renamed it and removed fact 160 in a 339-paragraph document. Verified every remaining paragraph/run and mixed element against the source.   | Complete original restored after clearing native Undo history.                                 |
| Full clear       | Removed visible body text, tables, images, annotations, links, fields, bookmarks and controls; emptied headers and footers. Kept Word's required empty document structure. | Complete original, including stories and objects, restored after clearing native Undo history. |

Native apply, including preflight/capture and post-state read, took 875, 1,512 and 889 ms respectively; recovery took 314, 370 and 394 ms. These are one-host observations, not performance guarantees. Profile comparisons cover text/run properties, tables, image hashes/dimensions, section/page properties, stories, lists and annotations. They do not certify pixel-level rendering or every possible OOXML feature.

## Findings incorporated

- Word repagination can move calculated page-break markers and merge/split identically formatted text runs between exports. The production fingerprint now normalizes that representation. Captured before/after files are regression fixtures; tests also prove that explicit page breaks, significant whitespace and formatting differences remain detectable.
- An early synthetic clear proposal removed required note separator records and retained comment extension metadata. Word returned `GeneralException`; the production recovery path still restored the complete original (commands 28–29, compared with 27). Correcting the test's native markup made full clear pass. The private model contract now includes these authoring details. Package integrity checks do not replace complete OOXML schema validation; native rejection remains possible and must retain recovery.
- Completed scope details also remain available when the chat list unmounts and remounts the card. A UI regression test verifies the receipt, details and recovery remain available without offering to reapply the used proposal.

## Evidence and reproduction

[Structured results](results.json) contain the successful command sequence, timings, recovery assertions and production bundle hash. The [local evidence archive](../../README.md#local-archive) retains `2026-09-19/production-v1/native-production-evidence.zip` with synthetic source/result DOCX files, native snapshots, the browser harness, the production bundle and profile/assertion scripts. It contains no credentials, private prompts or development certificates.

Obtain and verify the local archive and extract its `native-production-evidence.zip` first. The harness is intentionally restricted to the disposable fixture path and localhost:3044; commands expire and target one document. Reproduction requires native Word, its local Office add-in development certificate and sideloading the included temporary manifest. Review and adapt the local paths in `server.py` and `command.py`, open only the synthetic fixture, then run `run_native.py`. The script clears **only that fixture's** native Undo history to demonstrate independent recovery. Remove the test manifest and close the fixture afterward.

The test pane/manifest and local test server were removed after validation. The normal development port remains available for `just dev-linked`.

This adds production-native evidence to the [six earlier real GPT-5.2/backend cases](../backend-e2e/README.md), which are now also fixed client regression fixtures. It does not claim a new live-model chat/UI round trip, Windows/web coverage or broad coauthor/revision certification. See the [implemented interface and limits](../../../ooxml-authoring.md).
