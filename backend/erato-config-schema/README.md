# erato-config-schema

Reusable configuration lifecycle metadata and reference generation for
[Facet](https://facet.rs) types. This crate has no dependency on Erato's application
configuration or runtime.

Add `erato-config-schema = "0.1.0"` and `facet = "0.44.3"` to your dependencies.
Use the same compatible Facet version in the consuming project.

```rust
use erato_config_schema::{
    check_config_reference, config_reference_document, generate_reference,
};
use facet::Facet;

#[derive(Facet)]
#[facet(erato_config_schema::stability(level = "stable"))]
#[facet(erato_config_schema::introduced_in(version = "1.0.0"))]
struct Config {
    port: u16,
    #[facet(erato_config_schema::stability(level = "alpha"))]
    #[facet(erato_config_schema::introduced_in(version = "unreleased"))]
    experimental: bool,
}

# fn main() -> Result<(), Box<dyn std::error::Error>> {
let reference = generate_reference(Config::SHAPE)?;
let document = config_reference_document(&reference)?;
let path = "configuration_reference.json";
// In your generator command, write the document or check it in CI:
# if false {
if std::env::args().any(|arg| arg == "--check") {
    check_config_reference(&std::fs::read_to_string(path)?, &document)?;
} else {
    std::fs::write(path, document)?;
}
# }
# Ok(())
# }
```

The reference is a flat JSON object keyed by dotted config paths. Each entry
requires `stability` (`stable`, `alpha`, `beta`, `unstable`, or `deprecated`) and
`introduced_in` (a semantic version or `unreleased`). Generation rejects missing
or invalid metadata, including on hidden keys and deprecated aliases. Documents
are sorted, pretty-printed, and end with a newline. `check_config_reference`
validates both documents and compares them byte for byte; always generate the
expected document from the current shape to detect missing or stale keys.
`validate_config_reference` validates an already parsed JSON reference without
checking it against a shape.

## Attributes

Use `#[facet(erato_config_schema::ATTRIBUTE(...))]` with:

- `stability(level = "stable")`: set the stability of a field and its descendants.
- `introduced_in(version = "1.0.0")`: set the first release containing a field.
- `deprecated(note = "Use new_key", replacement_key = "new_key",
  planned_removal_version = "2.0.0")`: deprecate a key. Only `note` is required;
  a replacement must exist in the generated reference.
- `deprecated_alias(name = "old_key")`: document a deprecated deserialization
  alias. Also declare the corresponding Serde alias in the consuming type.
- `hide_in_docs(hidden = true)`: hide a field and its descendants from docs.
- `needs_scoped_replacement(enabled = true)`: flag a key for scoped replacement.

Root type lifecycle attributes supply defaults. Field attributes override each
property independently and propagate to descendants. Both lifecycle attributes
accept an optional `under = "section.<key>"` scope for shared types. Scopes match
whole path segments; the most specific matching scope wins. Conflicting values
with equal specificity are errors. Deprecated aliases are traversed independently
so they can have different introduction dates from canonical keys.

## Serialization conventions

The walker handles structs, enums, options, collections, pointers, flattened
fields, and Facet renames. Collections use `[]`; maps use `<key>`. Declare Facet
serialization attributes alongside Serde attributes where needed. Arbitrary
custom Serde implementations cannot be inferred from Rust type shapes.

For application-specific map placeholders or custom serialized types, use
`generate_reference_with_options` and `ReferenceOptions`. Its
`map_key_placeholder` callback receives the containing public path; its
`custom_leaf_paths` callback can replace a type's traversal with relative paths
(including `""` for the current key). Returned leaves inherit the containing
field's lifecycle metadata. These callbacks also apply when traversing aliases.

For example, another application can name service map entries and document a
custom serialized value without adding any rules to this crate:

```rust
use std::collections::BTreeMap;
use erato_config_schema::{ReferenceOptions, generate_reference_with_options};
use facet::Facet;

#[derive(Facet)]
struct Endpoint {
    internal_url: String,
}

#[derive(Facet)]
#[facet(erato_config_schema::stability(level = "stable"))]
#[facet(erato_config_schema::introduced_in(version = "1.0.0"))]
struct Config {
    services: BTreeMap<String, Endpoint>,
}

let options = ReferenceOptions {
    map_key_placeholder: |path| match path.last().map(String::as_str) {
        Some("services") => "<service-name>".into(),
        _ => "<key>".into(),
    },
    // Suppose Endpoint's custom serializer accepts a URL string or { url = ... }.
    custom_leaf_paths: |shape| {
        (shape == Endpoint::SHAPE).then_some(&["", "url"])
    },
};
let reference = generate_reference_with_options(Config::SHAPE, &options).unwrap();
assert!(reference.get("services.<service-name>").is_some());
assert!(reference.get("services.<service-name>.url").is_some());
assert!(reference.get("services.<service-name>.internal_url").is_none());
```

Callbacks are plain functions or non-capturing closures. When a map-containing
field has a deprecated alias, use the same placeholders under the alias and
canonical paths so their descendants can be matched.

## Package verification

From the backend workspace:

```sh
cargo test -p erato-config-schema
cargo publish -p erato-config-schema --dry-run
```

The crate uses only versioned crates.io dependencies and includes its source,
tests, README, and license. Its version is independent of the Erato application.

## Version bumps

Change `package.version` in this crate's `Cargo.toml`, then run
`cargo check -p erato_config` from `backend/` and commit the updated `Cargo.lock`.
Local consumers inherit a path-only dependency from `workspace.dependencies`,
so they automatically use this crate's new version without another manifest edit.
Update the dependency version in the usage example above when preparing a release.

This does not affect publishing `erato-config-schema`, whose own dependencies all
have registry versions. If `erato_config` is later prepared for publication too,
its schema dependency will need a version requirement in `workspace.dependencies`
alongside the path; Cargo does not infer a publishable dependency requirement from
the referenced crate's package version.
