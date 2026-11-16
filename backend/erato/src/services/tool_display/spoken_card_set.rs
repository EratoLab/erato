//! The calls the spoken approval card is written and heard against, labelled
//! here exactly as a chat labels them. The frontend composes its spoken cards
//! from the generated file, so a change to the labels shows up there.
//!
//! Regenerate with `SPOKEN_CARD_SET_WRITE=1 cargo nextest run -p erato spoken_card_set`.

use super::*;
use crate::models::message::{
    ContentPart, GenerationInputMessages, MessageRole, ToolCallStatus, ToolUse,
};
use crate::services::prompt_composition::transforms::replay_assistant_content;
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::{Value, json};
use std::collections::BTreeMap;

const INPUT: &str = include_str!("spoken_card_set.json");
const OUTPUT_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../frontend/src/lib/toolCallGist/fixtures/spokenCardSet.json"
);

#[derive(serde::Deserialize)]
struct Set {
    servers: BTreeMap<String, Value>,
    history: BTreeMap<String, Vec<Step>>,
    calls: Vec<Call>,
}

#[derive(serde::Deserialize)]
struct Step {
    tool_name: String,
    input: Value,
    output: Value,
}

#[derive(serde::Deserialize)]
struct Call {
    id: String,
    group: String,
    server: String,
    tool: String,
    #[serde(default)]
    description: String,
    annotations: Value,
    arguments: Value,
}

fn runtime_config(servers: &BTreeMap<String, Value>) -> McpRuntimeConfig {
    let mut config = McpRuntimeConfig::default();
    for (id, server) in servers {
        let mut server = server.clone();
        server["transport_type"] = json!("streamable_http");
        server["url"] = json!(format!("https://{id}.example/mcp"));
        config
            .mcp_servers
            .insert(id.clone(), serde_json::from_value(server).unwrap());
    }
    config
}

/// What a chat on `server` had read before the call: the results of `steps`.
fn context(config: &McpRuntimeConfig, server: &str, steps: &[Step]) -> label::ToolResultContext {
    let messages = steps
        .iter()
        .enumerate()
        .flat_map(|(index, step)| {
            let tool = ToolUse {
                tool_call_id: format!("{server}-history-{index}"),
                status: ToolCallStatus::Success,
                tool_name: step.tool_name.clone(),
                display: Some(ToolDisplayMetadata {
                    title: step.tool_name.clone(),
                    description: None,
                    description_truncated: false,
                    server_name: Some(config.mcp_server_display_name(server)),
                    label: None,
                    read_only: false,
                }),
                input: Some(step.input.clone()),
                output: Some(step.output.clone()),
                ..Default::default()
            };
            replay_assistant_content(&MessageRole::Assistant, vec![ContentPart::ToolUse(tool)])
        })
        .collect();
    label::ToolResultContext::from_messages(&GenerationInputMessages { messages })
        .with_organization(Some("daniel@beispiel-industrie.de"), &[])
}

fn generated() -> Value {
    let set: Set = serde_json::from_str(INPUT).unwrap();
    let config = runtime_config(&set.servers);
    let calls: Vec<Value> = set
        .calls
        .iter()
        .map(|call| {
            let steps = set
                .history
                .get(&call.server)
                .map(Vec::as_slice)
                .unwrap_or_default();
            let mut tool = Tool::new(
                call.tool.clone(),
                call.description.clone(),
                JsonObject::new(),
            );
            tool.annotations = Some(serde_json::from_value::<ToolAnnotations>(
                call.annotations.clone(),
            ))
            .transpose()
            .unwrap();
            let display = mcp_tool_call_display(
                &config,
                &call.server,
                &tool,
                &call.arguments,
                None,
                &context(&config, &call.server, steps),
            );
            json!({
                "id": call.id,
                "group": call.group,
                "tool_name": call.tool,
                "server_id": call.server,
                "input": call.arguments,
                "display": display,
            })
        })
        .collect();
    json!({ "calls": calls })
}

#[test]
fn the_spoken_card_set_matches_its_labels() {
    let text = format!("{}\n", serde_json::to_string_pretty(&generated()).unwrap());
    if std::env::var_os("SPOKEN_CARD_SET_WRITE").is_some() {
        std::fs::write(OUTPUT_PATH, &text).unwrap();
        return;
    }
    let stored = std::fs::read_to_string(OUTPUT_PATH).unwrap_or_default();
    assert!(
        stored == text,
        "{OUTPUT_PATH} is out of date; regenerate it with SPOKEN_CARD_SET_WRITE=1"
    );
}
