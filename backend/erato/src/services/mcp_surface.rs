//! Which surface an MCP tool call comes from and which output formats that
//! surface accepts, told to servers that opt in with
//! `mcp_servers.<id>.surface_hints`. The hint rides in the request's MCP
//! metadata, never in the tool's arguments, so the model never sees it.
use crate::config::McpSurfaceConfig;
use crate::ms_teams_bot::{TEAMS_BOT_PLATFORM, TEAMS_PLATFORM};
use rmcp::model::CallToolRequestParams;
use serde_json::{Map, Value, json};
use std::collections::HashMap;

/// Key of the surface hint: an extension in `clientCapabilities` for a
/// stateless server, an entry of the tool call's `_meta` for a legacy one.
pub const SURFACE_HINT_KEY: &str = "chat.erato/surface";

const SVG_THEN_PNG: &[&str] = &["image/svg+xml", "image/png"];

/// What each surface accepts unless `mcp_servers_global.surfaces` names it,
/// keyed by its `X-Erato-Platform` value.
const DEFAULT_SURFACES: [(&str, &[&str]); 6] = [
    ("web", SVG_THEN_PNG),
    ("outlook", SVG_THEN_PNG),
    ("word", SVG_THEN_PNG),
    ("addin-neutral", SVG_THEN_PNG),
    (TEAMS_PLATFORM, SVG_THEN_PNG),
    (TEAMS_BOT_PLATFORM, &["image/png"]),
];

/// What one tool call tells an opted-in server about where it comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceHint {
    surface: String,
    accept: Vec<String>,
}

impl SurfaceHint {
    /// The hint for a call from `platform`: the surface's configured list,
    /// else its built-in one. `None` for a surface neither names, so a header
    /// value Erato does not know is never passed on.
    pub fn resolve(platform: &str, configured: &HashMap<String, McpSurfaceConfig>) -> Option<Self> {
        let accept = match configured.get(platform) {
            Some(surface) => surface
                .accept
                .iter()
                .map(|mime_type| mime_type.to_ascii_lowercase())
                .collect(),
            None => DEFAULT_SURFACES
                .iter()
                .find(|(surface, _)| *surface == platform)?
                .1
                .iter()
                .map(|mime_type| (*mime_type).to_string())
                .collect(),
        };
        Some(Self {
            surface: platform.to_string(),
            accept,
        })
    }

    /// The hint as the server reads it.
    pub fn to_value(&self) -> Value {
        json!({"surface": self.surface, "accept": self.accept})
    }

    /// The `clientCapabilities` of a stateless tool call that carries it.
    pub fn client_capabilities(&self) -> Value {
        let mut extensions = Map::new();
        extensions.insert(SURFACE_HINT_KEY.to_string(), self.to_value());
        json!({"extensions": extensions})
    }

    /// Put the hint into a legacy tool call's `_meta`.
    pub fn add_to_call(&self, params: &mut CallToolRequestParams) {
        params
            .meta
            .get_or_insert_with(Default::default)
            .insert(SURFACE_HINT_KEY.to_string(), self.to_value());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configured(entries: &[(&str, &[&str])]) -> HashMap<String, McpSurfaceConfig> {
        entries
            .iter()
            .map(|(surface, accept)| {
                (
                    (*surface).to_string(),
                    McpSurfaceConfig {
                        accept: accept.iter().map(|value| (*value).to_string()).collect(),
                    },
                )
            })
            .collect()
    }

    #[test]
    fn every_surface_has_a_built_in_list_and_the_bot_takes_no_svg() {
        for surface in ["web", "outlook", "word", "addin-neutral", "teams"] {
            assert_eq!(
                SurfaceHint::resolve(surface, &HashMap::new())
                    .unwrap()
                    .to_value(),
                json!({"surface": surface, "accept": ["image/svg+xml", "image/png"]}),
            );
        }
        assert_eq!(
            SurfaceHint::resolve("teams-bot", &HashMap::new())
                .unwrap()
                .to_value(),
            json!({"surface": "teams-bot", "accept": ["image/png"]}),
        );
    }

    #[test]
    fn a_configured_list_replaces_the_built_in_one_and_names_new_surfaces() {
        let configured = configured(&[
            ("teams-bot", &["image/jpeg", "Image/PNG"]),
            ("excel", &["image/png"]),
            ("word", &[]),
        ]);
        assert_eq!(
            SurfaceHint::resolve("teams-bot", &configured)
                .unwrap()
                .to_value(),
            json!({"surface": "teams-bot", "accept": ["image/jpeg", "image/png"]}),
        );
        assert_eq!(
            SurfaceHint::resolve("excel", &configured)
                .unwrap()
                .to_value(),
            json!({"surface": "excel", "accept": ["image/png"]}),
        );
        assert_eq!(
            SurfaceHint::resolve("word", &configured)
                .unwrap()
                .to_value(),
            json!({"surface": "word", "accept": []}),
        );
        // Other surfaces keep their built-in lists.
        assert!(SurfaceHint::resolve("outlook", &configured).is_some());
    }

    #[test]
    fn an_unknown_surface_gets_no_hint() {
        assert_eq!(SurfaceHint::resolve("excel", &HashMap::new()), None);
        assert_eq!(SurfaceHint::resolve("Teams", &HashMap::new()), None);
        assert_eq!(SurfaceHint::resolve("", &HashMap::new()), None);
    }

    #[test]
    fn the_hint_goes_under_one_key_in_both_places() {
        let hint = SurfaceHint::resolve("teams", &HashMap::new()).unwrap();
        assert_eq!(
            hint.client_capabilities(),
            json!({"extensions": {"chat.erato/surface": hint.to_value()}}),
        );
        let mut params = CallToolRequestParams::new("render");
        params.arguments = json!({"diagram": "a -> b"}).as_object().cloned();
        hint.add_to_call(&mut params);
        let sent = serde_json::to_value(&params).unwrap();
        assert_eq!(sent["_meta"]["chat.erato/surface"], hint.to_value());
        assert_eq!(sent["arguments"], json!({"diagram": "a -> b"}));
    }
}
