use handlebars::template::{Parameter, TemplateElement};
use handlebars::{Handlebars, Template};
use serde_json::json;

use crate::services::template_rendering::contexts::chat_provider_headers::ChatProviderHeadersContext;

#[derive(Clone, Debug, Default)]
pub struct ChatProviderHeadersRenderer;

impl ChatProviderHeadersRenderer {
    /// Inspect parsed expressions so literal text and comments do not suppress headers.
    pub fn requires_chat(template: &str) -> bool {
        Template::compile(template)
            .is_ok_and(|template| template.elements.iter().any(element_requires_chat))
    }

    pub fn new() -> Self {
        Self
    }

    pub fn render<'a>(&self, template: &str, ctx: &ChatProviderHeadersContext<'a>) -> String {
        let context = json!({
            "chat": ctx.chat_id.map(|id| json!({ "id": id })),
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

fn parameter_requires_chat(parameter: &Parameter) -> bool {
    match parameter {
        Parameter::Path(_) => parameter.as_name().is_some_and(|path| {
            path.split(['.', '/', '[', ']'])
                .find(|part| !part.is_empty() && *part != "this" && *part != "@root")
                == Some("chat")
        }),
        Parameter::Subexpression(expression) => element_requires_chat(expression.as_element()),
        _ => false,
    }
}

fn element_requires_chat(element: &TemplateElement) -> bool {
    match element {
        TemplateElement::Expression(helper)
        | TemplateElement::HtmlExpression(helper)
        | TemplateElement::HelperBlock(helper) => {
            parameter_requires_chat(&helper.name)
                || helper.params.iter().any(parameter_requires_chat)
                || helper.hash.values().any(parameter_requires_chat)
                || helper
                    .template
                    .iter()
                    .chain(helper.inverse.iter())
                    .any(|template| template.elements.iter().any(element_requires_chat))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_chat_uuid_without_escaping_existing_variables() {
        let claims = json!({"tenant": "a&b=c"});
        let id = sea_orm::prelude::Uuid::new_v4();
        let ctx = ChatProviderHeadersContext::new("user-123", &claims).with_chat_id(id);
        assert_eq!(
            ChatProviderHeadersRenderer::new().render(
                "{{chat.id}}|{{erato_user.id}}|{{id_token.claims.tenant}}",
                &ctx
            ),
            format!("{id}|user-123|a&b=c")
        );
    }

    #[test]
    fn detects_chat_dependencies_in_handlebars_expressions() {
        for template in [
            "{{chat.id}}",
            "prefix-{{ chat.id }}",
            "{{{chat.id}}}",
            "{{chat.[id]}}",
            "{{@root.chat.id}}",
            "{{#with chat}}{{id}}{{/with}}",
            "{{#if erato_user.id}}{{chat.id}}{{/if}}",
        ] {
            assert!(
                ChatProviderHeadersRenderer::requires_chat(template),
                "{template}"
            );
        }
        for template in [
            "literal chat.id",
            "{{! chat.id }}fixed",
            "{{erato_user.id}}",
            "{{id_token.claims.chat.id}}",
        ] {
            assert!(
                !ChatProviderHeadersRenderer::requires_chat(template),
                "{template}"
            );
        }
    }

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
