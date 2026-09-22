# Native structured authoring capture

`formatting-expected.xml` is the locally compiled structured formatting plan.
`formatting-observed.xml` is Word for Mac's full-package readback after importing
that plan into the disposable synthetic test document on 2026-09-20.

Recorded host: Microsoft Word 16.113.1, Office.js 16.113.917.1. The corresponding
mechanical harness recording is `erato-word-rich-20260920/results/5.json`.

The pair exercises direct paragraph/run formatting in a mixed document containing
native tables, images, fields, controls, bookmarks, comments, notes and sections.
Word omits an explicit reference to the declared default paragraph style, removes
empty content-control end properties, registers Arial in the font table, and adds
style revision-session IDs. Tests permit those exact normalizations while checking
that nondefault styles, actual font definitions, requested formatting and native
content remain unchanged.

`table-patch-before-canonicalization.xml` and `table-patch-observed.xml` record
the following native run (case 14): source rows reordered, one cell rewritten,
and the table centered and shaded. Word drops the now-ignored table indentation
and materializes center alignment on every row. The regression exercises the
corrected compiler against that raw readback; comparison rules still reject
actual changes to table alignment and shading.

Full-package comparisons use these additional raw native pairs from the same
disposable fixture and host on 2026-09-20:

| Files                                                  | Native recording | Scope                                                                                                                                                      |
| ------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stories-expected.xml`, `stories-observed.xml`         | Case 17          | New header/footer bindings, new and retained annotations, landscape/two-column geometry; Word remaps story IDs and duplicates header/footer parts.         |
| `all-content-expected.xml`, `all-content-observed.xml` | Case 44          | Corrected deterministic emitters create all structured content families; Word adds its DrawingML/VML fallback representation and omits redundant defaults. |
| `clear-expected.xml`, `clear-observed.xml`             | Case 36          | Explicit full clear, including removal of Word's native import placeholder; no visible body or story text remains.                                         |
| `native-edit-expected.xml`, `native-edit-observed.xml` | Case 59          | Typed updates to retained image crop, bookmark, content-control contents/presentation and field instruction/result.                                        |

Additional raw pairs recorded on 2026-09-21 exercise fresh initialization and
multiple edits in the same running Word instance:

| Files                                                                                | Native recording | Scope                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fresh-expected.xml`, `fresh-observed.xml`                                           | Case 98          | Successful complete rewrite from a source without story or numbering parts; new supplied PNG, Heading 9, multilevel list and all other supported content families. |
| `fresh-restore-expected.xml`, `fresh-restore-observed.xml`                           | Cases 97 → 99    | Successful restoration to the original content; Word keeps additional unused definitions and standard note separators.                                             |
| `native-edit-reused-expected.xml`, `native-edit-reused-observed.xml`                 | Case 102         | Existing-object edits following fresh creation and another import; Word materializes missing typography in an unused linked character-style definition.            |
| `native-edit-reused-restore-expected.xml`, `native-edit-reused-restore-observed.xml` | Cases 101 → 103  | Restore after that same linked-style catalog repair, with unchanged visible content and active bindings.                                                           |

The case 102/103 regression accepts only the measured additions to an unused,
mutually linked character style when they equal the unchanged paragraph partner's
effective typography. Direct or derived use, changed existing properties, changed
partner, different font values and unknown properties remain negative cases.

Some recordings initially reported a verification mismatch. The raw pairs are
kept intact: regression tests verify the corrected comparison against the actual
native output and add mutations that must remain unequal. A raw-pair regression
is distinct from a later complete Apply/Revert pass recorded by the native
harness. The full comparison must never replace the stricter fingerprint used
for stale Apply or Revert checks.
