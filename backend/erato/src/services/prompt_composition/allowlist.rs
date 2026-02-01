use crate::config::ExperimentalFacetsConfig;
use std::collections::HashSet;

/// Build the MCP tool allowlist for the current generation based on facets.
///
/// - Returns `None` when no facets are configured at all (no filtering).
/// - Returns `None` when the computed allowlist is empty (no filtering).
/// - Otherwise returns a de-duplicated list of allowlist patterns.
pub fn build_mcp_tool_allowlist(
    experimental_facets: &ExperimentalFacetsConfig,
    selected_facet_ids: &[String],
) -> Option<Vec<String>> {
    if experimental_facets.facets.is_empty() {
        return None;
    }

    let mut allowlist = Vec::new();
    let mut seen = HashSet::new();

    let mut push_unique = |value: &str| {
        if seen.insert(value.to_string()) {
            allowlist.push(value.to_string());
        }
    };

    for entry in &experimental_facets.tool_call_allowlist {
        push_unique(entry);
    }

    for facet_id in selected_facet_ids {
        if let Some(facet) = experimental_facets.facets.get(facet_id) {
            for entry in &facet.tool_call_allowlist {
                push_unique(entry);
            }
        }
    }

    if allowlist.is_empty() {
        None
    } else {
        Some(allowlist)
    }
}

#[cfg(test)]
mod tests {
    use super::build_mcp_tool_allowlist;
    use crate::config::{ExperimentalFacetsConfig, FacetConfig};
    use std::collections::HashMap;

    fn facet(display_name: &str, tool_call_allowlist: Vec<&str>) -> FacetConfig {
        FacetConfig {
            display_name: display_name.to_string(),
            icon: None,
            additional_system_prompt: None,
            tool_call_allowlist: tool_call_allowlist
                .into_iter()
                .map(|entry| entry.to_string())
                .collect(),
            model_settings: Default::default(),
            disable_facet_prompt_template: false,
        }
    }

    #[test]
    fn returns_none_when_no_facets_configured() {
        let config = ExperimentalFacetsConfig {
            tool_call_allowlist: vec!["web-search-mcp/*".to_string()],
            ..Default::default()
        };

        let allowlist = build_mcp_tool_allowlist(&config, &[]);
        assert!(allowlist.is_none());
    }

    #[test]
    fn includes_global_allowlist_when_facets_exist() {
        let config = ExperimentalFacetsConfig {
            tool_call_allowlist: vec!["web-search-mcp/*".to_string()],
            facets: HashMap::from([("web_search".to_string(), facet("Web search", vec![]))]),
            ..Default::default()
        };

        let allowlist = build_mcp_tool_allowlist(&config, &[]);
        assert_eq!(allowlist, Some(vec!["web-search-mcp/*".to_string()]));
    }

    #[test]
    fn includes_selected_facet_allowlists() {
        let config = ExperimentalFacetsConfig {
            tool_call_allowlist: vec!["global/*".to_string()],
            facets: HashMap::from([
                (
                    "web_search".to_string(),
                    facet("Web search", vec!["web-search-mcp/*", "web-access-mcp/*"]),
                ),
                ("other".to_string(), facet("Other", vec!["other/*"])),
            ]),
            ..Default::default()
        };

        let allowlist =
            build_mcp_tool_allowlist(&config, &["web_search".to_string(), "missing".to_string()]);

        assert_eq!(
            allowlist,
            Some(vec![
                "global/*".to_string(),
                "web-search-mcp/*".to_string(),
                "web-access-mcp/*".to_string(),
            ])
        );
    }
}
