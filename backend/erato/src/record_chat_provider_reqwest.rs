use chrono::Utc;
use erato::config::{AppConfig, ChatProviderConfig};
use erato::services::genai::build_chat_options_for_completion;
use erato::state::AppState;
use eyre::{Context, Report, eyre};
use genai::chat::{ChatMessage, ChatRequest, ChatStreamEvent};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio_stream::StreamExt as _;
use tracing::field::{Field, Visit};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::Context as LayerContext;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Layer, Registry};

const DEFAULT_OUTPUT_DIR: &str = "reqwest-recordings";

fn main() -> Result<(), Report> {
    color_eyre::install()?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .wrap_err("Failed to build Tokio runtime")?;

    runtime.block_on(async_main())
}

async fn async_main() -> Result<(), Report> {
    dotenv_flow::dotenv_flow().ok();

    let config = AppConfig::new_for_app(None).map_err(|err| eyre!(err))?;
    let args = match Args::parse() {
        Ok(args) => args,
        Err(err) if err.to_string().starts_with("Usage:") => {
            eprintln!("{}", usage_with_providers(&config));
            std::process::exit(2);
        }
        Err(err) => return Err(err),
    };
    let scenario = Scenario::get(&args.scenario_id)?;
    let provider_config = config.get_chat_provider(&args.provider_id).clone();

    let recorder = ReqwestTraceRecorder::new(
        args.output_dir.clone(),
        RecordingMetadata {
            chat_provider_id: args.provider_id.clone(),
            provider_kind: provider_config.provider_kind.clone(),
            model_name: provider_config.model_name.clone(),
            scenario_id: scenario.id.to_string(),
            scenario_description: scenario.description.to_string(),
            recorded_at: Utc::now().to_rfc3339(),
        },
    );
    init_recording_tracing(recorder.clone())?;

    let chat_request = build_chat_request(&provider_config, scenario);
    let chat_options = build_chat_options_for_completion(
        &provider_config.model_settings,
        &provider_config.model_capabilities,
    );
    let client = AppState::build_genai_client(provider_config)?;

    let mut stream = client
        .exec_chat_stream("PLACEHOLDER_MODEL", chat_request, Some(&chat_options))
        .await
        .wrap_err("Failed to start chat provider stream")?
        .stream;

    while let Some(event) = stream.next().await {
        match event.wrap_err("Failed while reading chat provider stream")? {
            ChatStreamEvent::End(_) => break,
            ChatStreamEvent::Chunk(_)
            | ChatStreamEvent::Start
            | ChatStreamEvent::ToolCallChunk(_)
            | ChatStreamEvent::ReasoningChunk(_)
            | ChatStreamEvent::ThoughtSignatureChunk(_) => {}
        }
    }

    let files = recorder.persist()?;
    for file in files {
        println!("wrote {}", file.display());
    }

    Ok(())
}

#[derive(Debug)]
struct Args {
    provider_id: String,
    scenario_id: String,
    output_dir: PathBuf,
}

impl Args {
    fn parse() -> Result<Self, Report> {
        let mut args = std::env::args().skip(1);
        let provider_id = args.next().ok_or_else(usage_error)?;
        let scenario_id = args.next().ok_or_else(usage_error)?;
        let output_dir = args
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(default_output_dir);
        if args.next().is_some() {
            return Err(usage_error());
        }
        Ok(Self {
            provider_id,
            scenario_id,
            output_dir,
        })
    }
}

fn default_output_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DEFAULT_OUTPUT_DIR)
}

fn usage_error() -> Report {
    eyre!("Usage: record-chat-provider-reqwest <chat-provider-id> <scenario-id> [output-dir]")
}

fn usage_with_providers(config: &AppConfig) -> String {
    let providers = config.available_chat_providers(None);
    let providers = if providers.is_empty() {
        "(none configured)".to_string()
    } else {
        providers.join(", ")
    };
    let scenarios = Scenario::all()
        .iter()
        .map(|scenario| scenario.id)
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "Usage: record-chat-provider-reqwest <chat-provider-id> <scenario-id> [output-dir]\nAvailable chat providers: {}\nAvailable scenarios: {}",
        providers, scenarios
    )
}

