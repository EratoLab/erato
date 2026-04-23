use std::collections::HashMap;

use chrono::Utc;
use handlebars::Handlebars;
use serde_json::{Map, Value};

use crate::services::template_rendering::contexts::system_prompt::SystemPromptContext;

/// Context for rendering system prompts.
type PlaceholderFn = for<'a> fn(&SystemPromptContext<'a>) -> String;

#[derive(Clone, Debug)]
pub struct SystemPromptRenderer {
    placeholder_registry: HashMap<String, PlaceholderFn>,
}

impl Default for SystemPromptRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemPromptRenderer {
    pub fn new() -> Self {
        let mut renderer = Self {
            placeholder_registry: HashMap::new(),
        };

        renderer.register_placeholder("erato_inject_now_date", render_now_date);
        renderer.register_placeholder("erato_inject_now_datetime", render_now_datetime);
        renderer.register_placeholder(
            "erato_inject_preferred_language_code",
            render_preferred_language_code,
        );
        renderer.register_placeholder(
            "erato_inject_preferred_language_en",
            render_preferred_language_name,
        );
        renderer.register_placeholder(
            "erato_inject_user_preference_nickname",
            render_user_preference_nickname,
        );
        renderer.register_placeholder(
            "erato_inject_user_preference_job_title",
            render_user_preference_job_title,
        );
        renderer.register_placeholder(
            "erato_inject_user_preference_assistant_custom_instructions",
            render_user_preference_assistant_custom_instructions,
        );
        renderer.register_placeholder(
            "erato_inject_user_preference_assistant_additional_information",
            render_user_preference_assistant_additional_information,
        );

        renderer
    }

    fn register_placeholder(&mut self, name: &str, func: PlaceholderFn) {
        self.placeholder_registry.insert(name.to_string(), func);
    }

    pub fn render<'a>(&self, template: &str, ctx: &SystemPromptContext<'a>) -> String {
        if self.placeholder_registry.is_empty() {
            return template.to_string();
        }

        let mut context_values = Map::new();

        for (placeholder_name, placeholder_value) in &self.placeholder_registry {
            let value = placeholder_value(ctx);
            context_values.insert(placeholder_name.clone(), Value::String(value));
        }

        let mut handlebars = Handlebars::new();
        handlebars.set_strict_mode(false);
        handlebars.register_escape_fn(|value| value.to_string());

        match handlebars.render_template(template, &Value::Object(context_values)) {
            Ok(rendered) => rendered,
            Err(error) => {
                tracing::debug!(error = %error, template = %template, "Failed to render template with Handlebars, returning raw template");
                template.to_string()
            }
        }
    }
}

pub(crate) fn render_now_date(_ctx: &SystemPromptContext) -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

pub(crate) fn render_now_datetime(_ctx: &SystemPromptContext) -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(crate) fn language_code_to_english_name(ctx: &SystemPromptContext) -> String {
    let code = ctx.preferred_language.unwrap_or("en");
    match code {
        "en" => "English".to_string(),
        "de" => "German".to_string(),
        "es" => "Spanish".to_string(),
        "fr" => "French".to_string(),
        "it" => "Italian".to_string(),
        "pt" => "Portuguese".to_string(),
        "nl" => "Dutch".to_string(),
        "pl" => "Polish".to_string(),
        "ru" => "Russian".to_string(),
        "zh" => "Chinese".to_string(),
        "ja" => "Japanese".to_string(),
        "ko" => "Korean".to_string(),
        "sv" => "Swedish".to_string(),
        "no" => "Norwegian".to_string(),
        "da" => "Danish".to_string(),
        "fi" => "Finnish".to_string(),
        "tr" => "Turkish".to_string(),
        "vi" => "Vietnamese".to_string(),
        "th" => "Thai".to_string(),
        "ar" => "Arabic".to_string(),
        "hi" => "Hindi".to_string(),
        "bn" => "Bengali".to_string(),
        "fa" => "Persian".to_string(),
        "id" => "Indonesian".to_string(),
        "ms" => "Malay".to_string(),
        "uk" => "Ukrainian".to_string(),
        "cs" => "Czech".to_string(),
        "el" => "Greek".to_string(),
        "he" => "Hebrew".to_string(),
        "ro" => "Romanian".to_string(),
        "hu" => "Hungarian".to_string(),
        _ => "English".to_string(),
    }
}

