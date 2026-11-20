//! The web's tool call cards, for surfaces that show Adaptive Cards (the Teams
//! bot). The cards are the web's own components, bundled by
//! `frontend/scripts/build-adaptive-cards.mjs`; this runs that bundle in an
//! embedded QuickJS on a thread of its own, so every surface says what the web
//! says. Any failure leaves the caller to show the card it had before.

use crate::models::message::{ToolDisplayMetadata, ToolUse};
use rquickjs::{Context, Function, Object, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

const BUNDLE: &str = include_str!("adaptive_cards/tool_call_cards.generated.js");

/// A render takes a few milliseconds; these bound a label that makes one run away.
const MEMORY_LIMIT_BYTES: usize = 64 * 1024 * 1024;
const JS_STACK_BYTES: usize = 2 * 1024 * 1024;
const THREAD_STACK_BYTES: usize = 16 * 1024 * 1024;
const RENDER_TIME_LIMIT: Duration = Duration::from_secs(2);
const WAIT_LIMIT: Duration = Duration::from_secs(5);
const QUEUE_LENGTH: usize = 32;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CardError {
    /// The renderer could not start, its queue is full, or it did not answer.
    Unavailable,
    TooLarge,
    TimedOut,
    Script(String),
    Decode(String),
}

impl std::fmt::Display for CardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CardError::Unavailable => write!(f, "card renderer unavailable"),
            CardError::TooLarge => write!(f, "card request too large"),
            CardError::TimedOut => write!(f, "card render timed out"),
            CardError::Script(message) => write!(f, "card render failed: {message}"),
            CardError::Decode(message) => write!(f, "card render returned bad data: {message}"),
        }
    }
}

/// Which card the web gives a call; `Legacy` means it has no label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardKind {
    Gist,
    Generic,
    Legacy,
}

/// How the web draws Allow once: filled, plain when the card asks the reader
/// to check something, and marked when it states a loss.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AllowOnceEmphasis {
    Filled,
    Plain,
    Loss,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalItemRequest<'a> {
    pub locale: &'a str,
    pub tool_name: &'a str,
    pub display: Option<&'a ToolDisplayMetadata>,
    pub input: &'a Value,
    pub server_id: &'a str,
    /// Prefixes the card's element ids, unique per item on one card.
    pub id_prefix: &'a str,
}

/// One approval as the web shows it, as Adaptive Card elements and words.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalItemCard {
    pub kind: CardKind,
    pub summary: String,
    pub referent: Vec<Value>,
    pub question: String,
    #[serde(default)]
    pub facts: Option<String>,
    pub emphasis: AllowOnceEmphasis,
    /// The "Technical details" toggle and the body it opens.
    pub details: Vec<Value>,
    pub allow_once: String,
    pub deny: String,
    pub locale: String,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultRowRequest<'a> {
    pub locale: &'a str,
    pub part: &'a ToolUse,
    pub id_prefix: &'a str,
}

/// A finished call as the web's trace row shows it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ResultRow {
    pub elements: Vec<Value>,
    pub locale: String,
    #[serde(default)]
    pub errors: Vec<String>,
}

pub async fn approval_item(
    request: &ApprovalItemRequest<'_>,
) -> Result<ApprovalItemCard, CardError> {
    render("approvalItem", request).await
}

pub async fn result_row(request: &ResultRowRequest<'_>) -> Result<ResultRow, CardError> {
    render("resultRow", request).await
}

async fn render<T: serde::de::DeserializeOwned>(
    function: &'static str,
    request: &impl Serialize,
) -> Result<T, CardError> {
    let request = serde_json::to_string(request).map_err(|e| CardError::Decode(e.to_string()))?;
    if request.len() > MAX_REQUEST_BYTES {
        return Err(CardError::TooLarge);
    }
    let worker = worker().ok_or(CardError::Unavailable)?;
    let (reply, answer) = oneshot::channel();
    worker
        .try_send(Job {
            function,
            request,
            reply,
        })
        .map_err(|_| CardError::Unavailable)?;
    let text = tokio::time::timeout(WAIT_LIMIT, answer)
        .await
        .map_err(|_| CardError::Unavailable)?
        .map_err(|_| CardError::Unavailable)??;
    serde_json::from_str(&text).map_err(|e| CardError::Decode(e.to_string()))
}

