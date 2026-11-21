//! The names MCP tools are offered to the model under.
//!
//! A provider takes each tool name once per request, and Erato routes a call
//! by the name the model used. Two servers built from the same codebase expose
//! the same tool names, and an MCP tool can also be named like one of Erato's
//! own tools. Such a tool is offered under a name qualified with its server id
//! (`<server>__<tool>`); every other tool keeps its bare name. A qualified
//! name depends only on the server id, the tool name and which names collide,
//! never on the order the servers answered in.

use crate::config::{AppConfig, McpRuntimeConfig};
use crate::services::mcp_session_manager::ManagedTool;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

/// Joins the server id and the tool name of a qualified name.
pub const SEPARATOR: &str = "__";

/// The longest tool name every supported provider accepts.
pub const MAX_NAME_LEN: usize = 64;

/// Hex digits of the digest that ends a qualified name which had to be
/// shortened, cleaned or told apart from another name.
const DIGEST_HEX_LEN: usize = 8;

/// The names Erato offers its own tools under, whether or not this deployment
/// offers them.
pub fn builtin_tool_names() -> Vec<&'static str> {
    use crate::services::scheduled_items::chat_tools;
    let mut names = vec![
        erato_config::config::CLIENT_ACTION_TOOL_NAME,
        erato_config::config::DELEGATE_TO_ASSISTANT_TOOL_NAME,
        erato_config::config::DELEGATE_TASK_TOOL_NAME,
        crate::services::mcp_wait::WAIT_TOOL_NAME,
        crate::services::file_retrieval::TOOL_NAME,
        crate::services::embedded_images::TOOL_NAME,
    ];
    names.extend(chat_tools::TOOL_NAMES);
    names
}

/// The names of Erato's own tools this deployment can offer. An MCP tool with
/// one of these names is offered under its qualified name, so both stay
/// callable; a tool Erato never offers here leaves its name to the MCP tool.
/// Read from the configuration alone, never from the turn, so a tool keeps
/// its name from turn to turn. `reminders` says whether this deployment
/// delivers reminders (see `scheduled_items::teams_channel_available`).
pub fn offered_builtin_tool_names(
    config: &AppConfig,
    mcp: &McpRuntimeConfig,
    reminders: bool,
) -> Vec<&'static str> {
    use crate::services::scheduled_items::chat_tools;
    let client_actions = config
        .action_facets
        .facets
        .values()
        .any(|facet| !facet.client_actions.is_empty());
    let wait = mcp.mcp_servers_global.enable_wait
        || mcp
            .mcp_servers
            .values()
            .any(|server| !server.wait_tools.is_empty());
    let embedded_images = match &config.chat_providers {
        Some(providers) => providers
            .providers
            .keys()
            .any(|provider_id| config.embedded_image_retrieval_enabled(provider_id)),
        None => config
            .chat_provider
            .as_ref()
            .is_some_and(|provider| provider.enable_embedded_image_retrieval_tool == Some(true)),
    };
    let offered = [
        (
            erato_config::config::CLIENT_ACTION_TOOL_NAME,
            client_actions,
        ),
        // Offered for any assistant a user mentions.
        (erato_config::config::DELEGATE_TO_ASSISTANT_TOOL_NAME, true),
        (
            erato_config::config::DELEGATE_TASK_TOOL_NAME,
            config.delegation.tasks.enabled,
        ),
        (crate::services::mcp_wait::WAIT_TOOL_NAME, wait),
        (
            crate::services::file_retrieval::TOOL_NAME,
            config.file_context.retrieve_file_contents_enabled,
        ),
        (crate::services::embedded_images::TOOL_NAME, embedded_images),
    ];
    offered
        .into_iter()
        .filter_map(|(name, offered)| offered.then_some(name))
        .chain(chat_tools::TOOL_NAMES.into_iter().filter(|_| reminders))
        .collect()
}

