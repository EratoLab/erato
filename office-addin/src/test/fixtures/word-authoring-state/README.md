# Native structured Word state

Two consecutive body.getOoxml() reads from the same disposable synthetic document, with no intervening edit. Captured in Word for Mac 16.113.1 on 19 September 2026, commands 41 and 42 in docs/word-v1-authoring/mechanical-experiments/2026-09-19/results.json. Their recorded content profiles match; revision/session metadata differs. They contain synthetic tables, drawings, annotations and stories, not a user document.

These are raw native reads. Unit replay tests do not certify native Office.js Apply/Revert.

The remaining fixtures were captured through the integrated structured write path on 20 September 2026 in Word for Mac 16.113.1:

- `rewrite-source.xml`, `rewrite-plan.json`, `rewrite-applied.xml`, `rewrite-restored.xml`: initial diagnostic commands 5–7. The plan replaces 11 source blocks with 49 blocks. Word adds its empty terminal paragraph and reindexes abstract numbering definitions. The original comparator incorrectly rejected both the applied and restored states.
- `mixed-source.xml`, `mixed-plan.json`, `mixed-applied.xml`: diagnostic commands 20–21. A table and prose move within their section while native content is retained. Word regenerates row and drawing identifiers during the import.

The passing integrated run, independent Python content profiles, harness and complete command provenance are in [the structured validation record](../../../../docs/word-v1-authoring/mechanical-experiments/2026-09-20/structured/README.md). The fixture plans use synthetic wording with the same 49-block shape as the reported case; they are not the user's original document or model session.
