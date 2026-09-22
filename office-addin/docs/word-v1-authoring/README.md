# Word v1: authoring a whole document

> Start with the [current implementation status](implementation-status.md) for supported operations, limits and local testing. The [rich structured contract](structured-rich-authoring.md), [deployment pairing](structured-rich-content-deployment.md), [validated submissions](validated-plan-submissions.md) and [snapshot lifecycle](snapshot-lifecycle-and-tasks.md) describe the active implementation.

> **Historical design handoff — 18 September 2026.** The scope descriptions and code findings below record the initial decision. Later rich-content work supersedes their body-only and preservation-only limits. The full-package model-OOXML experiment is parked on `feature/word-ooxml-experiment`. The interactive visuals remain available as design history.

Design contract and implementation handoff · 18 September 2026

**Decision requested by the owner: the first release must support changing a document’s structure.** Keep the existing small-edit experience, and add a coherent document plan for rewriting, moving, merging, splitting and removing content. Native tracked suggestions are a separate write channel and are not a prerequisite.

**Implementation and evidence:** see [current status](implementation-status.md) and the [validation records](mechanical-experiments/README.md). The completed-edit receipt and structural review described here are implemented; the dated records identify which native hosts and behaviors were actually exercised.

Start with the [interactive overview](review.html). The [evidence ledger](sources.md) separates verified facts from recommendations. [Implementation and validation](implementation.md) defines the work and its exit criteria. [Example plan](plan.example.json) illustrates the implemented typed-plan contract; its snapshot/read token values are examples.

## Why this belongs in the first version

