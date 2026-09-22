# Word v1 component reuse audit

Audited on 2026-09-18 against `c6898b31` on `feature/ermain-819-823-word-v1`.

Open [the visual audit](index.html). It includes component ownership, measured theme behavior, current screenshots, migration order, and implementation caveats. The scoped adjustments are now implemented locally. See [implementation and validation](implementation.md) for the final ownership, shared API and test evidence. The audit findings below describe the **before** state at the audited commit.

**Scope corrected after the second pass:** [Word-feature findings and coverage](second-pass.md). The adjustment covers the eight new Word component files and their direct integrations. Tracing surrounding code was useful for checking reuse, but inherited setup/sign-in UI and pre-existing shared-component styling are outside the work. The retained findings concern Word completion focus, out-of-panel states, copy feedback, typography overrides and new Word translations.

## Historical finding — addressed by the implementation

At the audited commit, Word integrated with the shared chat shell, settings and permission controls, but the paragraph and full-document reviews duplicated buttons, tabs, surfaces and CSS. Those differences limited theme propagation and could not be corrected by loading a newer component kit alone. The [implemented adjustments](implementation.md) replaced those controls and removed the Word overrides; the evidence below records the original finding.

Across the eight Word component files inspected, an AST inventory found 18 native button source sites, three native select sites, two native details sites, and one progress site. These are source locations, not rendered instance counts or a percentage of the complete UI. Native HTML is not inherently a problem: document content, lists, details and progress have useful semantics. The concern is duplicated control behavior and visual styling where an appropriate shared component exists.

## Ownership decisions

| Area                                                                   | Recommendation                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply, copy, Revert, details and document inclusion controls           | Reuse frontend `Button`; remove copied button recipes and conflicting descendant CSS. Use `DocumentIcon` instead of the document emoji.                                                                                                                                         |
| Changes / Original / Proposed; Structure / Full draft / Source mapping | Reuse frontend `TabRail`, including controlled selection and panel relationships. Do not turn tabs into ordinary `Button` instances.                                                                                                                                            |
| Review frame, receipt surface, expandable review rows                  | Compose frontend `Card`, `Row` and `DisclosureChevron`; keep review state and outcome interpretation in Word. Preserve hidden-content accessibility and retained state.                                                                                                         |
| Permission decision                                                    | Keep `ActionConfirmationCard`. Remove Word selectors targeting its internal DOM. Preserve focus when Word removes the permission card on completion. Pre-existing shared-card geometry is outside this refactor; extend its API only if the Word use case actually requires it. |
| Text comparison                                                        | Extract the pure exact-text comparison and rendering into frontend, with added/removed theme tokens and complete-text fallback. Keep Office references and write behavior outside it.                                                                                           |
| Paragraph/status/source filters                                        | Add a small themed native `Select` to frontend, using the existing field/label contract. No general native select component was found in the current public library.                                                                                                            |
| Errors and passive notices                                             | Use shared `Alert` for actual alerts. Its current hardcoded `role="alert"` makes it unsuitable as a blanket replacement for passive notices or polite status updates.                                                                                                           |
| Completion receipt                                                     | Consolidate duplicated receipt presentation within Word first, using shared surfaces/buttons. A new generic action-result component is optional once a second host needs the same contract.                                                                                     |
| Coverage and status counts                                             | Keep Word meanings local. Tokenize the native progress accent; use `CountBadge` only for numeric counts, not status labels or paragraph identifiers.                                                                                                                            |
| Structure, source mapping, document preview and host operations        | Keep in Word. They encode Word document semantics and Office integration, not general frontend primitives.                                                                                                                                                                      |
| Shared client-action settings/policy orchestration                     | Keep in add-in core where used by multiple Office hosts; continue composing shared frontend UI.                                                                                                                                                                                 |

## Concrete theme evidence

The isolated browser fixture rendered actual Word review and frontend component source. It loaded existing library/kit styles plus the Open WebUI Like theme CSS, and applied the theme JSON values using the mapping read from `ThemeProvider`. Word APIs, chat context, policy and persistence were mocked. This checks component/CSS behavior, not the installed Office runtime or its active network assets.

At a 400px viewport, both a 320-block structural rewrite and 41 proposed edits across a 320-paragraph source were checked in light and dark modes. No page errors or horizontal page overflow were observed in these cases.

| Probe                                                | Shared reference                      | Word implementation                                                    |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Card radius, existing theme                          | 24px                                  | 10px                                                                   |
| Card radius after changing token to 2px              | 2px                                   | Still 10px                                                             |
| Button radius after changing pill token to 2px       | 2px                                   | Copy draft remains 5px                                                 |
| Button padding after changing control spacing        | 16px 24px                             | Copy draft remains 6px 10px                                            |
| Minimum button height after changing control minimum | 52px                                  | Even the shared consent button is overridden to 34px by Word CSS       |
| Focus token changed to purple                        | Token set to `#c026d3`                | Copy draft still has the local blue `#0f6cbd` outline                  |
| Light to dark theme                                  | Surfaces and foreground tokens change | Word surfaces/foreground also change; removed-text colors remain fixed |

The measured minimum height is the computed CSS minimum, not the actual rendered height. Full values are in [theme-probe.json](evidence/theme-probe.json); source counts are in [inventory.json](evidence/inventory.json). Screenshots in the HTML are observations of current components, not a proposed redesign.

## Source evidence

Paths are relative to the repository root; line numbers refer to the audited commit.

