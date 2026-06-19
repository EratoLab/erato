use handlebars::Handlebars;
use serde_json::json;

use crate::services::template_rendering::contexts::error_report::ErrorReportContext;

#[derive(Clone, Debug, Default)]
pub struct ErrorReportRenderer;

impl ErrorReportRenderer {
    pub fn new() -> Self {
        Self
    }

    pub fn render(&self, template: &str, ctx: &ErrorReportContext) -> String {
        let context = json!({
            "environment": ctx.environment,
            "timestamp": ctx.timestamp,
            "chat_id": ctx.chat_id,
            "assistant_id": ctx.assistant_id,
            "platform": ctx.platform,
            "facets_active": ctx.facets_active,
            "error": ctx.error,
        });

        let mut handlebars = Handlebars::new();
        handlebars.set_strict_mode(false);
        handlebars.register_escape_fn(|value| value.to_string());

        match handlebars.render_template(template, &context) {
            Ok(rendered) => rendered,
            Err(error) => {
                tracing::debug!(
                    error = %error,
                    template = %template,
                    "Failed to render assistant error report template with Handlebars, returning raw template"
                );
                template.to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_error_report_context() {
        let renderer = ErrorReportRenderer::new();
        let context = ErrorReportContext {
            environment: "development".to_string(),
            timestamp: "2026-06-19T10:00:00+00:00".to_string(),
            chat_id: "chat-1".to_string(),
            assistant_id: "<none>".to_string(),
            platform: "web".to_string(),
            facets_active: "search, mail".to_string(),
            error: "provider failed".to_string(),
        };

        let rendered = renderer.render(
            "{{environment}}|{{timestamp}}|{{chat_id}}|{{assistant_id}}|{{platform}}|{{facets_active}}|{{error}}",
            &context,
        );

        assert_eq!(
            rendered,
            "development|2026-06-19T10:00:00+00:00|chat-1|<none>|web|search, mail|provider failed"
        );
    }
}
