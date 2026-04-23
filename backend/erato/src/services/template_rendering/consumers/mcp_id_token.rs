use std::collections::HashMap;

use handlebars::Handlebars;
use serde_json::{Map, Value};

use crate::services::template_rendering::contexts::mcp_id_token::McpForwardedIdTokenContext;

pub const FORWARDED_ID_TOKEN_AUTH_HEADER_TEMPLATE: &str = "{{prefix}}{{id_token}}";

type PlaceholderFn = for<'a> fn(&McpForwardedIdTokenContext<'a>) -> String;

#[derive(Clone, Debug)]
pub struct McpIdTokenAuthHeaderRenderer {
    placeholder_registry: HashMap<String, PlaceholderFn>,
}

impl Default for McpIdTokenAuthHeaderRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl McpIdTokenAuthHeaderRenderer {
    pub fn new() -> Self {
        let mut renderer = Self {
            placeholder_registry: HashMap::new(),
        };

        renderer.register_placeholder("id_token", render_id_token);
        renderer.register_placeholder("prefix", render_prefix);

        renderer
    }

    fn register_placeholder(&mut self, name: &str, func: PlaceholderFn) {
        self.placeholder_registry.insert(name.to_string(), func);
    }

    pub fn render<'a>(&self, template: &str, ctx: &McpForwardedIdTokenContext<'a>) -> String {
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
                tracing::debug!(
                    error = %error,
                    template = %template,
                    "Failed to render MCP id token auth header template with Handlebars, returning raw template"
                );
                template.to_string()
            }
        }
    }
}

pub(crate) fn render_id_token(ctx: &McpForwardedIdTokenContext) -> String {
    ctx.id_token.unwrap_or("").to_string()
}

pub(crate) fn render_prefix(ctx: &McpForwardedIdTokenContext) -> String {
    ctx.prefix.unwrap_or("Bearer ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_token_with_prefix() {
        let renderer = McpIdTokenAuthHeaderRenderer::new();
        let result = renderer.render(
            FORWARDED_ID_TOKEN_AUTH_HEADER_TEMPLATE,
            &McpForwardedIdTokenContext {
                id_token: Some("abc"),
                prefix: Some("Token "),
            },
        );
        assert_eq!(result, "Token abc");
    }

    #[test]
    fn test_id_token_default_prefix() {
        let renderer = McpIdTokenAuthHeaderRenderer::new();
        let result = renderer.render(
            FORWARDED_ID_TOKEN_AUTH_HEADER_TEMPLATE,
            &McpForwardedIdTokenContext {
                id_token: Some("abc"),
                prefix: None,
            },
        );
        assert_eq!(result, "Bearer abc");
    }
}
