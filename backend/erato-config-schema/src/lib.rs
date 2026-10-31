#![doc = include_str!("../README.md")]

pub mod config_facet_attrs;
mod config_metadata;
mod config_reference;

pub use config_reference::{
    ReferenceOptions, check_config_reference, config_reference_document, generate_reference,
    generate_reference_with_options, validate_config_reference,
};