struct Job {
    function: &'static str,
    request: String,
    reply: oneshot::Sender<Result<String, CardError>>,
}

fn worker() -> Option<&'static SyncSender<Job>> {
    static WORKER: OnceLock<Option<SyncSender<Job>>> = OnceLock::new();
    WORKER
        .get_or_init(|| {
            let (sender, jobs) = sync_channel(QUEUE_LENGTH);
            std::thread::Builder::new()
                .name("adaptive-cards".into())
                .stack_size(THREAD_STACK_BYTES)
                .spawn(move || serve(jobs))
                .inspect_err(|error| tracing::warn!(%error, "Adaptive card renderer did not start"))
                .ok()
                .map(|_| sender)
        })
        .as_ref()
}

fn serve(jobs: Receiver<Job>) {
    let mut engine: Option<Engine> = None;
    for job in jobs {
        if engine.is_none() {
            engine = Engine::load()
                .inspect_err(|error| tracing::warn!(%error, "Adaptive card bundle did not load"))
                .ok();
        }
        let result = engine
            .as_ref()
            .map_or(Err(CardError::Unavailable), |engine| {
                engine.call(job.function, &job.request)
            });
        // A run that failed may have left the engine half way through a
        // render; the next one starts from a fresh load.
        if result.is_err() {
            engine = None;
        }
        let _ = job.reply.send(result);
    }
}

struct Engine {
    _runtime: Runtime,
    context: Context,
    deadline: Arc<Mutex<Option<Instant>>>,
}

impl Engine {
    fn load() -> Result<Self, CardError> {
        let runtime = Runtime::new().map_err(script_error)?;
        runtime.set_memory_limit(MEMORY_LIMIT_BYTES);
        runtime.set_max_stack_size(JS_STACK_BYTES);
        let deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let watched = deadline.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            watched
                .lock()
                .ok()
                .and_then(|deadline| *deadline)
                .is_some_and(|deadline| Instant::now() > deadline)
        })));
        let context = Context::full(&runtime).map_err(script_error)?;
        let engine = Self {
            _runtime: runtime,
            context,
            deadline,
        };
        engine.within_deadline(|ctx| ctx.eval::<(), _>(BUNDLE))?;
        Ok(engine)
    }

    fn call(&self, function: &str, request: &str) -> Result<String, CardError> {
        self.within_deadline(|ctx| {
            let api: Object = ctx.globals().get("EratoAdaptiveCards")?;
            let render: Function = api.get(function)?;
            render.call::<_, String>((request,))
        })
    }

    fn within_deadline<T>(
        &self,
        run: impl for<'js> FnOnce(rquickjs::Ctx<'js>) -> rquickjs::Result<T>,
    ) -> Result<T, CardError> {
        let started = Instant::now();
        self.set_deadline(Some(started + RENDER_TIME_LIMIT));
        let result = self.context.with(|ctx| {
            run(ctx.clone()).map_err(|error| match error {
                rquickjs::Error::Exception => exception_text(&ctx),
                error => error.to_string(),
            })
        });
        self.set_deadline(None);
        result.map_err(|message| {
            if started.elapsed() >= RENDER_TIME_LIMIT {
                CardError::TimedOut
            } else {
                CardError::Script(message)
            }
        })
    }

    fn set_deadline(&self, deadline: Option<Instant>) {
        if let Ok(mut current) = self.deadline.lock() {
            *current = deadline;
        }
    }
}

fn exception_text(ctx: &rquickjs::Ctx<'_>) -> String {
    let caught = ctx.catch();
    caught
        .as_exception()
        .map(|exception| {
            format!(
                "{}{}",
                exception.message().unwrap_or_default(),
                exception
                    .stack()
                    .map(|stack| format!("\n{stack}"))
                    .unwrap_or_default()
            )
        })
        .unwrap_or_else(|| format!("{caught:?}"))
}

fn script_error(error: rquickjs::Error) -> CardError {
    CardError::Script(error.to_string())
}

#[cfg(test)]
mod tests;