/// A bare tool name that more than one server, or a server and Erato itself,
/// offer.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct NameCollision {
    pub tool_name: String,
    /// The servers that offer it, sorted.
    pub server_ids: Vec<String>,
    /// Whether one of Erato's own tools has the name too.
    pub builtin: bool,
    /// The names the model sees instead, in the order of `server_ids`.
    pub model_names: Vec<String>,
}

/// Give every tool whose bare name another server or `builtin_names` also
/// uses a qualified name (see [`ManagedTool::model_name`]), and clear it on
/// every other tool. Returns the collisions, sorted by tool name.
pub fn assign_model_names(tools: &mut [ManagedTool], builtin_names: &[&str]) -> Vec<NameCollision> {
    let builtin: HashSet<&str> = builtin_names.iter().copied().collect();
    let mut servers_by_name: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for tool in tools.iter_mut() {
        tool.qualified_name = None;
        servers_by_name
            .entry(tool.tool.name.to_string())
            .or_default()
            .insert(tool.server_id.clone());
    }
    let colliding: BTreeMap<&str, &BTreeSet<String>> = servers_by_name
        .iter()
        .filter(|(name, servers)| servers.len() > 1 || builtin.contains(name.as_str()))
        .map(|(name, servers)| (name.as_str(), servers))
        .collect();
    if colliding.is_empty() {
        return Vec::new();
    }

    // Names that stay as they are: Erato's own and every bare name no one
    // else uses. A qualified name must not take any of them.
    let mut taken: HashSet<String> = builtin.iter().map(|name| (*name).to_string()).collect();
    taken.extend(
        servers_by_name
            .keys()
            .filter(|name| !colliding.contains_key(name.as_str()))
            .cloned(),
    );

    let pairs: Vec<(&str, &str)> = colliding
        .iter()
        .flat_map(|(name, servers)| servers.iter().map(|server| (server.as_str(), *name)))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let candidates: Vec<(String, bool)> = pairs
        .iter()
        .map(|(server_id, tool_name)| plain_qualified_name(server_id, tool_name))
        .collect();
    // Two faithful names are the same text only when a separator inside a
    // server id or tool name makes them so (`a__b` + `c`, `a` + `b__c`).
    let mut faithful_uses: HashMap<&str, usize> = HashMap::new();
    for (candidate, faithful) in &candidates {
        if *faithful {
            *faithful_uses.entry(candidate.as_str()).or_default() += 1;
        }
    }

    // A faithful name that is free is used as it is; any other pair ends in a
    // digest of its own server id and tool name.
    let mut assigned: HashMap<(&str, &str), String> = HashMap::new();
    for (pair, (candidate, faithful)) in pairs.iter().zip(&candidates) {
        if *faithful && faithful_uses[candidate.as_str()] == 1 && !taken.contains(candidate) {
            assigned.insert(*pair, candidate.clone());
        }
    }
    taken.extend(assigned.values().cloned());
    for (pair, (candidate, _)) in pairs.iter().zip(&candidates) {
        if assigned.contains_key(pair) {
            continue;
        }
        let (server_id, tool_name) = *pair;
        let name = (0u32..)
            .map(|attempt| digest_qualified_name(candidate, server_id, tool_name, attempt))
            .find(|name| !taken.contains(name))
            .expect("an unused digest");
        taken.insert(name.clone());
        assigned.insert(*pair, name);
    }

    for tool in tools.iter_mut() {
        if let Some(name) = assigned.get(&(tool.server_id.as_str(), &*tool.tool.name)) {
            tool.qualified_name = Some(name.clone());
        }
    }

    colliding
        .iter()
        .map(|(tool_name, servers)| NameCollision {
            tool_name: (*tool_name).to_string(),
            server_ids: servers.iter().cloned().collect(),
            builtin: builtin.contains(tool_name),
            model_names: servers
                .iter()
                .map(|server_id| assigned[&(server_id.as_str(), *tool_name)].clone())
                .collect(),
        })
        .collect()
}

