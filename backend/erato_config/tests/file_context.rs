use erato_config::config::{FileContextConfig, FileExtractionLimits};

#[test]
fn native_file_budget_bypass_defaults_on_and_can_be_disabled() {
    assert!(FileContextConfig::default().native_file_formats_bypass_limit);
    for (input, expected) in [
        ("", true),
        ("native_file_formats_bypass_limit = true", true),
        ("native_file_formats_bypass_limit = false", false),
    ] {
        let config: FileContextConfig = config::Config::builder()
            .add_source(config::File::from_str(input, config::FileFormat::Toml))
            .build()
            .unwrap()
            .try_deserialize()
            .unwrap();
        assert_eq!(config.native_file_formats_bypass_limit, expected);
    }
}

#[test]
fn independent_budgets_and_boundaries() {
    let mut c = FileContextConfig::default();
    assert_eq!(c.max_inline_tokens_per_file, 16_000);
    assert_eq!(c.max_preview_tokens_per_file, 1_000);
    assert_eq!(c.attachment_budget(1000), Some(250));
    c.max_total_attachment_tokens = 100;
    assert_eq!(c.attachment_budget(1000), Some(100));
    c.max_context_fraction = 0.0;
    assert_eq!(c.attachment_budget(1000), Some(100));
    c.max_total_attachment_tokens = 0;
    assert_eq!(c.attachment_budget(1000), None);
    assert_eq!(c.max_inline_tokens_per_file, 16_000);
    for fraction in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
        c.max_context_fraction = fraction;
        assert!(c.validate().is_err());
    }
    for fraction in [0.0, 1.0] {
        c.max_context_fraction = fraction;
        assert!(c.validate().is_ok());
    }
}

#[test]
fn numeric_limits_reject_negative_values() {
    for key in [
        "max_inline_tokens_per_file",
        "max_total_attachment_tokens",
        "max_preview_tokens_per_file",
    ] {
        assert!(serde_json::from_value::<FileContextConfig>(serde_json::json!({key: -1})).is_err());
    }
    for key in ["max_input_bytes", "max_extracted_chars", "timeout_ms"] {
        assert!(
            serde_json::from_value::<FileExtractionLimits>(serde_json::json!({key: -1})).is_err()
        );
    }
}

#[test]
fn explicit_compatibility_recipe_disables_each_limit() {
    #[derive(serde::Deserialize)]
    struct Config {
        file_context: FileContextConfig,
        file_processor: erato_config::config::FileProcessorConfig,
    }
    let c: Config = config::Config::builder()
        .add_source(config::File::from_str(
            r#"
[file_context]
max_inline_tokens_per_file = 0
max_total_attachment_tokens = 0
max_context_fraction = 0
max_preview_tokens_per_file = 0
[file_context.preview]
csv_max_sample_rows = 0
csv_max_columns = 0
max_field_chars = 0
text_max_chars = 0
[file_processor.limits]
max_input_bytes = 0
max_extracted_chars = 0
timeout_ms = 0
bounded_text_preview = false
"#,
            config::FileFormat::Toml,
        ))
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();
    assert_eq!(c.file_context.attachment_budget(1), None);
    assert_eq!(c.file_context.max_inline_tokens_per_file, 0);
    assert_eq!(c.file_context.max_preview_tokens_per_file, 0);
    assert_eq!(c.file_context.preview.csv_max_sample_rows, 0);
    assert_eq!(c.file_context.preview.csv_max_columns, 0);
    assert_eq!(c.file_context.preview.csv_max_field_chars, 0);
    assert_eq!(c.file_context.preview.text_max_chars, 0);
    assert_eq!(c.file_processor.limits.max_input_bytes, 0);
    assert_eq!(c.file_processor.limits.max_extracted_chars, 0);
    assert_eq!(c.file_processor.limits.timeout_ms, 0);
    assert!(!c.file_processor.limits.bounded_text_preview);
}

#[test]
fn full_text_retrieval_defaults_on_and_can_be_disabled() {
    assert!(FileContextConfig::default().retrieve_file_contents_enabled);
    let defaults: FileContextConfig = serde_json::from_value(serde_json::json!({})).unwrap();
    assert!(defaults.retrieve_file_contents_enabled);
    for enabled in [false, true] {
        let config: FileContextConfig = serde_json::from_value(serde_json::json!({
            "retrieve_file_contents_enabled": enabled
        }))
        .unwrap();
        assert_eq!(config.retrieve_file_contents_enabled, enabled);
    }
}
