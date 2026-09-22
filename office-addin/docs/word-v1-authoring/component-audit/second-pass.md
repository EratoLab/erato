# Word feature UI: scoped second-pass findings

Historical audit · 2026-09-18 · audited source: `c6898b31`. No application code had been adjusted at the time of this audit. The scoped fixes are now [implemented and validated](implementation.md).

## Scope correction

The requested work concerns **UI introduced or materially changed by the Word feature**. My second pass expanded that into general add-in cleanup; that was too broad.

The implementation scope is the eight new components under `office-addin/src/word/components/`, their Word review CSS and directly related integration code. Existing shared components are inspected to identify reuse and compatibility requirements. Their unrelated pre-existing limitations do not become refactor tasks merely because Word uses them.

Excluded from this adjustment: general setup-page styling/provider changes, startup/sign-in UI, existing sidebar/account settings, and a general redesign of ActionConfirmationCard. The fixed geometry of the existing permission card predates Word; reuse it and remove the new Word overrides. Any shared-library extension must be necessary for the new Word UI, not a general cleanup opportunity.

The broader 25-TSX/70-module dependency trace remains evidence of inspection, **not the implementation scope**. Branch attribution used merge base `00f6e02c` with the locally available `origin/main`; no fetch, push or deployment was performed.

## Findings retained for the new Word UI

### 1. Replace duplicated controls and remove Word overrides

The original eight-file inventory found 18 native button source sites, three select sites, two details sites and one progress site. These are source sites, not rendered instance counts. Native HTML is not inherently wrong.

- Use existing Button for Word apply/copy/Revert/details controls and the inclusion toggle; use DocumentIcon instead of the emoji.
- Use TabRail for the two review view selectors, and Card/Row/DisclosureChevron for appropriate review frames and disclosures.
- Keep ActionConfirmationCard for permission. Remove the Word selectors overriding its font, minimum height, focus and spacing.
- The genuine new frontend candidates remain exact TextComparison with diff tokens, and a themed native Select. Keep document structure, source references, action state and Office operations in Word.

Browser proof: changing the shared small-font token to 22px makes the reference Button 22px, while Word consent/copy remain 14px because `.word-review button { font: inherit }` wins. This is introduced by the Word UI and belongs in the cleanup. It is separate from root text-size scaling, which the rem-based text still follows.

### 2. Preserve focus when a Word action completes

With keyboard focus on Apply and activation through Enter, both paragraph and structural operations leave focus on BODY after completion. Hidden detail buttons are correctly invisible.

Word removes the permission component and mounts a different receipt (`WordHostCardRenderer.tsx:512`, `WordDocumentPlanCard.tsx:395`). The shared card's focus handling cannot manage its own removal by the parent.

Track focus ownership and transfer it to the retained Word result/details control after a user-initiated operation. Preserve focus elsewhere during background Always allow execution. Cover deny, failure, Revert and reopen transitions. This fix belongs in Word composition; replacing Button alone does not solve it.

### 3. Include Word preparing, invalid and insertion states

- `WordDocumentPlanCard.tsx:284` renders an invalid-plan notice outside `.word-review`, where its required local CSS variables are missing. The measured left border is 0px. Use a self-contained shared surface/feedback treatment.
- Its preparing state at line 275 also renders outside the usual review frame. Retain appropriate status semantics; use existing SpinnerIcon if a spinner is useful.
- `WordHostCardRenderer.tsx:98` and `:341` render a bespoke raw fallback. A completed malformed paragraph proposal shows raw JSON without the explanatory feedback used for invalid structural plans. Distinguish streaming from a completed invalid proposal.
- SyntaxHighlightedCode and CollapsibleCodeBlock are already in the built public library. Reuse them where raw technical detail is needed; no new Word code viewer is required.
- Insertion is the third Word v1 action. Preserve its cursor insertion scope and its own consent/result states. Sharing presentation must not add batch-Revert promises to it.

### 4. Make Word copy failure feedback consistent

`WordEditReport.tsx:116` silently catches clipboard failure. Rejecting clipboard access in the browser produced no visible response after Copy report. The structural Copy draft path at `WordDocumentPlanCard.tsx:463` already displays failure feedback.

Correct the new Word report control using Button and explicit feedback. Keep document/report serialization local. Do not substitute CopyErrorButton, which has diagnostic-report labels and feature gating. A new generic CopyButton is not necessary for this task.

### 5. Complete the new Word action/UI translations

Excluding the nine setup entries, **144 active `officeAddin.word.*` strings per language** are untranslated in de/fr/es/pl. English is populated. These cover authoring (48), review (71), report (10), chip (7), card (6) and client actions (2). Strings under host-settings prefixes are outside this count.

This is a release-readiness finding about the newly added Word UI, separate from primitive reuse. Generic text moved into a frontend comparison/select component should use frontend catalogs; Word-specific copy remains in add-in catalogs. Validate translated labels at narrow widths rather than treating English screenshots as localization coverage.

## Boundaries to preserve during adjustment

- Keep source mapping, original/proposed outlines, document preview content and Word execution safeguards local.
- Preserve review filters/view state on collapse. Existing shared animated Collapse only clips content; a retained hidden body is needed unless its contract is extended deliberately.
- Permission approval and successful document execution are different states.
- Paragraph Revert has an inline warning that later body changes may be lost. Structural Revert refuses a changed post-apply document. Preserve each contract without introducing a modal solely for component reuse.
- Preserve exact text/Unicode/whitespace and the comparison work limits when extracting TextComparison.
- Native document markup, hyperlinks and suitable details/disclosure semantics may remain. Do not turn every HTML element into a new component.
- At the audited baseline, shared Alert hardcoded assertive semantics. The current API supports `role="status"`; the [implementation follow-up](implementation.md#review-follow-up--22-september-2026) replaces routine Word notices with that shared component.

## Verification and evidence

Actual component source was exercised in Chromium with simulated Word APIs, chat and consent state. No real Office document was accessed.

At 320px, checks covered all three structural views in light/dark; source mapping with a larger root font; preparing/invalid/expired states; insertion preview/consent; a 41-edit batch with 38 applied and 3 skipped; compact/expanded results and the inline Revert warning; copy rejection; typography overrides; and keyboard completion in both review modes. The checked cases had no horizontal page overflow or browser errors. The focus and feedback defects above were nevertheless reproduced.

- [Word component inventory](evidence/inventory.json)
- [Browser observations](evidence/second-pass-browser.json) — includes reference-component probes; these do not expand the implementation scope.
- [Keyboard focus evidence](evidence/second-pass-focus.json)
- [Catalog counts by prefix](evidence/second-pass-localization.json) — use non-setup prefixes for the 144-string scope.
- [Broader context trace](evidence/second-pass-inventory.json) — inspection evidence only.

The adjustment remains focused on the Word feature, with frontend reuse or small shared additions required by those new controls. No surrounding add-in cleanup is included.
