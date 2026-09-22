# Implementation sequence and release evidence

Original release plan · 18 September 2026 · See [current implementation and validation status](implementation-status.md) for completed work, the compiler decision and outstanding native gates. This sequence remains the acceptance checklist.

## 1. Native capability spike first

Build a small isolated harness using fixture documents, outside production action routing. Compare native paragraph/range/list operations with a minimal, host-generated OOXML compiler. Test the same semantic plan: 7 sections become 5; move the recommendation to the front, merge two sections, split a paragraph into headings and prose, preserve a native list, and explicitly remove duplicated content. Include a long 320-paragraph version and separate rich-content fixtures.

Record the exact Word host/build, requirement sets, save state and tracking mode. Cover Word on Mac, Windows and web for every host the release claims to support. Check declared manifest requirements against the APIs actually used, including paragraph identity availability and any supported LTSC builds. API documentation and mocks do not certify a host.

Deliver a capability table per operation/content type and choose the compiler path from evidence. Default recommendation is native operations; minimal generated OOXML is an alternative where native operations cannot preserve the required structures. Whole-body replacement must independently prove relationship, style, list and recovery fidelity. Never choose it only because it is a short implementation.

| Probe                     | Required evidence                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structural edit           | Word Navigation pane recognizes new headings; lists are real lists; output can have a different paragraph count and order                                                            |
| Styles and inline content | Existing style definitions, emphasis and hyperlinks survive kept blocks; replacement styling is predictable; localized headings work                                                 |
| Protected islands         | Tables, pictures, fields, comments, note anchors, section breaks and content controls are inventoried; supported moves preserve relationships; unsupported moves stop before writing |
| Existing revisions        | Track Changes off/on and pre-existing revisions each have documented supported behavior; the add-in does not toggle the user setting                                                 |
| Failure                   | Fault injection between operations/syncs identifies partial writes accurately; repeated delivery cannot apply the same plan twice                                                    |
| Recovery                  | Verified restoration preserves the tested content; user/coauthor edits after application make blind snapshot replacement unavailable                                                 |
| Performance               | Measure read/compile/apply/verify latency and UI responsiveness on long fixtures; derive host-specific limits rather than copying speculative caps                                   |

Native rich-content preservation is the largest technical uncertainty. If an object type cannot be safely moved, keep it protected in place and explain the restriction, or decline the affected plan. Do not silently convert it to text. The release must still demonstrate meaningful whole-body restructuring on the supported content set; a renamed paragraph editor does not pass.

## 2. Capture, page and budget the body

Extend [document reading](../../src/word/utils/readWordDocument.ts), [argument building](../../src/word/utils/buildWordDocumentArgs.ts), capture ownership and the Word document-source lifecycle. Maintain an immutable snapshot inventory and read-only block paging. Avoid overlapping body/table-cell representations. Keep binary/OOXML fragments on the host; give the model concise schema, references, readable content and preservation constraints.

Use the existing [client executor contract](../../../frontend/src/hooks/chat/clientToolExecutors.ts) and [result dispatch](../../../frontend/src/hooks/chat/handlers/handleClientToolCall.ts). Add Word-owned registration with cleanup; do not import Outlook components. Audit backend tool declarations, tool-result history/token accounting and the configured per-message tool-call budget. Existing infrastructure carries results, but does not automatically provide these document semantics.

At `f0192814`, the facet argument guard is 64 KiB per argument in [message streaming](../../../backend/erato/src/server/api/v1beta/message_streaming.rs); the body text budget is 61,440 bytes. The tool-call default is 15 in [generation config](../../../backend/erato_config/src/config.rs). Neither is a universal Word limit. A larger generic HTTP JSON limit would not solve model context/output budgets.

Acceptance: complete bounded coverage includes facts beyond the old head window; oversize paragraphs are fully reconstructed; stale/expired cursors, disabled inclusion, host switches, stopped requests and replay have explicit outcomes; no full-rewrite proposal survives incomplete or context-evicted input.

## 3. Pure plan validation and preview

Introduce a new versioned document-plan module alongside [wordEditPlan.ts](../../src/word/utils/wordEditPlan.ts). Finalize schema from step 1. Validate allowlisted block/run types, source ownership, complete scope, output IDs/order, supported styles/list continuity and payload size. Reject partial JSON, unknown versions, malformed fences, unsupported formatting and an action with a mismatched capture. No permissive “repair” that discards unrecognized operations.

Produce one deterministic output model used by both preview and compiler. Compute removals, moves and counts from the source ledger. The model’s declared intent is not executable authority. A source reference cannot smuggle document instructions into tool policy; document text is untrusted data, and approval remains the host action flow.

Acceptance: duplicate paragraphs resolve by captured identity; non-contiguous merges and one-to-many splits work; each source is consumed once; deletion is explicit; preserved blocks never require the model to reproduce their exact text. Every submitted plan is complete before review or execution.

