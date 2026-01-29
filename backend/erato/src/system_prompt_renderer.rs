use chrono::Utc;
use std::collections::HashMap;

/// Context for rendering placeholders
#[derive(Clone, Copy, Debug, Default)]
pub struct RenderContext<'a> {
    pub preferred_language: Option<&'a str>,
}

/// Type alias for placeholder substitution functions
/// We use for<'a> to allow the function to accept any lifetime
type PlaceholderFn = for<'a> fn(&RenderContext<'a>) -> String;

/// Registry of available placeholder functions for system prompt rendering
#[derive(Clone, Debug)]
pub struct SystemPromptRenderer {
    placeholders: HashMap<String, PlaceholderFn>,
}

impl Default for SystemPromptRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemPromptRenderer {
    /// Create a new SystemPromptRenderer with built-in placeholders
    pub fn new() -> Self {
        let mut renderer = Self {
            placeholders: HashMap::new(),
        };

        // Register built-in placeholders
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

        renderer
    }

    /// Register a custom placeholder function
    pub fn register_placeholder(&mut self, name: &str, func: PlaceholderFn) {
        self.placeholders.insert(name.to_string(), func);
    }

    /// Render a template by replacing all registered placeholders
    pub fn render<'a>(&self, template: &str, ctx: &RenderContext<'a>) -> String {
        let mut result = template.to_string();

        for (placeholder_name, func) in &self.placeholders {
            let pattern = format!("{{{{{}}}}}", placeholder_name);

            if result.contains(&pattern) {
                let value = func(ctx);
                result = result.replace(&pattern, &value);

                tracing::debug!(
                    placeholder = %placeholder_name,
                    value = %value,
                    "Replaced placeholder in system prompt"
                );
            }
        }

        result
    }
}

/// Renders current date in ISO 8601 format (YYYY-MM-DD) in UTC
fn render_now_date(_ctx: &RenderContext) -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Renders current datetime in RFC3339 format with milliseconds in UTC
fn render_now_datetime(_ctx: &RenderContext) -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Converts a BCP 47 language code to its English name
fn language_code_to_english_name(ctx: &RenderContext) -> String {
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

/// Renders the user's preferred language code
fn render_preferred_language_code(ctx: &RenderContext) -> String {
    ctx.preferred_language.unwrap_or("en").to_string()
}

/// Renders the English name of the user's preferred language
fn render_preferred_language_name(ctx: &RenderContext) -> String {
    language_code_to_english_name(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_now_date_format() {
        let date = render_now_date(&RenderContext::default());
        // Should be YYYY-MM-DD (10 characters)
        assert_eq!(date.len(), 10);
        // Should be parseable as a date
        assert!(chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_ok());
    }

    #[test]
    fn test_render_now_datetime_format() {
        let datetime = render_now_datetime(&RenderContext::default());
        // Should end with Z (UTC indicator)
        assert!(datetime.ends_with('Z'));
        // Should be parseable as RFC3339
        assert!(chrono::DateTime::parse_from_rfc3339(&datetime).is_ok());
    }

    #[test]
    fn test_render_single_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Today is {{erato_inject_now_date}}.";
        let result = renderer.render(template, &RenderContext::default());
        // Placeholder should be replaced
        assert!(!result.contains("{{erato_inject_now_date}}"));
        assert!(result.starts_with("Today is "));
    }

    #[test]
    fn test_render_multiple_placeholders() {
        let renderer = SystemPromptRenderer::new();
        let template = "Date: {{erato_inject_now_date}}, Time: {{erato_inject_now_datetime}}";
        let result = renderer.render(template, &RenderContext::default());
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
        let result = renderer.render(template, &RenderContext::default());
        // Should return unchanged
        assert_eq!(result, template);
    }

    #[test]
    fn test_render_unknown_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "This has {{unknown_placeholder}} in it.";
        let result = renderer.render(template, &RenderContext::default());
        // Unknown placeholder should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_custom_placeholder_registration() {
        let mut renderer = SystemPromptRenderer::new();
        fn test_custom(_ctx: &RenderContext) -> String {
            "CUSTOM_VALUE".to_string()
        }
        renderer.register_placeholder("test_custom", test_custom);
        let template = "Value: {{test_custom}}";
        let result = renderer.render(template, &RenderContext::default());
        assert_eq!(result, "Value: CUSTOM_VALUE");
    }

    #[test]
    fn test_same_placeholder_twice() {
        let renderer = SystemPromptRenderer::new();
        let template = "Start: {{erato_inject_now_date}}, End: {{erato_inject_now_date}}";
        let result = renderer.render(template, &RenderContext::default());
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
        let result = renderer.render(template, &RenderContext::default());
        assert_eq!(result, "");
    }

    #[test]
    fn test_malformed_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Malformed {{erato_inject_now_date without closing brace";
        let result = renderer.render(template, &RenderContext::default());
        // Malformed placeholder should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_case_sensitive_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Wrong case: {{Erato_Inject_Now_Date}}";
        let result = renderer.render(template, &RenderContext::default());
        // Case variation should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_preferred_language_code() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language code: {{erato_inject_preferred_language_code}}";
        let result = renderer.render(
            template,
            &RenderContext {
                preferred_language: Some("de"),
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
            &RenderContext {
                preferred_language: Some("es"),
            },
        );
        assert_eq!(result, "Language: Spanish");
    }

    #[test]
    fn test_preferred_language_code_default() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language code: {{erato_inject_preferred_language_code}}";
        let result = renderer.render(template, &RenderContext::default());
        assert_eq!(result, "Language code: en");
    }

    #[test]
    fn test_preferred_language_name_default() {
        let renderer = SystemPromptRenderer::new();
        let template = "Language: {{erato_inject_preferred_language_en}}";
        let result = renderer.render(template, &RenderContext::default());
        assert_eq!(result, "Language: English");
    }

    #[test]
    fn test_preferred_language_code_multiple_occurrences() {
        let renderer = SystemPromptRenderer::new();
        let template = "Start: {{erato_inject_preferred_language_code}}, Middle: {{erato_inject_preferred_language_code}}, End: {{erato_inject_preferred_language_code}}";
        let result = renderer.render(
            template,
            &RenderContext {
                preferred_language: Some("fr"),
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
            &RenderContext {
                preferred_language: Some("xx"),
            },
        );
        assert_eq!(result, "Language: English");
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
                &RenderContext {
                    preferred_language: Some(code),
                },
            );
            assert_eq!(result, format!("Language: {}", expected_name));
        }
    }
}
