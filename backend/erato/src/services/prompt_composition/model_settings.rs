use crate::config::{ExperimentalFacetsConfig, ModelSettings};
use std::collections::HashSet;

/// Build effective model settings based on selected facets.
///
/// - If no facets are configured, the base settings are returned unchanged.
/// - Facet model settings are applied in priority order, then in selected order
///   for facets not in the priority list.
pub fn build_model_settings_for_facets(
    base: &ModelSettings,
    experimental_facets: &ExperimentalFacetsConfig,
    selected_facet_ids: &[String],
) -> ModelSettings {
    if experimental_facets.facets.is_empty() {
        return base.clone();
    }

    let mut merged = base.clone();
    let selected_set: HashSet<&String> = selected_facet_ids.iter().collect();
    let priority_set: HashSet<&String> = experimental_facets.priority_order.iter().collect();

    for facet_id in &experimental_facets.priority_order {
        if !selected_set.contains(facet_id) {
            continue;
        }
        if let Some(facet) = experimental_facets.facets.get(facet_id) {
            merged = merge_model_settings(&merged, &facet.model_settings);
        }
    }

    for facet_id in selected_facet_ids {
        if priority_set.contains(facet_id) {
            continue;
        }
        if let Some(facet) = experimental_facets.facets.get(facet_id) {
            merged = merge_model_settings(&merged, &facet.model_settings);
        }
    }

    merged
}

fn merge_model_settings(base: &ModelSettings, overrides: &ModelSettings) -> ModelSettings {
    let mut merged = base.clone();

    if overrides.generate_images {
        merged.generate_images = true;
    }
    if let Some(temperature) = overrides.temperature {
        merged.temperature = Some(temperature);
    }
    if let Some(top_p) = overrides.top_p {
        merged.top_p = Some(top_p);
    }
    if let Some(reasoning_effort) = overrides.reasoning_effort {
        merged.reasoning_effort = Some(reasoning_effort);
    }
    if let Some(verbosity) = overrides.verbosity {
        merged.verbosity = Some(verbosity);
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::build_model_settings_for_facets;
    use crate::config::{
        ExperimentalFacetsConfig, FacetConfig, ModelReasoningEffort, ModelSettings, ModelVerbosity,
    };
    use std::collections::HashMap;

    fn facet(display_name: &str, model_settings: ModelSettings) -> FacetConfig {
        FacetConfig {
            display_name: display_name.to_string(),
            icon: None,
            additional_system_prompt: None,
            tool_call_allowlist: vec![],
            model_settings,
            disable_facet_prompt_template: false,
        }
    }

    #[test]
    fn returns_base_when_no_facets_configured() {
        let base = ModelSettings {
            generate_images: true,
            temperature: Some(0.2),
            top_p: None,
            reasoning_effort: None,
            verbosity: None,
        };
        let config = ExperimentalFacetsConfig::default();

        let merged = build_model_settings_for_facets(&base, &config, &["facet".to_string()]);
        assert_eq!(merged, base);
    }

    #[test]
    fn applies_facets_in_priority_order() {
        let base = ModelSettings::default();
        let config = ExperimentalFacetsConfig {
            priority_order: vec!["first".to_string(), "second".to_string()],
            facets: HashMap::from([
                (
                    "first".to_string(),
                    facet(
                        "First",
                        ModelSettings {
                            temperature: Some(0.2),
                            ..Default::default()
                        },
                    ),
                ),
                (
                    "second".to_string(),
                    facet(
                        "Second",
                        ModelSettings {
                            temperature: Some(0.8),
                            reasoning_effort: Some(ModelReasoningEffort::High),
                            ..Default::default()
                        },
                    ),
                ),
            ]),
            ..Default::default()
        };

        let merged = build_model_settings_for_facets(
            &base,
            &config,
            &["second".to_string(), "first".to_string()],
        );

        assert_eq!(merged.temperature, Some(0.8));
        assert_eq!(merged.reasoning_effort, Some(ModelReasoningEffort::High));
    }

    #[test]
    fn applies_selected_facets_not_in_priority_order() {
        let base = ModelSettings::default();
        let config = ExperimentalFacetsConfig {
            priority_order: vec!["priority".to_string()],
            facets: HashMap::from([
                (
                    "priority".to_string(),
                    facet(
                        "Priority",
                        ModelSettings {
                            top_p: Some(0.4),
                            ..Default::default()
                        },
                    ),
                ),
                (
                    "extra".to_string(),
                    facet(
                        "Extra",
                        ModelSettings {
                            verbosity: Some(ModelVerbosity::High),
                            ..Default::default()
                        },
                    ),
                ),
            ]),
            ..Default::default()
        };

        let merged = build_model_settings_for_facets(
            &base,
            &config,
            &["extra".to_string(), "priority".to_string()],
        );

        assert_eq!(merged.top_p, Some(0.4));
        assert_eq!(merged.verbosity, Some(ModelVerbosity::High));
    }

    #[test]
    fn does_not_disable_generate_images() {
        let base = ModelSettings {
            generate_images: true,
            ..Default::default()
        };
        let config = ExperimentalFacetsConfig {
            facets: HashMap::from([(
                "facet".to_string(),
                facet("Facet", ModelSettings::default()),
            )]),
            ..Default::default()
        };

        let merged = build_model_settings_for_facets(&base, &config, &["facet".to_string()]);
        assert!(merged.generate_images);
    }
}