## 4. Action, private facet and coherent execution

Extend [wordClientActions.ts](../../src/word/utils/wordClientActions.ts), its action union/fence declarations, artifact plumbing and facet capability gates for the distinct structural action. Preserve the current paragraph action. Adjust [facet selection](../../src/word/utils/wordActionFacet.ts) so a non-empty document can use authoring capabilities. Prefer available capabilities plus user intent over a client-side keyword classifier. Initial implementation can expand the existing document facet’s advertised capabilities; renaming/adding a facet must be coordinated with backend configuration discovery.

Update private subscription templates in `configuration-packages/erato-action-facets.toml`, currently present on the separate `feature/ermain-820-word-facets` worktree. Paid prompt text belongs there, not in this public source tree. The host, private templates and backend capability configuration must be tested together. Updating only the component kit will not teach the model the new action or contract.

Compile before mutation. Bind the plan to its exact snapshot and consent decision. If any relevant source or tracking/capability precondition differs, reject the complete plan before writing. Serialize applications and record plan execution state to prevent duplicate application on remount/replay. Perform post-write verification and map new anchors only after successful verification.

Acceptance: no mutation during reading/generation/preview; existing paragraph Always permission does not authorize restructuring; Always for the new action follows its own existing permission flow; stale preflight performs zero writes; partial host failure remains visibly uncertain and cannot trigger automatic retry. App-level preflight does not remove concurrent-editor race conditions; step 1 must establish the supported behavior for those cases.

## 5. Review surface and compact result

Extend [WordHostCardRenderer](../../src/word/components/WordHostCardRenderer.tsx) with the structural-plan presentation. Reuse the existing review state and [compact receipt](../../src/word/components/WordReviewReceipt.tsx). The [HTML walkthrough](review.html) illustrates the intended layout and states, not component-kit implementation.

Required views: original/proposed outline, complete proposed draft, source mapping including removals, coverage and unsupported-content state. In a narrow pane show section groups and one expanded group. Keep action labels about the user operation, not schemas or tool IDs. Ready permits application; reading/stale/unsupported/interrupted states do not. Apply operates on the complete plan. Applied/reverted outcomes collapse; interruption stays expanded. Reopening preserves location and filters.

Recovery must check the verified post-state before restoring the body snapshot. After later edits or session loss, do not imply that the original whole-body Revert remains safe or available. A second structural operation invalidates or explicitly chains recovery state; v1 should offer only the latest eligible operation’s restore.

Accessibility acceptance: keyboard reachability and visible focus, labelled disclosure controls, status announced once, no color-only diff meaning, reduced motion support, 320/400 px task-pane checks, long localized strings, copy and verified Show in Word behavior. Do not show an in-pane Accept/Reject revision interface until its native semantics exist.

## 6. Evaluate the model contract before calling it better

Use the same supported models and source documents for three approaches: current paragraph replacements, whole-draft text generation, and the proposed typed plan with reuse references. Score structural task completion separately from format validity. Save anonymized fixtures and expected invariants; do not log private customer documents for benchmarks.

| Fixture/task                                                               | Must measure                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Short restructure, blank compose, ordinary proofreading                    | Correct action choice; no regression in small-edit latency or quality          |
| 320 paragraphs beyond 61,440 bytes                                         | Tail facts retained, all input read, output complete, budget respected         |
| Recommendation-first restructuring                                         | New order and headings follow intent rather than old paragraph shape           |
| Split, merge, deliberate deletion                                          | No accidental drop/duplication; deletion visible; factual constraints retained |
| Numbers, dates, quoted text, links, bilingual text                         | Meaning/required exact values preserved; Unicode offsets and previews match    |
| Repeated identical paragraphs and empty blocks                             | Correct reference ownership and placement                                      |
| User/coauthor changes during generation or apply                           | No stale silent overwrite; truthful uncertain-write state                      |
| Truncated output, refusal, invalid references, instructions in source text | No executable partial plan or unauthorized side action                         |
| Reopen, resend, resume, host switch, pane close                            | No duplicate application or recovery against a different document              |

No unsupported claim that structured JSON guarantees semantic correctness. For the supported deterministic fixture set require zero dropped source references, unknown references, accidental duplication or unsafe writes. For model-quality runs report first-pass validity, repair rate, factual retention, latency and token cost with the model/version and run count. Select the representation from those results, not a vendor’s general benchmark.

## Roadmap follow-through

Before implementation is merged, update the live Word project deliberately: promote structural body authoring and bounded body reads into v1; keep selection in v2, comment workflows in v3, native suggestion/write-channel work in v4, and attributed document comparison/template import/general exploration in later planning. Link this decision and its native evidence to the relevant milestones and supersede the old statement that all whole-document rewriting requires desktop comparison.

The present research task has read the live project but has not published these new decisions. It also has not changed subscription templates. Those are explicit integration work items, not already-completed deliverables.