pub(crate) fn render_preferred_language_code(ctx: &SystemPromptContext) -> String {
    ctx.preferred_language.unwrap_or("en").to_string()
}

pub(crate) fn render_preferred_language_name(ctx: &SystemPromptContext) -> String {
    language_code_to_english_name(ctx)
}

pub(crate) fn render_user_preference_nickname(ctx: &SystemPromptContext) -> String {
    ctx.user_preference_nickname.unwrap_or("").to_string()
}

pub(crate) fn render_user_preference_job_title(ctx: &SystemPromptContext) -> String {
    ctx.user_preference_job_title.unwrap_or("").to_string()
}

pub(crate) fn render_user_preference_assistant_custom_instructions(
    ctx: &SystemPromptContext,
) -> String {
    ctx.user_preference_assistant_custom_instructions
        .unwrap_or("")
        .to_string()
}

pub(crate) fn render_user_preference_assistant_additional_information(
    ctx: &SystemPromptContext,
) -> String {
    ctx.user_preference_assistant_additional_information
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_now_date_format() {
        let date = render_now_date(&SystemPromptContext::default());
        // Should be YYYY-MM-DD (10 characters)
        assert_eq!(date.len(), 10);
        // Should be parseable as a date
        assert!(chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_ok());
    }

    #[test]
    fn test_render_now_datetime_format() {
        let datetime = render_now_datetime(&SystemPromptContext::default());
        // Should end with Z (UTC indicator)
        assert!(datetime.ends_with('Z'));
        // Should be parseable as RFC3339
        assert!(chrono::DateTime::parse_from_rfc3339(&datetime).is_ok());
    }

    #[test]
    fn test_render_single_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Today is {{erato_inject_now_date}}.";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Placeholder should be replaced
        assert!(!result.contains("{{erato_inject_now_date}}"));
        assert!(result.starts_with("Today is "));
    }

    #[test]
    fn test_render_single_placeholder_with_spacing() {
        let renderer = SystemPromptRenderer::new();
        let template = "Today is {{ erato_inject_now_date }}.";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Placeholder should be replaced
        assert!(!result.contains("{{ erato_inject_now_date }}"));
        assert!(result.starts_with("Today is "));
    }

    #[test]
    fn test_render_multiple_placeholders() {
        let renderer = SystemPromptRenderer::new();
        let template = "Date: {{erato_inject_now_date}}, Time: {{erato_inject_now_datetime}}";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Both placeholders should be replaced
        assert!(!result.contains("{{erato_inject_now_date}}"));
        assert!(!result.contains("{{erato_inject_now_datetime}}"));
        assert!(result.starts_with("Date: "));
        assert!(result.contains(", Time: "));
    }

    #[test]
    fn test_render_no_placeholders() {
        let renderer = SystemPromptRenderer::new();
        let template = "Normal prompt without placeholders";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Should return unchanged
        assert_eq!(result, template);
    }

    #[test]
    fn test_render_unknown_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "This has {{unknown_placeholder}} in it.";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Unknown placeholder should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_custom_placeholder_registration() {
        let mut renderer = SystemPromptRenderer::new();
        fn test_custom(_ctx: &SystemPromptContext) -> String {
            "CUSTOM_VALUE".to_string()
        }
        renderer.register_placeholder("test_custom", test_custom);
        let template = "Value: {{test_custom}}";
        let result = renderer.render(template, &SystemPromptContext::default());
        assert_eq!(result, "Value: CUSTOM_VALUE");
    }

    #[test]
    fn test_same_placeholder_twice() {
        let renderer = SystemPromptRenderer::new();
        let template = "Start: {{erato_inject_now_date}}, End: {{erato_inject_now_date}}";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Both occurrences should be replaced
        assert!(!result.contains("{{erato_inject_now_date}}"));
        // Both should have the same value (captured at same instant)
        let parts: Vec<&str> = result.split(", ").collect();
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn test_empty_template() {
        let renderer = SystemPromptRenderer::new();
        let template = "";
        let result = renderer.render(template, &SystemPromptContext::default());
        assert_eq!(result, "");
    }

    #[test]
    fn test_malformed_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Malformed {{erato_inject_now_date without closing brace";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Malformed placeholder should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_case_sensitive_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Wrong case: {{Erato_Inject_Now_Date}}";
        let result = renderer.render(template, &SystemPromptContext::default());
        // Case variation should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_preferred_language_code() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language code: {{erato_inject_preferred_language_code}}";
        let result = renderer.render(
            template,
            &SystemPromptContext {
                preferred_language: Some("de"),
                ..Default::default()
            },
        );
        assert_eq!(result, "Language code: de");
    }

    #[test]
    fn test_preferred_language_name() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language: {{erato_inject_preferred_language_en}}";
        let result = renderer.render(
            template,
            &SystemPromptContext {
                preferred_language: Some("es"),
                ..Default::default()
            },
        );
        assert_eq!(result, "Language: Spanish");
    }

    #[test]
    fn test_preferred_language_code_default() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language code: {{erato_inject_preferred_language_code}}";
        let result = renderer.render(template, &SystemPromptContext::default());
        assert_eq!(result, "Language code: en");
    }

    #[test]
    fn test_preferred_language_name_default() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language: {{erato_inject_preferred_language_en}}";
        let result = renderer.render(template, &SystemPromptContext::default());
        assert_eq!(result, "Language: English");
    }

    #[test]
    fn test_preferred_language_code_multiple_occurrences() {
        let renderer = SystemPromptRenderer::new();
        let template = "Start: {{erato_inject_preferred_language_code}}, Middle: {{erato_inject_preferred_language_code}}, End: {{erato_inject_preferred_language_code}}";
        let result = renderer.render(
            template,
            &SystemPromptContext {
                preferred_language: Some("fr"),
                ..Default::default()
            },
        );
        assert!(!result.contains("{{erato_inject_preferred_language_code}}"));
        let parts: Vec<&str> = result.split(", ").collect();
        assert_eq!(parts.len(), 3);
    }

    #[test]
    fn test_preferred_language_code_unknown() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language: {{erato_inject_preferred_language_en}}";
        let result = renderer.render(
            template,
            &SystemPromptContext {
                preferred_language: Some("xx"),
                ..Default::default()
            },
        );
        assert_eq!(result, "Language: English");
    }

    #[test]
    fn test_user_preference_placeholders() {
        let renderer = SystemPromptRenderer::new();
        let template = "Name: {{erato_inject_user_preference_nickname}}, Title: {{erato_inject_user_preference_job_title}}";
        let result = renderer.render(
            template,
            &SystemPromptContext {
                user_preference_nickname: Some("Max"),
                user_preference_job_title: Some("Engineer"),
                ..Default::default()
            },
        );
        assert_eq!(result, "Name: Max, Title: Engineer");
    }

    #[test]
    fn test_user_preference_placeholders_default_to_empty() {
        let renderer = SystemPromptRenderer::new();
        let template = "Info: {{erato_inject_user_preference_assistant_additional_information}}";
        let result = renderer.render(template, &SystemPromptContext::default());
        assert_eq!(result, "Info: ");
    }

    #[test]
    fn test_language_code_mapping() {
        let renderer = SystemPromptRenderer::new();

        let test_cases = vec![
            ("en", "English"),
            ("de", "German"),
            ("es", "Spanish"),
            ("fr", "French"),
            ("it", "Italian"),
            ("pt", "Portuguese"),
            ("ru", "Russian"),
            ("zh", "Chinese"),
            ("ja", "Japanese"),
            ("ko", "Korean"),
            ("ar", "Arabic"),
            ("hi", "Hindi"),
        ];

        for (code, expected_name) in test_cases {
            let template = "Language: {{erato_inject_preferred_language_en}}";
            let result = renderer.render(
                template,
                &SystemPromptContext {
                    preferred_language: Some(code),
                    ..Default::default()
                },
            );
            assert_eq!(result, format!("Language: {}", expected_name));
        }
    }
}
