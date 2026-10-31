# Configuration reference metadata

`cargo run -p erato_config --bin gen-config-reference` (from `backend/`) generates
`generated/config_reference.json`. Add `-- --check` to verify the checked-in file.
CI uses this check to require valid `introduced_in` and `stability` metadata on
every key (including hidden keys and aliases), as well as byte-for-byte freshness.
Both generated and checked-in metadata are validated; regenerating the file cannot
bypass missing metadata.
The generator lives in this crate so reference generation does not compile the
server or require its runtime dependencies.

Every emitted key, including hidden keys, has `stability` and `introduced_in`.
Stability is one of `stable`, `alpha`, `beta`, `unstable`, or `deprecated`.
Introduction is a semantic Erato release version or `unreleased`.

## Declaring metadata

Config code and its facet attributes are the only maintained source of metadata.
The JSON reference is generated output. Put declarations on the corresponding
config field or parent section:

```rust
#[facet(erato_config::stability(level = "alpha"))]
#[facet(erato_config::introduced_in(version = "unreleased"))]
pub new_feature: NewFeatureConfig,
```

`AppConfig` has a root `stability(level = "unstable")` attribute. Reviewers can
classify individual fields or sections by adding stability attributes in
`src/config.rs`. Both properties inherit independently; an explicit child
attribute overrides its inherited value. Existing deprecation metadata always
yields `deprecated` for the affected key.

For shared Rust types whose public config paths have different histories, restrict
an attribute with `under`. For example, the canonical and deprecated names of a
section can have distinct introduction versions:

```rust
#[facet(erato_config::deprecated_alias(name = "experimental_facets"))]
#[facet(erato_config::introduced_in(version = "0.7.0"))]
#[facet(erato_config::introduced_in(version = "0.6.0", under = "experimental_facets"))]
pub facets: FacetsConfig,
```

Within a field, the most specific matching `under` wins over an unscoped attribute,
regardless of attribute order. Scopes match complete public path segments, including
literal collection placeholders (`[]`, `<provider-id>`, etc.). The same optional
scope is available for stability. Conflicting declarations of equal specificity
are errors. Aliases are traversed independently so child attributes resolve using
the alias's own path and inherited date.

A newly added child of an old section needs an explicit `unreleased` introduction
rather than inheriting the section's historical date. Check every public path when
changing a shared type, including alias descendants. Regenerate the reference and
inspect the diff after editing attributes.

## History and releases

The first release containing the reference was **0.6.0**. Keys already present in
that release use 0.6.0 even if their actual implementation predates it.

After fetching the complete history and release tags, run
`python3 scripts/config_metadata.py` from the repository root to audit exact key
names against release snapshots. The script considers semantic-version tags in
HEAD's ancestry, orders them by version (including prereleases), and reports the
first release containing each key. It preserves first occurrences across removal
and reintroduction; unreleased additions and pre-release reverts are not counted as
released. Check that release tags are complete before interpreting an audit.
The audit is read-only: correct any discrepancy in the config field attributes
and regenerate the reference.

Normal generation, builds, and tests use source attributes and need no Git
history or network access. `scripts/prepare-release.py VERSION` replaces only
`unreleased` introductions in facet attributes (including scoped ones), regenerates
and validates the reference, and includes the changes in its release commit.
`tag-release.py` checks reference freshness and rejects unresolved introductions
before creating or pushing a tag. A history audit between preparation and tagging
will still report those new keys as unreleased because their release tag does not
exist yet.

The site's configuration markers render labels from the generated JSON. Hidden
keys do not get labels; section-only markers do not summarize mixed child values.

## Verification

- `cd backend && just test -p erato_config`
- `cd backend && just generate_config_reference_check`
- `cd backend && just check_config_reference_docs`
- `python3 -m unittest discover -s scripts/tests -v`
- `cd site && pnpm test && pnpm run build`
