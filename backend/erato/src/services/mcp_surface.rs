//! Which surface an MCP tool call comes from and which output formats that
//! surface accepts, told to servers that opt in with
//! `mcp_servers.<id>.surface_hints`. The hint rides in the tool call's
//! `_meta` for servers of both protocol eras, never in the tool's arguments,
//! so the model never sees it.
use crate::config::McpSurfaceConfig;
use crate::ms_teams_bot::{TEAMS_BOT_PLATFORM, TEAMS_PLATFORM};
use crate::services::mcp_apps::VIEW_MIME_TYPE;
use rmcp::model::CallToolRequestParams;
use serde_json::{Value, json};
use std::collections::HashMap;

/// Key of the surface hint in the tool call's `_meta`, for stateless and
/// legacy servers alike.
pub const SURFACE_HINT_KEY: &str = "chat.erato/surface";

const SVG_THEN_PNG: &[&str] = &["image/svg+xml", "image/png"];

/// The surfaces whose app shows a tool's interactive view (MCP Apps): the
/// web app. The add-ins, the Teams tab and the Teams bot show none.
const VIEW_SURFACES: &[&str] = &["web"];

/// What each surface accepts unless `mcp_servers_global.surfaces` names it,
/// keyed by its `X-Erato-Platform` value.
const DEFAULT_SURFACES: [(&str, &[&str]); 8] = [
    ("web", SVG_THEN_PNG),
    ("outlook", SVG_THEN_PNG),
    ("word", SVG_THEN_PNG),
    ("excel", SVG_THEN_PNG),
    ("powerpoint", SVG_THEN_PNG),
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

    /// The hint for a server with MCP Apps on: on a surface whose app shows
    /// views, the list starts with the view's MIME type, whatever the
    /// surface's list holds, so the server can return its view alone. A
    /// configured list never holds it: it takes no parameters. Other
    /// surfaces keep their list.
    pub fn with_views(mut self) -> Self {
        if VIEW_SURFACES.contains(&self.surface.as_str()) {
            self.accept.insert(0, VIEW_MIME_TYPE.to_string());
        }
        self
    }

    /// The hint as the server reads it.
    pub fn to_value(&self) -> Value {
        json!({"surface": self.surface, "accept": self.accept})
    }

    /// Put the hint into a tool call's `_meta`.
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
        for surface in [
            "web",
            "outlook",
            "word",
            "excel",
            "powerpoint",
            "addin-neutral",
            "teams",
        ] {
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
            ("onenote", &["image/png"]),
            ("word", &[]),
        ]);
        assert_eq!(
            SurfaceHint::resolve("teams-bot", &configured)
                .unwrap()
                .to_value(),
            json!({"surface": "teams-bot", "accept": ["image/jpeg", "image/png"]}),
        );
        assert_eq!(
            SurfaceHint::resolve("onenote", &configured)
                .unwrap()
                .to_value(),
            json!({"surface": "onenote", "accept": ["image/png"]}),
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
    fn with_views_the_web_app_takes_the_view_first_and_other_surfaces_are_unchanged() {
        assert_eq!(
            SurfaceHint::resolve("web", &HashMap::new())
                .unwrap()
                .with_views()
                .to_value(),
            json!({"surface": "web",
                "accept": ["text/html;profile=mcp-app", "image/svg+xml", "image/png"]}),
        );
        // Whatever the configured list holds, an empty one too.
        assert_eq!(
            SurfaceHint::resolve("web", &configured(&[("web", &["image/png"])]))
                .unwrap()
                .with_views()
                .to_value(),
            json!({"surface": "web", "accept": ["text/html;profile=mcp-app", "image/png"]}),
        );
        assert_eq!(
            SurfaceHint::resolve("web", &configured(&[("web", &[])]))
                .unwrap()
                .with_views()
                .to_value(),
            json!({"surface": "web", "accept": ["text/html;profile=mcp-app"]}),
        );
        for surface in [
            "outlook",
            "word",
            "excel",
            "powerpoint",
            "addin-neutral",
            "teams",
            "teams-bot",
        ] {
            let hint = SurfaceHint::resolve(surface, &HashMap::new()).unwrap();
            assert_eq!(hint.clone().with_views(), hint, "{surface}");
        }
    }

    #[test]
    fn an_unknown_surface_gets_no_hint() {
        assert_eq!(SurfaceHint::resolve("onenote", &HashMap::new()), None);
        assert_eq!(SurfaceHint::resolve("Teams", &HashMap::new()), None);
        assert_eq!(SurfaceHint::resolve("", &HashMap::new()), None);
    }
}