/// The tools keyed by the name the model calls them by, which is the key a
/// call is dispatched by.
pub fn by_model_name(tools: Vec<ManagedTool>) -> HashMap<String, ManagedTool> {
    tools
        .into_iter()
        .map(|tool| (tool.model_name().to_string(), tool))
        .collect()
}

/// Log each collision once per process: the tool set is resolved on every
/// turn, and the configuration that causes a collision rarely changes.
pub fn warn_about(collisions: &[NameCollision]) {
    static WARNED: LazyLock<Mutex<HashSet<NameCollision>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    for collision in collisions {
        let first = WARNED
            .lock()
            .map(|mut warned| warned.insert(collision.clone()))
            .unwrap_or(true);
        if !first {
            continue;
        }
        if collision.builtin {
            tracing::warn!(
                tool = %collision.tool_name,
                servers = ?collision.server_ids,
                model_names = ?collision.model_names,
                "An MCP tool is named like one of Erato's own tools; offering it under a name qualified with its server id"
            );
        } else {
            tracing::warn!(
                tool = %collision.tool_name,
                servers = ?collision.server_ids,
                model_names = ?collision.model_names,
                "Several MCP servers offer a tool of the same name; offering each under a name qualified with its server id"
            );
        }
    }
}

/// `<server>__<tool>` with every character a provider would refuse replaced by
/// `_`, and whether that is the server id and tool name exactly, fits and
/// starts the way every provider accepts.
fn plain_qualified_name(server_id: &str, tool_name: &str) -> (String, bool) {
    let name = format!("{}{SEPARATOR}{}", sanitize(server_id), sanitize(tool_name));
    let faithful = name == format!("{server_id}{SEPARATOR}{tool_name}")
        && name.len() <= MAX_NAME_LEN
        && name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_');
    (name, faithful)
}

/// The plain name, cut to leave room, prefixed with `_` when it does not start
/// with a letter, and ended with `_` and a digest of the exact server id and
/// tool name, so names that read the same after cleaning stay apart.
fn digest_qualified_name(plain: &str, server_id: &str, tool_name: &str, attempt: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server_id.as_bytes());
    hasher.update([0]);
    hasher.update(tool_name.as_bytes());
    if attempt > 0 {
        hasher.update([0]);
        hasher.update(attempt.to_be_bytes());
    }
    let digest: String = hasher
        .finalize()
        .iter()
        .take(DIGEST_HEX_LEN / 2)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let mut prefix = String::new();
    if !plain.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') {
        prefix.push('_');
    }
    // `plain` is ASCII after sanitizing, so any byte index is a boundary.
    let room = MAX_NAME_LEN - DIGEST_HEX_LEN - 1 - prefix.len();
    prefix.push_str(&plain[..plain.len().min(room)]);
    format!("{prefix}_{digest}")
}