#[derive(Debug, Clone, Copy)]
struct Scenario {
    id: &'static str,
    description: &'static str,
    user_message: &'static str,
}

impl Scenario {
    fn all() -> &'static [Self] {
        &[
            Self {
                id: "simple",
                description: "A short factual user request.",
                user_message: "Reply with exactly one short sentence about why deterministic test fixtures are useful.",
            },
            Self {
                id: "markdown",
                description: "A request that asks for structured markdown.",
                user_message: "Return a markdown bullet list with three concise tips for keeping API mocks maintainable.",
            },
            Self {
                id: "code",
                description: "A request that asks for a small code block.",
                user_message: "Return a tiny Rust function named add_one that increments an i32.",
            },
            Self {
                id: "reasoning",
                description: "A multi-constraint logic task intended to exercise reasoning-capable providers.",
                user_message: "Solve this carefully, but return only the final answer and one concise justification. A five-digit lock code uses the digits 1, 2, 3, 4, and 5 exactly once. The first digit is not 1 or 5. The second digit is greater than the fourth digit. The third digit is exactly the sum of the first and fifth digits. The fourth digit is odd. The fifth digit is smaller than the first digit. What is the code?",
            },
        ]
    }

    fn get(id: &str) -> Result<&'static Self, Report> {
        Self::all()
            .iter()
            .find(|scenario| scenario.id == id)
            .ok_or_else(|| {
                let scenarios = Self::all()
                    .iter()
                    .map(|scenario| scenario.id)
                    .collect::<Vec<_>>()
                    .join(", ");
                eyre!(
                    "Unknown scenario '{}'. Available scenarios: {}",
                    id,
                    scenarios
                )
            })
    }
}

fn build_chat_request(provider_config: &ChatProviderConfig, scenario: &Scenario) -> ChatRequest {
    let mut messages = Vec::new();
    if let Some(system_prompt) = provider_config
        .system_prompt
        .as_ref()
        .and_then(|prompt| prompt.static_content())
    {
        messages.push(ChatMessage::system(system_prompt));
    }
    messages.push(ChatMessage::user(scenario.user_message));

    let mut request = ChatRequest {
        messages,
        ..Default::default()
    };
    if matches!(
        provider_config.provider_kind.as_str(),
        "openai_responses" | "azure_openai_responses"
    ) {
        request = request.with_store(false);
    }
    request
}

fn init_recording_tracing(recorder: ReqwestTraceRecorder) -> Result<(), Report> {
    let filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .parse("info,reqwest::connect=trace")?;
    Registry::default()
        .with(filter)
        .with(recorder)
        .with(tracing_subscriber::fmt::layer())
        .init();
    Ok(())
}

#[derive(Clone)]
struct ReqwestTraceRecorder {
    output_dir: PathBuf,
    metadata: RecordingMetadata,
    state: Arc<Mutex<RecorderState>>,
}

impl ReqwestTraceRecorder {
    fn new(output_dir: PathBuf, metadata: RecordingMetadata) -> Self {
        Self {
            output_dir,
            metadata,
            state: Arc::new(Mutex::new(RecorderState::default())),
        }
    }

    fn persist(&self) -> Result<Vec<PathBuf>, Report> {
        fs::create_dir_all(&self.output_dir)
            .wrap_err_with(|| format!("Failed to create {}", self.output_dir.display()))?;

        let state = self
            .state
            .lock()
            .map_err(|_| eyre!("Reqwest recorder state was poisoned"))?;

        let mut written = Vec::new();
        for (index, (connection_id, trace)) in state
            .connections
            .iter()
            .filter(|(_, trace)| !trace.write.is_empty() || !trace.read.is_empty())
            .enumerate()
        {
            let recording = HttpInteractionRecording::from_trace(
                self.metadata.clone(),
                index,
                connection_id.clone(),
                trace,
            );
            let file_name = format!(
                "{}-{}-{}-{}.json",
                sanitize_path_segment(&self.metadata.chat_provider_id),
                sanitize_path_segment(&self.metadata.scenario_id),
                index + 1,
                connection_id
            );
            let path = self.output_dir.join(file_name);
            let json = serde_json::to_string_pretty(&recording)?;
            fs::write(&path, json)
                .wrap_err_with(|| format!("Failed to write {}", path.display()))?;
            written.push(path);
        }

        if written.is_empty() {
            return Err(eyre!(
                "No reqwest wire events were recorded. Ensure reqwest connection_verbose logs are emitted."
            ));
        }

        Ok(written)
    }
}

