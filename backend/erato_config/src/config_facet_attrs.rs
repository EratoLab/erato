facet::define_attr_grammar! {
    ns "erato";
    crate_path $crate::config_facet_attrs;

    /// Erato-specific facet extension attributes for config documentation metadata.
pub enum Attr {
        /// Marks a config field as deprecated and provides transition metadata.
        Deprecated(Deprecated),
        /// Marks a config field as hidden from generated docs.
        HideInDocs(HideInDocs),
        /// Marks a config field as requiring scoped replacement.
        NeedsScopedReplacement(NeedsScopedReplacement),
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
        /// Planned Erato version in which the key is expected to be removed.
        pub planned_removal_version: Option<&'static str>,
    }
}

pub use __attr;