The live [Word project](https://linear.app/erato-labs/project/feature-word-add-in-for-context-aware-actions-c0e14dc519f2) still places whole-document rewriting in v5. Its [editing research](https://linear.app/erato-labs/document/word-add-in-deep-dive-editing-change-tracking-and-write-back-fidelity-2a9c42620971) couples it to a desktop document comparison that generates attributed revisions. That is a larger feature than restructuring the current body after review. Microsoft documents `compareFromBase64` as a revision-comparison API requiring WordApiDesktop 1.2; ordinary structural authoring need not depend on that API. [Microsoft reference](<https://learn.microsoft.com/en-us/javascript/api/word/word.document?view=word-js-preview#word-word-document-comparefrombase64-member(1)>)

This handoff changes the proposed first-release boundary in response to the owner’s instruction. It does **not** claim the live Linear milestones have already been updated.

| Capability                                        | First release after this change                                                         | Later work remains                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Proofread or rephrase existing passages           | Existing paragraph review and direct application                                        | Better selection handling in v2                                  |
| Reorganize a non-empty document                   | New outline, reordered sections, splits, merges, additions, explicit removals           | No dependency on v2–v4                                           |
| Create meaningful Word structure                  | Native headings and lists; existing document style vocabulary                           | Template import and broader formatting tools                     |
| Read long documents                               | Complete, bounded reads for the affected body, including content beyond today’s excerpt | General-purpose comment/revision exploration tools               |
| Review a coherent rewrite                         | Before/after outline, proposed draft, source coverage, one plan approval                | Native per-revision accept/reject and write-channel choice in v4 |
| Finish an action                                  | Compact receipt, reopen details, guarded recovery                                       | Richer historical review                                         |
| Comments and precise user selection               | Preserve existing content; do not introduce these editing workflows here                | v2 selection, v3 comment workflows                               |
| Whole-document compare attributed to an assistant | Not needed for direct authoring                                                         | Retain the separate comparison investigation in later planning   |

Keep three independent concepts: **scope** (body, section, selection), **operation** (edit, restructure, compose) and **write channel** (direct now, tracked suggestions later). “The document has text” must stop implying “only rephrase existing paragraphs.”

## What created the original restriction

These are code findings at `f0192814`, not assumptions about the model:

1. [Facet routing](../../src/word/utils/wordActionFacet.ts) selects `word_document_review` for every non-empty document and `word_compose` for an empty one. The private subscription facet instructions and the host’s action list must evolve together.
2. [The plan](../../src/word/utils/wordEditPlan.ts) expresses a paragraph or contiguous span plus replacement **text**. A replacement can contain newlines, so the number of paragraphs is not intrinsically fixed. But the contract has no real heading, list, move, insertion or explicit deletion vocabulary.
3. [The executor](../../src/word/utils/wordApplyEdits.ts) removes trailing target paragraphs and inserts plain text into the first target. Merely telling the model to be more creative will not give that operation native structural semantics or rich-content preservation.
4. [The context builder](../../src/word/utils/buildWordDocumentArgs.ts) sends a head window with a 61,440-byte text budget and a separate outline budget. A long document’s later content is unavailable to the model. A truncated paragraph is not a complete source block.
5. Independent edits can currently skip stale targets. That is useful for proofreading, but unsafe for an interdependent reorganization: deleting an old section while skipping its replacement can corrupt the intended result.

The visual rework did not create these limits. It made the existing action easier to review; the authoring contract is the next necessary change.

## Recommended authoring contract

### Snapshot and inventory

Capture the main body as a versioned inventory with opaque source references, structure, styles, list membership and protected objects. Keep Word IDs, original fragments and any OOXML on the host. References are scoped to document identity, pane session, chat/message and snapshot; an old action cannot bind itself to the current document by matching text.

Editable blocks initially include paragraphs, headings and native list items. Model-visible runs may carry an allowlisted set of marks and existing link references. Objects or unsupported runs become protected references. Blank paragraphs and structural boundaries are accounted for even when not useful prose. Do not omit tables or their cell paragraphs, or count them twice through overlapping API collections.

The product scope is the **main document body**. Headers, footers, notes and other Word stories are not promised as editable v1 content. Their relationships must survive operations in the body; out-of-scope does not mean disposable. A field, note anchor, comment anchor, content control, section break or image can make a proposed move unsupported until preservation is demonstrated.

Microsoft’s paragraph text API omits non-text objects and various special markers. Therefore 100% paragraph-text coverage alone is not evidence of complete document fidelity. [Paragraph API](https://learn.microsoft.com/en-us/javascript/api/word/word.paragraph?view=word-js-preview)

### Read the whole affected scope before proposing its replacement

Add one read-only tool, working name `word.read_document_blocks`, using the existing [client tool executor registry](../../../frontend/src/hooks/chat/clientToolExecutors.ts). Pull this narrow reading capability forward from later planning. It returns a bounded page of the captured snapshot plus coverage and continuation information; it never edits Word.

The request contains a snapshot token and opaque cursor. The host resolves authorization and document context, enforces its own page limits and reports expiry or staleness explicitly. The cursor cannot select another document. Replaying a call returns the same page or an expiry error; it never silently reads a different snapshot. Stop cancels work; switching documents, closing the pane or disabling document inclusion invalidates access. Do not persist raw document snapshots to diagnostic logs.

Completion requires the entire editable input of the proposed body rewrite to have been delivered under the same snapshot. Split an oversized block into ordered fragments and mark it complete only after its last fragment. Track source coverage on the host; the model cannot assert its own “fully read” flag. Protected objects need inventory and supported handling, not invented textual equivalents.

Paging solves transport coverage, not unlimited model context. Budget input, planned output and all tool calls before a rewrite. The backend’s current default is **15 tool calls per message**, so one call per paragraph cannot be the design. Page whole groups, reserve calls for the proposal, and surface a limit before generation if the operation cannot fit. Do not raise that limit globally without measuring latency and cancellation. Audit tool-result retention/context compaction in the integration work: bytes delivered earlier but evicted from usable model context do not justify a complete rewrite.

The first-release long-document fixture must contain 320 paragraphs and enough text to exceed the current 61,440-byte window, with necessary facts near the end. This is an acceptance fixture, **not** a promised maximum. Publish measured host/model limits after the spike. For larger input, offer a clearly narrower scope or explain the limit; never label a partial rewrite “whole document.”

### Plan structure instead of regenerating everything

Use a versioned typed plan with ordered entries:

- `keep`: reuse a captured block at this output position, preserving its supported native representation. Moving it is an explicit outcome.
- `replace`: consume one or more source references and emit typed blocks. This handles splits and merges, including non-adjacent source passages.
- `insert`: emit new typed blocks, with source context references when available.
- `deleted`: explicitly account for removed source blocks with a reviewable reason.

Each input block is consumed exactly once across `keep`, `replace` and `deleted`. Context references for an insertion are non-consuming. Empty replacements are invalid; deletion uses its explicit field. No implicit omission, duplicate ownership or unknown reference is accepted. Output order describes the new document; it is not restricted to the original ordering or original paragraph count. The small [source fixture](plan-source.example.json) and [JSON plan](plan.example.json) form an internally complete example: move the recommendation first, merge two paragraphs, split the background into a heading and paragraph, and remove the duplicate.

All new blocks have unique plan-local IDs. Allow only certified paragraph, heading and list-item schemas, existing style references and supported marks/links. A list must carry native list semantics, level and numbering continuity; text beginning with a bullet does not qualify. The example uses paragraphs/headings only; the list/run schema must be finalized against the native spike before implementation.

The host derives source text, change counts, moves and before/after outlines from the snapshot plus plan. Model prose can explain intent but cannot certify preservation. Source accounting proves there are no missing references; it does **not** prove that a replacement retained every fact. Semantic retention requires evaluation and user review.

Prefer this hybrid representation over full-document Markdown, raw HTML or raw OOXML generated by the model. It reuses content that need not change and keeps Word serialization deterministic. Tiptap’s schema-aware editing and Aider’s format comparisons support testing this direction; they do not establish that it is already superior on our documents. [Evidence and limits](sources.md)

### Compile, validate, then write

Add a separate action, working name `word.apply_document_plan`, to the Word registry and facet capability intersection. Give it its own consent setting and auto-prompt scope. An existing “Always allow” decision for paragraph rephrasing must not grant restructuring permission implicitly. Preserve the existing Ask / Always allow / Deny behavior for this explicitly named action; do not add a second hidden consent system.

Prefer native Word APIs for certified structural operations. Use host-generated OOXML only where the fidelity spike demonstrates a need and a safe package/relationship strategy. Unchanged objects should remain native, not be round-tripped through model text. Microsoft recommends beginning with available Word APIs and escalating serialization only as required. [OOXML guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/word/create-better-add-ins-for-word-with-office-open-xml)

Before writing: validate schema, complete coverage, source ownership, supported content, sizes, document identity, tracking state and all relevant live preconditions. Verify text **and** structural/formatting relationships, because a style or list may have changed without its text changing. Compile and compute the complete preview before the first mutation. Snapshot recovery data only when a write is actually about to occur.

If any input is stale before execution, apply **nothing** and require a refreshed plan. Do not skip parts of a structural plan. However, this is a preflight policy, **not a claim of an atomic Word transaction**. A coauthor can race the validation; an Office call can fail after some work has applied. Minimize the validation/write gap, serialize host actions, verify after writing and retain a precise operation journal. Failure handling and safe recovery are native release gates.

Leave Word’s Track Changes setting under the user’s control. Do not force it off for an easier implementation. Track-on operations and existing revisions require explicit native tests and capability gating. Direct editing in v1 does not promise assistant authorship labels or an add-in accept/reject workflow.

## Review and completion behavior

For ordinary edits retain today’s compact diff list. For restructuring show the scope, coverage, original and proposed outlines, a full proposed-draft view, and an expandable mapping of moved, rewritten, added and removed content. One structural plan has one apply decision. Per-section checkboxes are not in v1: removing one part can invalidate another.

For a long document, show section groups with counts and one expanded group, preserve position and filters, and keep the main action easy to reach in the task pane. Each group must expose its complete source and proposed content, not only a summary. Visual structure in the preview is semantic; it is not a pixel-perfect Word page-layout promise. “Show in Word” uses verified existing anchors; a newly proposed paragraph cannot be located in Word before application.

After success, collapse to a small receipt showing the operation, changed-section count and the ability to reopen details. Reuse the completed-state pattern committed in `f0192814`. Do not collapse an uncertain write into a success receipt. Keep interruption details visible and prevent blind retry.

Recovery needs stronger guards than the current whole-body snapshot replacement: restoring a snapshot after later user or coauthor edits can erase their work. A normal Revert is enabled only when the current affected state matches the verified post-apply state and the snapshot/session remains available. If it does not, explain that automatic restore cannot safely proceed and offer inspection/copy of the draft. Do not promise lossless recovery of unsupported Word features. A partial-write recovery path requires its own state checks and native proof; a saved snapshot by itself is insufficient.

## Decision boundary

Ready to begin implementation: the product scope, plan semantics, long-document coverage rule and review behavior above. First implementation work must resolve the bounded native fidelity spike described in [implementation.md](implementation.md). Ready to ship: only after its host matrix, recovery cases and model evaluations pass. Implementation is recorded in [implementation-status.md](implementation-status.md); this design contract is not native release certification.

## Handoff verification

The standalone HTML was exercised in Chromium at 1440, 400 and 320 px on 18 September 2026. Checks covered all six state choices, disabled application in incomplete/stale/interrupted states, draft and source-mapping views, per-action permission illustration, denial, compact completion, details reopening and the illustrated Revert. No JavaScript errors or horizontal page overflow remained. At the desktop fixture width the review card collapsed from 793 px to 166 px.

The synthetic long fixture has 320 source paragraphs / 83,735 UTF-8 bytes, exceeding the current excerpt budget, and 304 proposed prose paragraphs after 16 explicit removals. Its mapping counts are 180 reused, 124 rewritten and 16 removed. The separate six-block JSON example has complete, unique source ownership. All 27 relative Markdown links resolved. These checks validate the handoff and its examples; they do not validate native Word execution or LLM quality.
