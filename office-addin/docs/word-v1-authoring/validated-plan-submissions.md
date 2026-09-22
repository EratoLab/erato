# Validated Word plan submissions

Structural authoring uses the generic backend [submission contract](../../../backend/client-submissions.md) through the client executor `word/submit_document_plan`. The plan is the tool's argument object. Legacy `erato-word-document-plan` messages still render; new structural submissions do not need an assistant-text fence or a separate `propose_client_action` call. Paragraph-edit and cursor-insertion routes are unchanged.

## Validation and review

The configured JSON Schema checks the recursive envelope, entry and block shapes before client dispatch. The existing Word parsers then validate block-specific properties, styles, ownership, read coverage, nested IDs, tables, stories, sections and source references. Their optional diagnostic output contains bounded JSON Pointer paths, stable codes and technical constraints. Detailed formatting remains the read tool's public contract; the configured schema does not duplicate that entire vocabulary.

The submission also compiles the plan and verifies the prepared structure against its captured source without invoking Office.js. Failure returns compact diagnostics into the backend's bounded correction loop. Success returns only a receipt containing the tool-call draft ID, snapshot and action. It neither consumes the snapshot nor changes Word. Repeated execution of the same call has no write side effect.

The backend saves the input and accepted receipt, ends generation, and emits completion. The Word host validates the receipt and permitted action, then uses `HostArtifact.submittedCard` to render its existing frontend host card. A duplicate legacy plan fence is suppressed when an accepted card exists. Failed, pending, mismatched and ambiguous receipts do not become review cards.

Applying still uses the existing consent policy, current document identity, source fingerprint, tracking checks, original-document backup and Revert. Acceptance is not permission to write. A pane reload can restore the saved proposal for inspection; source content and image bytes remain local, so applying requires a new capture. History never triggers automatic application.

Follow-up requests capture the updated document. First-page reads can recover an old token within the current host-bound request; cursors and submissions remain tied to the exact snapshot read. See [snapshot lifecycle and task integration](snapshot-lifecycle-and-tasks.md) for the recovery contract, pending task-stack findings and requirements for later editing steps.

## Parser compatibility

An omitted `deleted` property normalizes to `[]`. Explicit `null`, malformed deletions and unknown fields remain invalid. Every source still has to appear exactly once in keep, replace or deleted; normalization never silently deletes omitted content. Table width `"auto"` remains supported. New-table source indexes remain invalid and now identify the rejected row or cell in their diagnostics.

## Deployment

The deployment-owned authoring facet must allow both `word/read_document_blocks` and `word/submit_document_plan`. The submission definition uses the direct plan schema and `[submission]` settings, normally `max_attempts = 3` and `native_schema = "auto"`. Workflow instructions, tool descriptions and the configured schema ship from the private subscription configuration package, not hardcoded public prompts.

The compact schema preserves optional properties and leaves detailed formatting to the authoritative host parser. It therefore falls back to local validation under the current conservative native-strict gate. No provider/model is assumed to enforce it natively, and no output expansion into required nullable fields is introduced. Schema validation and bounded correction work for every supported tool-capable model. This integration does not claim a measured total-token reduction.

Rebuild the frontend library and add-in together (shared surface 1.16). Restart the backend after deploying the updated TOML, reload the pane and start a fresh document request. An already running backend retains its previous tool definitions.

## Verification

Deterministic tests cover submission without host writes, parser-directed corrections, omitted-deletion coverage, new tables, nested IDs, compilation failures, cancellation, request ownership, replay receipts, persisted review, consent before application and recovery availability. The generic backend tests cover server-side schema rejection, bounded attempts, result delivery and completion without a trailing inference. These checks do not replace testing native Word rendering and application on a real document.
