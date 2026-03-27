facet::define_attr_grammar! {
    ns "erato";
    crate_path $crate::config_facet_attrs;

    /// Erato-specific facet extension attributes for config documentation metadata.
    pub enum Attr {
        /// Marks a config field as deprecated and provides transition metadata.
        Deprecated(Deprecated),
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
