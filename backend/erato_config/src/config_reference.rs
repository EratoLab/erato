//! Erato's configuration reference and application-specific serialization rules.
use eyre::Result;
use facet::{Facet, Shape};
use serde_json::Value;

use crate::config::{AppConfig, PromptSourceSpecification};
use crate::spoken_readings::SpokenReading;
pub use erato_config_schema::validate_config_reference;
use erato_config_schema::{ReferenceOptions, generate_reference_with_options};

pub fn generate_config_reference() -> Result<Value> {
    generate_reference_with_options(
        AppConfig::SHAPE,
        &ReferenceOptions {
            map_key_placeholder,
            custom_leaf_paths,
        },
    )
}

fn custom_leaf_paths(shape: &Shape) -> Option<&'static [&'static str]> {
    // PromptSourceSpecification's custom Serde implementation accepts both a
    // scalar and tagged object forms that differ from its Rust representation.
    if shape == PromptSourceSpecification::SHAPE {
        return Some(&["", "source", "prompt_name", "label", "prompt", "fallback"]);
    }
    // A reading is written as its spoken text alone or as a table.
    (shape == SpokenReading::SHAPE).then_some(&["", "spoken", "sentence_final"])
}

/// Sections that hold language data by language tag.
const KEYED_BY_LANGUAGE: &[&[&str]] = &[
    &["approval_voice_commands", "words"],
    &["approval_speech", "words"],
    &["spoken_readings"],
    &["approval_voice_decisions", "phrases"],
    &["audio_conversational", "hesitations"],
];

fn is_keyed_by_language(path: &[String]) -> bool {
    KEYED_BY_LANGUAGE
        .iter()
        .any(|keyed| keyed.iter().copied().eq(path.iter().map(String::as_str)))
}

