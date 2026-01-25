use chrono::Utc;
use std::collections::HashMap;

/// Type alias for placeholder substitution functions
type PlaceholderFn = fn() -> String;

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

        renderer
    }

    /// Register a custom placeholder function
    pub fn register_placeholder(&mut self, name: &str, func: PlaceholderFn) {
        self.placeholders.insert(name.to_string(), func);
    }

    /// Render a template by replacing all registered placeholders
    pub fn render(&self, template: &str) -> String {
        let mut result = template.to_string();

        for (placeholder_name, func) in &self.placeholders {
            let pattern = format!("{{{}}}", placeholder_name);

            if result.contains(&pattern) {
                let value = func();
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
fn render_now_date() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Renders current datetime in RFC3339 format with milliseconds in UTC
fn render_now_datetime() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_now_date_format() {
        let date = render_now_date();
        // Should be YYYY-MM-DD (10 characters)
        assert_eq!(date.len(), 10);
        // Should be parseable as a date
        assert!(chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_ok());
    }

    #[test]
    fn test_render_now_datetime_format() {
        let datetime = render_now_datetime();
        // Should end with Z (UTC indicator)
        assert!(datetime.ends_with('Z'));
        // Should be parseable as RFC3339
        assert!(chrono::DateTime::parse_from_rfc3339(&datetime).is_ok());
    }

    #[test]
    fn test_render_single_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Today is {erato_inject_now_date}.";
        let result = renderer.render(template);
        // Placeholder should be replaced
        assert!(!result.contains("{erato_inject_now_date}"));
        assert!(result.starts_with("Today is "));
    }

    #[test]
    fn test_render_multiple_placeholders() {
        let renderer = SystemPromptRenderer::new();
        let template = "Date: {erato_inject_now_date}, Time: {erato_inject_now_datetime}";
        let result = renderer.render(template);
        // Both placeholders should be replaced
        assert!(!result.contains("{erato_inject_now_date}"));
        assert!(!result.contains("{erato_inject_now_datetime}"));
        assert!(result.starts_with("Date: "));
        assert!(result.contains(", Time: "));
    }

    #[test]
    fn test_render_no_placeholders() {
        let renderer = SystemPromptRenderer::new();
        let template = "Normal prompt without placeholders";
        let result = renderer.render(template);
        // Should return unchanged
        assert_eq!(result, template);
    }

    #[test]
    fn test_render_unknown_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "This has {unknown_placeholder} in it.";
        let result = renderer.render(template);
        // Unknown placeholder should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_custom_placeholder_registration() {
        let mut renderer = SystemPromptRenderer::new();
        renderer.register_placeholder("test_custom", || "CUSTOM_VALUE".to_string());
        let template = "Value: {test_custom}";
        let result = renderer.render(template);
        assert_eq!(result, "Value: CUSTOM_VALUE");
    }

    #[test]
    fn test_same_placeholder_twice() {
        let renderer = SystemPromptRenderer::new();
        let template = "Start: {erato_inject_now_date}, End: {erato_inject_now_date}";
        let result = renderer.render(template);
        // Both occurrences should be replaced
        assert!(!result.contains("{erato_inject_now_date}"));
        // Both should have the same value (captured at same instant)
        let parts: Vec<&str> = result.split(", ").collect();
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn test_empty_template() {
        let renderer = SystemPromptRenderer::new();
        let template = "";
        let result = renderer.render(template);
        assert_eq!(result, "");
    }

    #[test]
    fn test_malformed_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Malformed {erato_inject_now_date without closing brace";
        let result = renderer.render(template);
        // Malformed placeholder should be left as-is
        assert_eq!(result, template);
    }

    #[test]
    fn test_case_sensitive_placeholder() {
        let renderer = SystemPromptRenderer::new();
        let template = "Wrong case: {Erato_Inject_Now_Date}";
        let result = renderer.render(template);
        // Case variation should be left as-is
        assert_eq!(result, template);
    }
}
