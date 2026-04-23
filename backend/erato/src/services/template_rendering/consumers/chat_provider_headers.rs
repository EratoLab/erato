use handlebars::Handlebars;
use serde_json::json;

use crate::services::template_rendering::contexts::chat_provider_headers::ChatProviderHeadersContext;

#[derive(Clone, Debug, Default)]
pub struct ChatProviderHeadersRenderer;

impl ChatProviderHeadersRenderer {
    pub fn new() -> Self {
        Self
    }

    pub fn render<'a>(&self, template: &str, ctx: &ChatProviderHeadersContext<'a>) -> String {
        let context = json!({
            "erato_user": {
                "id": ctx.erato_user.id,
            },
            "id_token": {
                "claims": ctx.id_token.claims,
            },
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
                    "Failed to render chat provider headers template with Handlebars, returning raw template"
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
    fn test_render_with_user_id_and_id_token_claims() {
        let renderer = ChatProviderHeadersRenderer::new();
        let id_token_claims = json!({"upn":"alice@example.com"});
        let ctx = ChatProviderHeadersContext::new("user-123", &id_token_claims);

        let result = renderer.render(
            "X-Test-User: {{erato_user.id}}|UPN: {{id_token.claims.upn}}",
            &ctx,
        );
        assert_eq!(result, "X-Test-User: user-123|UPN: alice@example.com");
    }

    #[test]
    fn test_render_missing_claim_returns_empty() {
        let renderer = ChatProviderHeadersRenderer::new();
        let id_token_claims = json!({"aud":"example"});
        let ctx = ChatProviderHeadersContext::new("user-456", &id_token_claims);

        let result = renderer.render("X-Unknown: {{id_token.claims.tenant_id}}", &ctx);
        assert_eq!(result, "X-Unknown: ");
    }
}