fn map_key_placeholder(path: &[String]) -> String {
    match path.last().map(String::as_str) {
        Some("facets") => "<facet-id>".to_string(),
        Some("file_storage_providers") => "<provider-id>".to_string(),
        Some("localized_prompts") => "<locale>".to_string(),
        Some(_) if is_keyed_by_language(path) => "<language>".to_string(),
        Some("<language>") if path.len() == 2 && path[0] == "spoken_readings" => {
            "<written-form>".to_string()
        }
        Some("mcp_servers") => "<server-id>".to_string(),
        Some("tools") if path.len() == 3 && path[0] == "mcp_servers" => "<tool-name>".to_string(),
        Some("field_names" | "choice_labels")
            if path.first().map(String::as_str) == Some("mcp_servers") =>
        {
            "<field-name>".to_string()
        }
        Some(key) if path.len() == 5 && key.starts_with('<') && path[3] == "choice_labels" => {
            "<choice-value>".to_string()
        }
        Some("surfaces") if path.first().map(String::as_str) == Some("mcp_servers_global") => {
            "<surface>".to_string()
        }
        Some("prompt_patterns") => "<pattern-id>".to_string(),
        Some("prompts") => "<prompt-id>".to_string(),
        Some("providers" | "provider") => "<provider-id>".to_string(),
        Some("policies") if path.len() == 2 && path[0] == "policy_guides" => {
            "<policy-id>".to_string()
        }
        Some("rules") => "<rule-name>".to_string(),
        Some("templates") if path.len() == 3 && path[0] == "scheduled" => {
            "<template-id>".to_string()
        }
        _ => "<key>".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{generate_config_reference, validate_config_reference};

    #[test]
    fn only_conversational_audio_and_read_aloud_expose_speech_provider() {
        let reference = generate_config_reference().unwrap();
        let keys = reference.as_object().unwrap();
        assert!(keys.contains_key("audio_conversational.speech_provider"));
        assert_eq!(
            keys.keys()
                .filter(|key| key.starts_with("audio_read_aloud."))
                .collect::<Vec<_>>(),
            [
                "audio_read_aloud.enabled",
                "audio_read_aloud.speech_provider"
            ]
        );
        assert!(!keys.contains_key("audio_dictation.speech_provider"));
        assert!(!keys.contains_key("audio_transcription.speech_provider"));
        for key in keys
            .keys()
            .filter_map(|key| key.strip_prefix("audio_transcription."))
        {
            assert!(keys.contains_key(&format!("audio_conversational.{key}")));
            assert!(keys.contains_key(&format!("audio_dictation.{key}")));
        }
        assert!(
            !keys
                .keys()
                .any(|key| key.starts_with("audio_conversational.transcription."))
        );
    }

    #[test]
    fn emits_expected_example_paths() {
        let generated = generate_config_reference().unwrap();
        let keys = generated
            .as_object()
            .expect("config reference is a flat object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();

        assert!(keys.contains(&"chat_providers.providers.<provider-id>.model_name".to_string()));
        assert!(keys.contains(&"assistants.enabled".to_string()));
        assert!(keys.contains(&"facets.facets.<facet-id>.display_name".to_string()));
        assert!(keys.contains(&"integrations.sharepoint.enabled".to_string()));
        assert!(keys.contains(&"integrations.entra_id.enabled".to_string()));
        assert!(keys.contains(&"model_permissions.rules.<rule-name>.rule_type".to_string()));
        assert!(keys.contains(&"server.encryption_key".to_string()));
        assert!(
            keys.contains(
                &"mcp_servers_global.default_tool_annotations.read_only_hint".to_string()
            )
        );
        assert!(keys.contains(
            &"mcp_servers.<server-id>.override_tool_annotations.destructive_hint".to_string()
        ));
        assert!(keys.contains(&"mcp_servers.<server-id>.tools.<tool-name>.default_tool_annotations.open_world_hint".to_string()));
        assert!(keys.contains(&"mcp_servers.<server-id>.surface_hints".to_string()));
        assert!(keys.contains(&"mcp_servers.<server-id>.mcp_apps.sandbox_origin".to_string()));
        assert!(keys.contains(&"mcp_servers_global.surfaces.<surface>.accept.[]".to_string()));
        assert!(keys.contains(&"client_tools.tools.<key>.name".to_string()));
        assert!(keys.contains(&"chat_providers.priority_order.[]".to_string()));
        assert!(keys.windows(2).all(|window| window[0] <= window[1]));
    }

    #[test]
    fn includes_both_scalar_and_object_prompt_forms() {
        let generated = generate_config_reference().unwrap();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert!(object.contains_key("prompt_optimizer.prompt"));
        assert!(object.contains_key("prompt_optimizer.prompt.source"));
        assert!(object.contains_key("prompt_optimizer.prompt.prompt_name"));
    }

    #[test]
    fn includes_deprecation_metadata_for_deprecated_keys() {
        let generated = generate_config_reference().unwrap();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(
            object["sentry_dsn"]["deprecated"]["replacement_key"],
            "integrations.sentry.sentry_dsn"
        );
        assert_eq!(
            object["sentry_dsn"]["deprecated"]["planned_removal_version"],
            "0.6.0"
        );
        assert_eq!(
            object["additional_frontend_environment"]["deprecated"]["replacement_key"],
            "frontend.additional_environment"
        );
    }

    #[test]
    fn deprecated_aliases_preserve_all_descendants_with_replacements() {
        let generated = generate_config_reference().unwrap();
        let object = generated.as_object().unwrap();

        for (canonical, alias) in [
            ("facets", "experimental_facets"),
            (
                "integrations.sharepoint",
                "integrations.experimental_sharepoint",
            ),
            (
                "integrations.entra_id",
                "integrations.experimental_entra_id",
            ),
        ] {
            let canonical_prefix = format!("{canonical}.");
            let mut count = 0;
            for (key, metadata) in object {
                if !key.starts_with(&canonical_prefix) {
                    continue;
                }
                count += 1;
                let alias_key = format!("{alias}{}", &key[canonical.len()..]);
                let alias_metadata = &object[&alias_key];
                assert_eq!(
                    alias_metadata["deprecated"]["replacement_key"],
                    key.as_str()
                );
                assert_eq!(alias_metadata["hide_in_docs"], true);
                assert!(metadata.get("deprecated").is_none());
                assert!(metadata.get("hide_in_docs").is_none());
            }
            assert!(count > 0, "no reference entries for {canonical}");
        }
        validate_config_reference(&generated).unwrap();
    }

    #[test]
    fn validates_replacement_keys() {
        let generated = generate_config_reference().unwrap();
        validate_config_reference(&generated).expect("replacement keys should exist");
    }

    #[test]
    fn unreviewed_metadata_inherits_independently() {
        let generated = generate_config_reference().unwrap();
        for (key, stability, relevance, default_security) in [
            (
                "server.encryption_key",
                "unreviewed",
                "unreviewed",
                "unreviewed",
            ),
            ("desktop_sidecar.strict_mode", "alpha", "high", "unreviewed"),
            (
                "frontend.keep_tools_dropdown_open",
                "beta",
                "none",
                "unknown_none",
            ),
        ] {
            assert_eq!(generated[key]["stability"], stability, "{key}");
            assert_eq!(generated[key]["security_relevance"], relevance, "{key}");
            assert_eq!(
                generated[key]["default_value_security"], default_security,
                "{key}"
            );
        }
    }

    #[test]
    fn custom_token_exchange_metadata_is_hidden_and_unstable() {
        let generated = generate_config_reference().unwrap();
        let prefix = "mcp_servers.<server-id>.authentication.forwarded.custom_token_exchange";
        for field in [
            ".enabled",
            ".subject_credential",
            ".token_endpoint",
            ".grant_type",
            ".client_id",
            ".client_secret",
            ".scope",
        ] {
            let value = &generated[format!("{prefix}{field}")];
            assert_eq!(value["hide_in_docs"], true, "{field}");
            assert_eq!(value["stability"], "unstable", "{field}");
            assert_eq!(value["introduced_in"], "unreleased", "{field}");
        }
    }

    #[test]
    fn includes_hide_in_docs_metadata() {
        let generated = generate_config_reference().unwrap();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(object["sentry_dsn"]["hide_in_docs"], true);
    }

    #[test]
    fn hide_in_docs_markers_propagate_to_descendants() {
        let generated = generate_config_reference().unwrap();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(object["chat_provider.provider_kind"]["hide_in_docs"], true);
        assert_eq!(
            object["chat_provider.additional_request_headers.[]"]["hide_in_docs"],
            true
        );
    }

    #[test]
    fn includes_needs_scoped_replacement_metadata() {
        let generated = generate_config_reference().unwrap();
        let object = generated
            .as_object()
            .expect("config reference is a flat object");

        assert_eq!(object["cleanup_enabled"]["needs_scoped_replacement"], true);
        assert_eq!(
            object["cleanup_archived_max_age_days"]["needs_scoped_replacement"],
            true
        );
    }
}
