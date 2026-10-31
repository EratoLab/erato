facet::define_attr_grammar! {
    ns "erato";
    crate_path $crate::config_facet_attrs;

    /// Facet extension attributes for config documentation metadata.
pub enum Attr {
        /// Sets the stability of a field and its descendants.
        Stability(Stability),
        /// Sets the first release containing a field and its descendants.
        IntroducedIn(IntroducedIn),
        /// Sets the security review priority of a field and its descendants.
        SecurityRelevance(SecurityRelevance),
        /// Classifies the security of a field's default value and its descendants.
        DefaultValueSecurity(DefaultValueSecurity),
        /// Marks a config field as deprecated and provides transition metadata.
        Deprecated(Deprecated),
        /// Documents a deprecated Serde alias without deprecating the canonical field.
        DeprecatedAlias(DeprecatedAlias),
        /// Marks a config field as hidden from generated docs.
        HideInDocs(HideInDocs),
        /// Marks a config field as requiring scoped replacement.
        NeedsScopedReplacement(NeedsScopedReplacement),
    }

    pub struct Stability {
        /// One of stable, alpha, beta, unstable, or deprecated.
        pub level: &'static str,
        /// Restrict this declaration to a public config path (for shared types).
        pub under: Option<&'static str>,
    }

    pub struct IntroducedIn {
        /// A project release version, or "unreleased" until release preparation.
        pub version: &'static str,
        /// Restrict this declaration to a public config path (for shared types).
        pub under: Option<&'static str>,
    }

    pub struct SecurityRelevance {
        /// One of high, medium, low, none, or unknown.
        pub level: &'static str,
        /// Restrict this declaration to a public config path (for shared types).
        pub under: Option<&'static str>,
    }

    pub struct DefaultValueSecurity {
        /// One of less_secure, more_secure, or unknown. unknown_none is derived.
        /// For less_secure, explain the security context in the field's comment.
        pub level: &'static str,
        /// Restrict this declaration to a public config path (for shared types).
        pub under: Option<&'static str>,
    }

    /// Additional metadata for fields that should not appear in docs.
    pub struct HideInDocs {
        /// Whether this config field should be hidden from docs generation.
        pub hidden: bool,
    }

    /// Additional metadata for fields that require scoped replacement.
    pub struct NeedsScopedReplacement {
        /// Whether this config field should be marked as requiring scoped replacement.
        pub enabled: bool,
    }

    /// Additional metadata for deprecated config fields.
    pub struct Deprecated {
        /// Human-readable deprecation note, typically matching Rust's `#[deprecated(note = ...)]`.
        pub note: &'static str,
        /// Replacement config key to use instead, when one exists.
        pub replacement_key: Option<&'static str>,
        /// Planned project version in which the key is expected to be removed.
        pub planned_removal_version: Option<&'static str>,
    }

    /// A deprecated field name that is still accepted during deserialization.
    pub struct DeprecatedAlias {
        /// Alias relative to the containing config table; must match the Serde alias.
        pub name: &'static str,
    }
}

pub use __attr;