/// Letters, digits, `_` and `-` are the characters every supported provider
/// accepts in a tool name.
fn sanitize(part: &str) -> String {
    part.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::Tool;
    use std::sync::Arc;

    fn tool(server_id: &str, name: &str) -> ManagedTool {
        ManagedTool {
            server_id: server_id.to_string(),
            tool: Tool::new(name.to_string(), "", serde_json::Map::new()),
            approval_argument: None,
            destructive_hint_source: Default::default(),
            qualified_name: None,
        }
    }

    fn model_names(tools: &[ManagedTool]) -> Vec<(&str, &str, &str)> {
        tools
            .iter()
            .map(|tool| (tool.server_id.as_str(), &*tool.tool.name, tool.model_name()))
            .collect()
    }

    fn is_provider_safe(name: &str) -> bool {
        !name.is_empty()
            && name.len() <= MAX_NAME_LEN
            && name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    }

    #[test]
    fn unique_names_stay_bare() {
        let mut tools = vec![tool("crm", "search"), tool("files", "read_file")];
        let collisions = assign_model_names(&mut tools, &builtin_tool_names());
        assert!(collisions.is_empty());
        assert_eq!(
            model_names(&tools),
            [
                ("crm", "search", "search"),
                ("files", "read_file", "read_file")
            ]
        );
        assert!(tools.iter().all(|tool| tool.qualified_name.is_none()));
    }

    #[test]
    fn a_name_two_servers_share_is_qualified_on_both_and_nothing_else_changes() {
        let mut tools = vec![
            tool("crm_eu", "search"),
            tool("crm_eu", "get_record"),
            tool("crm_us", "search"),
            tool("files", "read_file"),
        ];
        let collisions = assign_model_names(&mut tools, &builtin_tool_names());
        assert_eq!(
            collisions,
            [NameCollision {
                tool_name: "search".into(),
                server_ids: vec!["crm_eu".into(), "crm_us".into()],
                builtin: false,
                model_names: vec!["crm_eu__search".into(), "crm_us__search".into()],
            }]
        );
        assert_eq!(
            model_names(&tools),
            [
                ("crm_eu", "search", "crm_eu__search"),
                ("crm_eu", "get_record", "get_record"),
                ("crm_us", "search", "crm_us__search"),
                ("files", "read_file", "read_file"),
            ]
        );
    }

    #[test]
    fn names_do_not_depend_on_the_order_servers_answered_in() {
        let mut forward = vec![
            tool("a", "search"),
            tool("b", "search"),
            tool("c.d", "search"),
            tool("c_d", "search"),
        ];
        let mut backward: Vec<ManagedTool> = forward.iter().rev().cloned().collect();
        assign_model_names(&mut forward, &[]);
        assign_model_names(&mut backward, &[]);
        let mut forward = model_names(&forward);
        let mut backward = model_names(&backward);
        forward.sort();
        backward.sort();
        assert_eq!(forward, backward);
    }

    #[test]
    fn a_tool_named_like_a_builtin_is_qualified() {
        let mut tools = vec![tool("scheduler", "wait"), tool("scheduler", "plan")];
        let collisions = assign_model_names(&mut tools, &builtin_tool_names());
        assert_eq!(collisions.len(), 1);
        assert!(collisions[0].builtin);
        assert_eq!(
            model_names(&tools),
            [
                ("scheduler", "wait", "scheduler__wait"),
                ("scheduler", "plan", "plan")
            ]
        );
    }

    /// Only the tools a deployment can offer take their names from MCP tools:
    /// with waiting and reminders off, an MCP `wait` or `list_reminders`
    /// keeps its name.
    #[test]
    fn only_builtins_the_deployment_offers_take_a_name() {
        let mut config = AppConfig::default();
        config.file_context.retrieve_file_contents_enabled = false;
        let mut mcp = McpRuntimeConfig::default();
        let offered = |config: &AppConfig, mcp: &McpRuntimeConfig, reminders| {
            let mut names = offered_builtin_tool_names(config, mcp, reminders);
            names.sort_unstable();
            names
        };
        assert_eq!(
            offered(&config, &mcp, false),
            [erato_config::config::DELEGATE_TO_ASSISTANT_TOOL_NAME]
        );
        let mut tools = vec![
            tool("todo", crate::services::mcp_wait::WAIT_TOOL_NAME),
            tool("todo", "list_reminders"),
        ];
        assert!(assign_model_names(&mut tools, &offered(&config, &mcp, false)).is_empty());
        assert_eq!(
            model_names(&tools),
            [
                ("todo", "wait", "wait"),
                ("todo", "list_reminders", "list_reminders")
            ]
        );

        mcp.mcp_servers_global.enable_wait = true;
        assert!(offered(&config, &mcp, false).contains(&crate::services::mcp_wait::WAIT_TOOL_NAME));
        mcp.mcp_servers_global.enable_wait = false;
        let waits = serde_json::from_value(serde_json::json!({
            "transport_type": "streamable_http",
            "url": "http://jobs.example.test/mcp",
            "wait_tools": ["poll_*"],
        }))
        .unwrap();
        mcp.mcp_servers.insert("jobs".into(), waits);
        assert!(offered(&config, &mcp, false).contains(&crate::services::mcp_wait::WAIT_TOOL_NAME));

        assert!(offered(&config, &mcp, true).contains(&"list_reminders"));
        config.delegation.tasks.enabled = true;
        config.file_context.retrieve_file_contents_enabled = true;
        let names = offered(&config, &mcp, true);
        assert!(names.contains(&erato_config::config::DELEGATE_TASK_TOOL_NAME));
        assert!(names.contains(&crate::services::file_retrieval::TOOL_NAME));
        assert!(!names.contains(&erato_config::config::CLIENT_ACTION_TOOL_NAME));
        assert!(names.iter().all(|name| builtin_tool_names().contains(name)));

        assign_model_names(&mut tools, &names);
        assert_eq!(
            model_names(&tools),
            [
                ("todo", "wait", "todo__wait"),
                ("todo", "list_reminders", "todo__list_reminders")
            ]
        );
    }

    #[test]
    fn a_qualified_name_never_takes_a_name_that_stays() {
        // `a__search` is the qualified name of `a`'s `search`, and also a bare
        // tool of `c` that no one else uses: the bare one keeps it.
        let mut tools = vec![
            tool("a", "search"),
            tool("b", "search"),
            tool("c", "a__search"),
        ];
        assign_model_names(&mut tools, &[]);
        let names = model_names(&tools);
        assert_eq!(names[2], ("c", "a__search", "a__search"));
        assert_eq!(names[1], ("b", "search", "b__search"));
        assert!(names[0].2.starts_with("a__search_"));
        assert_ne!(names[0].2, "a__search");
    }

    #[test]
    fn names_that_clean_to_the_same_text_stay_apart() {
        let mut tools = vec![
            tool("crm.eu", "search"),
            tool("crm_eu", "search"),
            tool("crm-eu", "search"),
        ];
        assign_model_names(&mut tools, &[]);
        let names = model_names(&tools);
        // The exact one keeps the plain name; the cleaned one gets a digest.
        assert_eq!(names[1].2, "crm_eu__search");
        assert_eq!(names[2].2, "crm-eu__search");
        assert!(names[0].2.starts_with("crm_eu__search_"));
        let unique: HashSet<&str> = names.iter().map(|(_, _, name)| *name).collect();
        assert_eq!(unique.len(), 3);
        assert!(names.iter().all(|(_, _, name)| is_provider_safe(name)));
    }

    #[test]
    fn long_and_odd_names_fit_every_provider() {
        let long_server = "s".repeat(60);
        let mut tools = vec![
            tool(&format!("{long_server}a"), "search"),
            tool(&format!("{long_server}b"), "search"),
            tool("1crm", "lookup"),
            tool("2crm", "lookup"),
            tool("Ünïcode/srv", "files.list"),
            tool("plain", "files.list"),
        ];
        let collisions = assign_model_names(&mut tools, &[]);
        assert_eq!(collisions.len(), 3);
        let names = model_names(&tools);
        assert!(
            names.iter().all(|(_, _, name)| is_provider_safe(name)),
            "{names:?}"
        );
        let unique: HashSet<&str> = names.iter().map(|(_, _, name)| *name).collect();
        assert_eq!(unique.len(), names.len());
        // Two long names that share their kept prefix differ by their digests.
        assert_eq!(names[0].2.len(), MAX_NAME_LEN);
        assert_eq!(names[1].2.len(), MAX_NAME_LEN);
        assert_eq!(names[0].2[..55], names[1].2[..55]);
        assert!(names[2].2.starts_with("_1crm__lookup_"));
    }

    #[test]
    fn a_name_is_the_same_on_every_run() {
        let mut first = vec![tool("crm.eu", "search"), tool("crm_us", "search")];
        let mut second = first.clone();
        assign_model_names(&mut first, &[]);
        assign_model_names(&mut second, &[]);
        assert_eq!(model_names(&first), model_names(&second));
        // Pinned: a change to the digest renames tools in running chats.
        assert_eq!(first[0].model_name(), "crm_eu__search_54d2a42a");
        assert_eq!(first[1].model_name(), "crm_us__search");
    }

    #[test]
    fn a_call_is_dispatched_to_the_server_its_name_names() {
        let mut tools = vec![
            tool("crm_eu", "search"),
            tool("crm_us", "search"),
            tool("crm_us", "get_record"),
        ];
        assign_model_names(&mut tools, &[]);
        let by_name = by_model_name(tools);
        assert_eq!(by_name.len(), 3);
        let us = &by_name["crm_us__search"];
        assert_eq!(
            (us.server_id.as_str(), &*us.tool.name),
            ("crm_us", "search")
        );
        let eu = &by_name["crm_eu__search"];
        assert_eq!(
            (eu.server_id.as_str(), &*eu.tool.name),
            ("crm_eu", "search")
        );
        assert_eq!(by_name["get_record"].server_id, "crm_us");
        assert!(!by_name.contains_key("search"));
    }

    #[test]
    fn the_model_is_offered_each_tool_once_under_its_model_name() {
        let mut tools = vec![
            tool("crm_eu", "search"),
            tool("crm_us", "search"),
            tool("crm_us", "get_record"),
        ];
        assign_model_names(&mut tools, &[]);
        let offered: Vec<String> =
            crate::services::mcp_manager::convert_mcp_tools_to_genai_tools(tools, false)
                .iter()
                .map(|tool| tool.name.to_string())
                .collect();
        assert_eq!(offered, ["crm_eu__search", "crm_us__search", "get_record"]);
    }

    /// The mock MCP server in process, recording each `tools/call` as its path
    /// and the tool name it was asked for.
    async fn serve_mock() -> (String, Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
        use serde_json::Value;
        let calls = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = calls.clone();
        let app = mock_mcp_server::app().layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let seen = seen.clone();
                async move {
                    let (parts, body) = request.into_parts();
                    let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
                    if let Ok(message) = serde_json::from_slice::<Value>(&bytes)
                        && message["method"] == "tools/call"
                    {
                        let name = message["params"]["name"].as_str().unwrap_or_default();
                        seen.lock()
                            .unwrap()
                            .push(format!("{} {name}", parts.uri.path()));
                    }
                    next.run(axum::extract::Request::from_parts(parts, bytes.into()))
                        .await
                }
            },
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let mock = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, calls, mock)
    }

    /// Servers at the mock's `paths`, configured in the order given.
    fn mock_servers(
        url: &str,
        servers: &[(&str, &str)],
    ) -> crate::services::mcp_manager::McpServers {
        let mut config = crate::config::AppConfig::default();
        for (server_id, path) in servers {
            let server = serde_json::from_value(serde_json::json!({
                "transport_type": "streamable_http",
                "url": format!("{url}{path}"),
            }))
            .unwrap();
            config.mcp_servers.insert(server_id.to_string(), server);
        }
        crate::services::mcp_manager::McpServers::new(&config)
    }

    /// Two servers with the same tools: each call, routed through the map the
    /// stream dispatches by, reaches the server its qualified name names, and
    /// the server is asked for its own tool name.
    #[tokio::test]
    async fn a_qualified_call_reaches_its_own_server_under_the_bare_name() {
        use crate::services::mcp_manager::{
            McpRequestAuthContext, convert_mcp_tools_to_genai_tools,
            convert_tool_call_to_managed_tool_call,
        };
        use serde_json::json;

        let (url, calls, mock) = serve_mock().await;
        // Both serve `list_files` and `read_file`; only the second one fails.
        let servers = mock_servers(
            &url,
            &[("files", "/mcp/file"), ("broken_files", "/mcp/error")],
        );
        let auth = McpRequestAuthContext::default();
        let chat = sea_orm::prelude::Uuid::new_v4();

        let mut tools = servers.list_tools(chat, &auth).await.unwrap();
        let collisions = assign_model_names(&mut tools, &builtin_tool_names());
        assert_eq!(
            collisions
                .iter()
                .map(|collision| collision.tool_name.as_str())
                .collect::<Vec<_>>(),
            ["list_files", "read_file"]
        );
        // The same named set is offered and dispatched by.
        let offered_to_model: Vec<String> = convert_mcp_tools_to_genai_tools(tools.clone(), false)
            .iter()
            .map(|tool| tool.name.to_string())
            .collect();
        assert_eq!(
            offered_to_model,
            [
                "broken_files__list_files",
                "broken_files__read_file",
                "files__list_files",
                "files__read_file"
            ]
        );
        let offered = by_model_name(tools);
        let mut keys: Vec<&str> = offered.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, offered_to_model);

        let call = |name: &str| genai::chat::ToolCall {
            call_id: format!("call-{name}"),
            fn_name: name.to_string(),
            fn_arguments: json!({"path": "docs/readme.txt"}),
            thought_signatures: None,
        };
        let read =
            convert_tool_call_to_managed_tool_call(&offered, call("files__read_file")).unwrap();
        assert_eq!(read.server_id, "files");
        let result = servers.call_tool(chat, read, &auth).await.unwrap();
        assert!(
            format!("{result:?}").contains("This is a mock README file."),
            "{result:?}"
        );

        let broken =
            convert_tool_call_to_managed_tool_call(&offered, call("broken_files__read_file"))
                .unwrap();
        assert_eq!(broken.server_id, "broken_files");
        let outcome = match servers.call_tool(chat, broken, &auth).await {
            Ok(result) => format!("{result:?}"),
            Err(error) => format!("{error:?}"),
        };
        assert!(outcome.contains("Simulated read_file error"), "{outcome}");

        assert!(
            convert_tool_call_to_managed_tool_call(&offered, call("read_file")).is_err(),
            "the bare name is no longer offered, so it routes nowhere"
        );
        assert_eq!(
            *calls.lock().unwrap(),
            ["/mcp/file read_file", "/mcp/error read_file"]
        );
        mock.abort();
    }

    /// Discovery visits the servers in sorted order, so the tools reach the
    /// model in the same order whichever order the configuration map holds
    /// them in, and so after a restart.
    #[tokio::test]
    async fn tools_reach_the_model_in_the_same_order_whatever_the_configuration_order() {
        use crate::services::mcp_manager::{
            McpRequestAuthContext, convert_mcp_tools_to_genai_tools,
        };
        let (url, _calls, mock) = serve_mock().await;
        let ids = [
            "files_f", "files_b", "files_d", "files_a", "files_e", "files_c",
        ];
        let mut offers = Vec::new();
        for order in [ids.to_vec(), ids.iter().rev().copied().collect()] {
            let servers: Vec<(&str, &str)> = order.iter().map(|id| (*id, "/mcp/file")).collect();
            let servers = mock_servers(&url, &servers);
            let mut tools = servers
                .list_tools(
                    sea_orm::prelude::Uuid::new_v4(),
                    &McpRequestAuthContext::default(),
                )
                .await
                .unwrap();
            assign_model_names(&mut tools, &[]);
            offers.push(
                convert_mcp_tools_to_genai_tools(tools, false)
                    .iter()
                    .map(|tool| tool.name.to_string())
                    .collect::<Vec<_>>(),
            );
        }
        let mut sorted = offers[0].clone();
        sorted.sort();
        assert_eq!(offers[0].len(), 12);
        assert_eq!(offers[0], sorted, "servers in sorted order");
        assert_eq!(offers[0], offers[1]);
        mock.abort();
    }

    #[test]
    fn a_second_assignment_clears_names_that_no_longer_collide() {
        let mut tools = vec![tool("a", "search"), tool("b", "search")];
        assign_model_names(&mut tools, &[]);
        assert_eq!(tools[0].model_name(), "a__search");
        tools.truncate(1);
        assert!(assign_model_names(&mut tools, &[]).is_empty());
        assert_eq!(tools[0].model_name(), "search");
    }
}
