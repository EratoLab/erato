# Word v1 component adjustments

Implemented locally on 2026-09-18, on top of the audited `c6898b31` state. This covers UI introduced by the Word feature and its direct integrations.

## Ownership after the change

| Owner                        | Components and responsibilities                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing frontend primitives | `Button`, `Card`, `Row`, `DisclosureChevron`, `TabRail`, `DocumentIcon`, `Alert`, `SpinnerIcon`, `SyntaxHighlightedCode`. Word no longer overrides their fonts, corners, minimum heights or focus presentation.                      |
| New frontend primitives      | Native `Select` with label/description/error relationships; exact `TextComparison` with keyboard tabs, whitespace display and bounded diff work. Both are public library/shared exports in additive shared surface version **1.14**. |
| Word add-in                  | Document inclusion, coverage, original capture, paragraph batches, structure/full draft/source mapping, locating passages in Word, permission orchestration, outcomes, compact receipts, recovery and retained review state.         |
| Shared Office core           | Existing action policy and settings. The optional action-specific helper callback allows accurate recovery descriptions without changing other hosts.                                                                                |

`TextComparison` accepts `original: string | null`, `proposed: string`, optional controlled `view` (`changes`, `original`, `proposed`) and `onViewChange`. A missing original disables comparison/original tabs. Large comparisons show both complete texts rather than approximate or truncate the change. The extracted algorithm retains the existing 80,000-character / 250,000-cell limits and exact reconstruction tests, including CRLF, tabs and Unicode.

`Select` forwards native select attributes and its ref; optional `label`, `description` and `error` provide accessible field relationships. Platform selection and keyboard behavior remain native.

## Theme contract

New semantic tokens: `theme.colors.diff.added.{foreground,background}` and `theme.colors.diff.removed.{foreground,background}`. They map to `--theme-diff-added-fg`, `--theme-diff-added-bg`, `--theme-diff-removed-fg`, `--theme-diff-removed-bg`. Light/dark defaults are merged for existing customer themes; partial overrides are supported. Differences retain underline/strikethrough and text labels, so colour is not the only distinction.

Word CSS now handles document layout, bounded scrolling and content presentation. Native coverage progress uses theme colours across browser implementations. Review cards, fields, controls, typography and focus use existing library tokens. Permission-card geometry itself is inherited and unchanged.

## Behavior and localization

- Successful and declined actions use the same Word receipt composition. Full details stay mounted behind `hidden`, preserving filters and selected views while removing hidden controls from keyboard navigation.
- When an action removes its focused controls, focus passes through the review surface during progress and into the compact result. Completion does not steal focus from chat or after a pointer action elsewhere.
- Clipboard failure is visible and retryable. Generating proposals have a progress state; malformed proposals explain the problem and offer no write action.
- Action settings distinguish paragraph-batch recovery, insertion using Word Undo, and guarded full-document recovery.
- 146 active Word-feature messages and nine shared comparison messages are translated into German, Spanish, French and Polish. Interpolation placeholders were checked. Unrelated setup/sign-in translations remain outside scope.

## Validation

Browser checks use actual Word and frontend components with a synthetic 320-paragraph document and mocked Office APIs. The paragraph case has 41 changes including three stale passages; the structural case covers all 320 source blocks. Checks include light/dark themes, 320px/400px widths, German labels, changed theme tokens, keyboard completion, collapsed hidden controls, retained filters, rejected clipboard access, insertion, malformed/generating proposals and the large-text comparison fallback.

Evidence: [behavior](evidence/implementation-browser.json), [customer theme and German layout](evidence/implementation-theme.json). This is not a live Microsoft Word execution test. The document execution algorithms and their guards were not changed.

The frontend i18n check script refuses uncommitted catalogs. Equivalent validation used a working-tree snapshot and verified that a second extraction made no changes, then compiled both applications' catalogs. Local frontend development theme/layout settings affect two unrelated tests; the suite is checked with the normal Vitest configuration plus an empty `envDir`, leaving local settings untouched.

| Validation                                                       | Result                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Frontend full Vitest suite, isolated from local `.env` overrides | 230 files passed; 2,419 tests passed; 11 skipped                 |
| Office add-in full Vitest suite                                  | 149 files passed; 1,633 tests passed                             |
| Installed frontend library contract                              | 8 checks passed against the final packed library                 |
| Frontend and add-in TypeScript, strict ESLint and formatting     | Passed                                                           |
| Catalog extraction stability and compilation                     | Passed for both applications                                     |
| Frontend app, frontend library and add-in production builds      | Passed; existing chunk-size warnings remain                      |
| Actual-component browser scenarios                               | Passed; no page errors or horizontal overflow in checked layouts |

The frontend library has been rebuilt and repacked in the main checkout, and the add-in installation refreshed. The lockfile change is solely the checksum of that local tarball; registry versions are unchanged. `dev-linked` uses the rebuilt library directly. Restart an already-running dev session and reload the Word pane before manual retesting. Live Microsoft Word testing remains a manual step.