impl<S> Layer<S> for ReqwestTraceRecorder
where
    S: tracing::Subscriber,
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: LayerContext<'_, S>) {
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let event_target = visitor
            .log_target
            .as_deref()
            .unwrap_or_else(|| event.metadata().target());
        if !event_target.starts_with("reqwest::connect") {
            return;
        }
        let Some(message) = visitor.message else {
            return;
        };
        let Some((connection_id, direction, bytes)) = parse_reqwest_verbose_message(&message)
        else {
            return;
        };

        if let Ok(mut state) = self.state.lock() {
            let trace = state.connections.entry(connection_id).or_default();
            match direction {
                Direction::Read => trace.read.extend(bytes),
                Direction::Write => trace.write.extend(bytes),
            }
        }
    }
}

#[derive(Debug, Default)]
struct MessageVisitor {
    message: Option<String>,
    log_target: Option<String>,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let value = unquote_debug_value(&format!("{value:?}"));
        match field.name() {
            "message" => self.message = Some(value),
            "log.target" => self.log_target = Some(value),
            _ => {}
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        match field.name() {
            "message" => self.message = Some(value.to_string()),
            "log.target" => self.log_target = Some(value.to_string()),
            _ => {}
        }
    }
}

fn unquote_debug_value(value: &str) -> String {
    serde_json::from_str::<String>(value).unwrap_or_else(|_| value.to_string())
}

#[derive(Default)]
struct RecorderState {
    connections: HashMap<String, WireTrace>,
}

#[derive(Default)]
struct WireTrace {
    write: Vec<u8>,
    read: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
enum Direction {
    Read,
    Write,
}

fn parse_reqwest_verbose_message(message: &str) -> Option<(String, Direction, Vec<u8>)> {
    let (connection_id, rest) = message.split_once(' ')?;
    if connection_id.len() != 8 || !connection_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }

    let (direction, payload) = if let Some(payload) = rest.strip_prefix("read: ") {
        (Direction::Read, payload)
    } else if let Some(payload) = rest.strip_prefix("write: ") {
        (Direction::Write, payload)
    } else if let Some(payload) = rest.strip_prefix("write (vectored): ") {
        (Direction::Write, payload)
    } else {
        return None;
    };

    let bytes = parse_debug_byte_strings(payload)?;
    Some((connection_id.to_string(), direction, bytes))
}

fn parse_debug_byte_strings(input: &str) -> Option<Vec<u8>> {
    let mut remaining = input.trim();
    let mut bytes = Vec::new();

    while !remaining.is_empty() {
        let payload_start = remaining.strip_prefix("b\"")?;
        let closing_quote_index = find_unescaped_closing_quote(payload_start)?;
        let (payload, rest) = payload_start.split_at(closing_quote_index);
        bytes.extend(parse_escaped_bytes(payload)?);
        remaining = rest.strip_prefix('"')?.trim_start();
    }

    Some(bytes)
}

fn find_unescaped_closing_quote(input: &str) -> Option<usize> {
    let mut escaped = false;
    for (index, ch) in input.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' => return Some(index),
            _ => {}
        }
    }
    None
}

fn parse_escaped_bytes(payload: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(payload.len());
    let mut chars = payload.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            bytes.push(ch as u8);
            continue;
        }

        match chars.next()? {
            'n' => bytes.push(b'\n'),
            'r' => bytes.push(b'\r'),
            't' => bytes.push(b'\t'),
            '\\' => bytes.push(b'\\'),
            '"' => bytes.push(b'"'),
            '0' => bytes.push(0),
            'x' => {
                let high = chars.next()?.to_digit(16)?;
                let low = chars.next()?.to_digit(16)?;
                bytes.push(((high << 4) | low) as u8);
            }
            other => bytes.push(other as u8),
        }
    }
    Some(bytes)
}

#[derive(Debug, Clone, Serialize)]
struct RecordingMetadata {
    chat_provider_id: String,
    provider_kind: String,
    model_name: String,
    scenario_id: String,
    scenario_description: String,
    recorded_at: String,
}

