# Word authoring validation records

These records describe completed experiments, with their original host versions and limitations. The [implementation status](../implementation-status.md) describes the current product. Documentation cleanup on 22 September 2026 did not rerun or extend the recorded validation.

| Record                                                            | Scope                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Rich structured authoring](2026-09-21/structured-rich/README.md) | Current content families, full-document Apply and recovery, narrow-pane visuals |
| [Earlier structured reliability](2026-09-20/structured/README.md) | Earlier body-only comparison and recovery fixes                                 |
| [Native import mechanics](2026-09-19/README.md)                   | Initial API and independent recovery experiments                                |
| [Backend/model experiment](2026-09-19/backend-e2e/README.md)      | Historical model-authored OOXML interface                                       |
| [OOXML production experiment](2026-09-19/production-v1/README.md) | Parked implementation; not certification of the current structured interface    |

## Retained evidence

The repository keeps result summaries, independent comparisons, provenance, screenshots and reproduction instructions. Regression fixtures remain under `office-addin/src/test/fixtures/word-authoring-native`, `word-authoring-state` and `word-rich-native`; tests consume these directly.

The rich-content [native result summary](2026-09-21/structured-rich/native-results-summary.json) retains every case, production outcome, diagnostic, write count and timing from the original results. Large fingerprint strings are represented by SHA-256 hashes, and block/story/section inventories by counts. The source hash identifies the unabridged original. This is a derived record, not a new test run.

## Local archive

The five historical harness ZIPs and the unabridged rich-content results were consolidated into one local `word-v1-evidence.zip`. It also preserves the other files in this directory as they stood before cleanup. The [archive manifest](archive-manifest.json) records the archive checksum and the original paths, sizes and checksums of the files removed from the tracked tree.

In the development checkout, the archive is stored at the repository-relative path `tmp/word-v1-cleanup-2026-09-22/word-v1-evidence.zip`, which Git ignores. It is not included in a clone. Obtain this archive from its maintainer for historical harness reproduction; use the manifest to verify it before extracting the relevant nested harness ZIP. No upload is part of this cleanup.

Each experiment's reproduction section still describes its original fixture path guards and prerequisites. Those scripts and generated bundles are historical evidence, not a supported test runner for every later revision. The normal test suite uses the tracked regression fixtures and needs no archive.

The sanitized backend harness excludes private prompt/configuration files. Those remain in the private subscription repository. The older development history contained them before sanitization, so publication must use a clean branch built from the sanitized final tree; deleting files in a later commit is insufficient.