- `office-addin/src/core/SharedAddinShell.tsx:109`: shared ThemeProvider; `AddinChatCore.tsx:739`: shared MessageList; `AddinChatInputCore.tsx:65`: shared ChatInput.
- `office-addin/src/core/AddinSettingsDialogCore.tsx:119`: shared ModalBase/TabRail and settings panes; `core/clientActions/ClientActionsSettings.tsx:157`: RadioCard.
- `office-addin/src/word/components/WordHostCardRenderer.tsx:498` and `WordDocumentPlanCard.tsx:381`: raw apply controls; both also reuse ActionConfirmationCard.
- `WordReviewPanel.tsx:142`: custom comparison tabs; `WordDocumentPlanReview.tsx:102`: custom view switches; neither imports frontend visual components.
- `WordChatInput.tsx:238`: raw inclusion toggle and emoji; `WordEditReport.tsx:145`: raw copy button.
- `wordReview.css:7`: fixed frame radius; `:26`: inherited button/select font; `:37`: fixed focus blue; `:83`: fixed progress accent; `:104`: custom select geometry; `:195`: undefined `--theme-fg-link` token; `:238`: fixed diff colors; `:264`: shared-button minimum-height override; `:268`: consent `!important` and DOM selectors; `:284`: custom action geometry.
- `office-addin/src/core/clientActions/clientActionButtonStyles.ts:6`: copied recipe explicitly described as mirroring frontend Button.
- `frontend/src/library/index.ts:5` exports shared API; `frontend/src/shared/kit-surface.ts:27`, `:43`, `:45`, `:129`, `:167` explicitly expose Button, Row, TabRail, Card and DisclosureChevron. Their presence was also verified in the actual `dist-library/library.mjs` exports, not only declarations.
- `frontend/src/components/ui/Controls/TabRail.tsx:143`: explains why tabs intentionally do not use Button geometry.
- `frontend/src/components/ui/Container/Card.tsx:95`: collapse accessibility/state tradeoff.
- `frontend/src/components/ui/Feedback/Alert.tsx:93`: fixed alert role.
- `office-addin/src/word/utils/wordTextDiff.ts:7`: pure comparison algorithm with whitespace fidelity and bounded work.
- `office-addin/src/word/installWordComponentRegistrations.ts:21`: Word owns the HostCardCodeBlock adapter.
- `office-addin/vite.config.ts:841`: linked mode resolves the built local frontend library.
- Local subscription theme `themes/open-webui-like/theme.css:377`: pill geometry applies to `button[data-geometry]`, a hook emitted by shared Button.

## Migration safeguards

1. Reuse existing library controls and surfaces, removing the styles that would override them. Do not simply replace JSX tags while retaining `ACTION_BUTTON_CLASS` and Word descendant geometry rules.
2. Preserve each control's semantics: TabRail for tabs; Row as a button for a row disclosure with `aria-expanded`/`aria-controls`; native details may remain where appropriate. A data table or document paragraph does not need to become a component merely for uniformity.
3. Preserve the current retained review state on collapse. Word currently uses `hidden`; shared Card's default animated Collapse leaves descendants focusable. Unmounting hides them but loses local view/filter state. Use a shared surface with a retained hidden body, or explicitly support both requirements in the shared disclosure contract.
4. Permission approval is not execution success. Keep permission state separate from applied/skipped/failed/reverted outcomes. ActionConfirmationCard is execution-agnostic.
5. Extract TextComparison with controlled view, unavailable-original state, exact Unicode/whitespace, complete Original/Proposed fallback, and localized accessible labels. Preserve the existing 80,000-character / 250,000-cell comparison limits during extraction. Keep sanitization/document write code in Word.
6. Add diff colors through the complete frontend theme contract: schema/types, defaults, light/dark values, CSS-variable mapping, renderer and public exports. Added/removed are not synonymous with success/error.
7. Add Select as a native control accepting ordinary value, disabled, label, error and description relationships. Do not substitute a model selector, action menu or file-upload progress component solely for its appearance.
8. Consolidate receipt layout within Word. Defer a generic review workflow until another host demonstrates the same requirements; no broad registry expansion is needed for this cleanup.

## Adjacent copy issue

`WordSettingsDialog.tsx:71` supplies one Always allow helper that says changed paragraphs are skipped and a single Revert undoes the batch. This is paragraph-batch wording. The structural action instead stops the complete plan before writing if the source changed, and its guarded Revert refuses a changed document. Supply action-specific copy from Word through the add-in settings API. Do not encode these policies in a generic frontend component.

## Acceptance for a future implementation

- Test actual frontend controls under default and custom themes, in light/dark and larger text sizes, at 320px and 400px pane widths. Include both a long paragraph batch and a structural rewrite.
- Verify a radius/density/focus token change reaches all applicable controls without Word overrides. New diff tokens must affect both light and dark comparison views.
- Cover pending, applying, applied/partially applied, blocked, denied, collapsed, expanded and reverted outcomes. Exercise per-use consent and Always allow.
- Keyboard-test both tab sets and row disclosures. Collapsed content must leave keyboard and accessibility navigation while retaining filters/view state. Keep action buttons outside row buttons.
- Verify filters do not accidentally narrow the apply scope, whole-plan stale-source blocking remains intact, and guarded Revert behavior is unchanged.
- Existing Word card unit tests mock ActionConfirmationCard, so passing them alone cannot establish real theme propagation. Add a focused browser integration check with the real shared controls; retain the domain tests.
- Confirm the public built exports and linked-mode output after a migration. This audit did not rebuild or change the application.

No application source or theme files were changed by this audit. Only this documentation and its evidence were added.