#[derive(Serialize)]
struct HttpInteractionRecording {
    metadata: RecordingMetadata,
    connection_id: String,
    interaction_index: usize,
    request: ParsedHttpMessage,
    response: ParsedHttpMessage,
}

impl HttpInteractionRecording {
    fn from_trace(
        metadata: RecordingMetadata,
        interaction_index: usize,
        connection_id: String,
        trace: &WireTrace,
    ) -> Self {
        Self {
            metadata,
            connection_id,
            interaction_index,
            request: ParsedHttpMessage::parse_request(&trace.write),
            response: ParsedHttpMessage::parse_response(&trace.read),
        }
    }
}

#[derive(Serialize)]
struct ParsedHttpMessage {
    raw: String,
    start_line: Option<String>,
    method: Option<String>,
    path: Option<String>,
    status: Option<u16>,
    headers: Vec<(String, String)>,
    body: String,
    body_json: Option<Value>,
    sse_data: Vec<Value>,
}

impl ParsedHttpMessage {
    fn parse_request(bytes: &[u8]) -> Self {
        let raw = String::from_utf8_lossy(bytes).to_string();
        let (head, body) = split_http_message(bytes);
        let start_line = first_line(head);
        let (method, path) = start_line.as_deref().map_or((None, None), |line| {
            let mut parts = line.split_whitespace();
            (
                parts.next().map(ToString::to_string),
                parts.next().map(ToString::to_string),
            )
        });
        let headers = parse_headers(head);
        let body = String::from_utf8_lossy(body).to_string();
        let body_json = serde_json::from_str(&body).ok();

        Self {
            raw,
            start_line,
            method,
            path,
            status: None,
            headers,
            sse_data: Vec::new(),
            body,
            body_json,
        }
    }

    fn parse_response(bytes: &[u8]) -> Self {
        let raw = String::from_utf8_lossy(bytes).to_string();
        let (head, body) = split_http_message(bytes);
        let start_line = first_line(head);
        let status = start_line
            .as_deref()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|status| status.parse::<u16>().ok());
        let headers = parse_headers(head);
        let decoded_body = if has_chunked_transfer_encoding(&headers) {
            decode_chunked_body(body).unwrap_or_else(|| body.to_vec())
        } else {
            body.to_vec()
        };
        let body = String::from_utf8_lossy(&decoded_body).to_string();
        let body_json = serde_json::from_str(&body).ok();
        let sse_data = parse_sse_data(&body);

        Self {
            raw,
            start_line,
            method: None,
            path: None,
            status,
            headers,
            body,
            body_json,
            sse_data,
        }
    }
}

fn split_http_message(bytes: &[u8]) -> (&[u8], &[u8]) {
    if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
        bytes.split_at(index + 4)
    } else {
        (bytes, &[])
    }
}

fn first_line(head: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(head);
    head.lines().next().map(ToString::to_string)
}

fn parse_headers(head: &[u8]) -> Vec<(String, String)> {
    String::from_utf8_lossy(head)
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

fn has_chunked_transfer_encoding(headers: &[(String, String)]) -> bool {
    headers.iter().any(|(key, value)| {
        key.eq_ignore_ascii_case("transfer-encoding")
            && value
                .split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("chunked"))
    })
}

fn decode_chunked_body(mut body: &[u8]) -> Option<Vec<u8>> {
    let mut decoded = Vec::new();
    loop {
        let line_end = body.windows(2).position(|window| window == b"\r\n")?;
        let size_line = std::str::from_utf8(&body[..line_end]).ok()?;
        let size_hex = size_line.split(';').next()?.trim();
        let size = usize::from_str_radix(size_hex, 16).ok()?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Some(decoded);
        }
        if body.len() < size + 2 {
            return None;
        }
        decoded.extend_from_slice(&body[..size]);
        body = &body[size + 2..];
    }
}

fn parse_sse_data(body: &str) -> Vec<Value> {
    body.split("\n\n")
        .flat_map(|event| event.lines())
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .filter(|data| !data.is_empty() && *data != "[DONE]")
        .filter_map(|data| serde_json::from_str(data).ok())
        .collect()
}

fn sanitize_path_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}
