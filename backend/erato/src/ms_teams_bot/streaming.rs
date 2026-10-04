//! Native personal-chat streaming with an editable reply for group/channel
//! conversations, interleaved tools, and turns exceeding Teams' stream limit.

use super::connector::{ActivityError, Connector};
use super::render::{self, MAX_MESSAGE_CHARS};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::time::Instant;

const MIN_UPDATE_INTERVAL: Duration = Duration::from_millis(1_500);
const MAX_STREAM_DURATION: Duration = Duration::from_secs(100);
const MAX_STATUS_BYTES: usize = 900;
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
pub const WORKING_STATUS: &str = "Working on your request…";

pub struct ReplyTarget<'a> {
    pub connector: &'a Connector,
    pub service_url: &'a str,
    pub conversation_id: &'a str,
    /// Set in group chats and channels: replies stay in the thread.
    pub reply_to_id: Option<&'a str>,
    pub mention: Option<render::Mention>,
}

impl ReplyTarget<'_> {
    pub async fn send(&self, activity: &Value) -> eyre::Result<Option<String>> {
        match self.reply_to_id {
            Some(reply_to_id) => {
                self.connector
                    .reply(
                        self.service_url,
                        self.conversation_id,
                        reply_to_id,
                        activity,
                    )
                    .await
            }
            None => {
                self.connector
                    .send(self.service_url, self.conversation_id, activity)
                    .await
            }
        }
    }

    pub async fn send_text(&self, text: &str) -> eyre::Result<()> {
        self.send_chunks(&render::split_for_teams(text, MAX_MESSAGE_CHARS), true)
            .await
    }

    async fn send_chunks(&self, chunks: &[String], mention_first: bool) -> eyre::Result<()> {
        for (index, chunk) in chunks.iter().enumerate() {
            let mention = if mention_first && index == 0 {
                self.mention.as_ref()
            } else {
                None
            };
            self.send(&render::message(chunk, mention)).await?;
        }
        Ok(())
    }

    /// Replace an activity the bot sent earlier in this conversation.
    pub async fn update(&self, activity_id: &str, mut activity: Value) -> eyre::Result<()> {
        activity["id"] = json!(activity_id);
        self.connector
            .update(
                self.service_url,
                self.conversation_id,
                activity_id,
                &activity,
            )
            .await
    }
}

enum Failure {
    /// The user stopped the native stream.
    Cancelled,
    /// Retry once `next_update` passes; never fall back to a new message.
    Throttled,
    Fatal,
}

#[derive(Clone, Copy)]
enum Op<'x> {
    Send(&'x Value),
    Write(&'x str),
}

enum Outcome {
    Sent,
    Cancelled,
    Throttled,
    Failed(eyre::Report),
}

pub struct StreamingReply<'a> {
    target: &'a ReplyTarget<'a>,
    native: bool,
    stream_id: Option<String>,
    message_id: Option<String>,
    sequence: u32,
    next_update: Instant,
    next_typing: Instant,
    next_native_heartbeat: Instant,
    started: Option<Instant>,
    /// Exactly what Teams accepted, used to preserve the cumulative prefix.
    streamed_text: String,
    text: String,
    status: Option<String>,
    rendered: Option<String>,
    cancelled: bool,
    /// Without an activity ID, avoid posting a new message on every update.
    updates_disabled: bool,
}

impl<'a> StreamingReply<'a> {
    pub fn new(target: &'a ReplyTarget<'a>, native: bool) -> Self {
        Self {
            target,
            native,
            stream_id: None,
            message_id: None,
            sequence: 0,
            next_update: Instant::now(),
            next_typing: Instant::now(),
            next_native_heartbeat: Instant::now(),
            started: None,
            streamed_text: String::new(),
            text: String::new(),
            status: None,
            rendered: None,
            cancelled: false,
            updates_disabled: false,
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled
    }

    /// Teams owns the Stop button while an accepted native stream is open.
    pub fn native_stop_available(&self) -> bool {
        self.native && self.stream_id.is_some() && !self.cancelled
    }

    /// Before Erato accepts a generation, personal chats use typing instead
    /// of opening a second native stream if the previous turn is still busy.
    pub async fn preparing(&mut self, text: &str) {
        if !self.native {
            self.status = Some(short_status(text));
        }
        self.flush().await;
    }

    pub async fn informative(&mut self, text: &str) {
        self.status = Some(short_status(text));
        self.flush().await;
    }

    pub async fn update(&mut self, full_text: &str) {
        self.text = full_text.to_string();
        self.status = None;
        self.flush().await;
    }

    /// Flush the latest state on a timer too, including during silent tools.
    pub async fn flush(&mut self) {
        if self.cancelled || self.updates_disabled || Instant::now() < self.next_update {
            return;
        }
        if self.native && self.stream_id.is_none() && self.status.is_none() && self.text.is_empty()
        {
            if Instant::now() >= self.next_typing {
                self.next_typing = Instant::now() + Duration::from_secs(4);
                let _ = self.target.send(&render::typing()).await;
            }
            return;
        }
        if self.native && self.needs_editable() {
            self.close_native().await;
            return; // Closing is a request too; edit on the next tick.
        }
        let (kind, text) = if self.native {
            match &self.status {
                Some(status) => ("informative", status.clone()),
                None if !self.text.is_empty() => ("streaming", self.text.clone()),
                None => return,
            }
        } else {
            ("message", self.snapshot())
        };
        // Teams reports a user's Stop through the next streaming request.
        // Keep checking during silent tools, without opening another stream.
        if text.is_empty()
            || (self.rendered.as_deref() == Some(&text)
                && (!self.native || Instant::now() < self.next_native_heartbeat))
        {
            return;
        }
        self.next_update = Instant::now() + MIN_UPDATE_INTERVAL;
        if self.native {
            let activity = self.stream_activity(kind, &text);
            match self.target.send(&activity).await {
                Ok(id) => {
                    if self.stream_id.is_none() {
                        self.stream_id = id;
                        self.started = Some(Instant::now());
                        if self.stream_id.is_none() {
                            self.native = false;
                        }
                    }
                    self.sequence += 1;
                    self.next_native_heartbeat = Instant::now() + Duration::from_secs(4);
                    if kind == "streaming" {
                        self.streamed_text = text.clone();
                    }
                    self.rendered = Some(text);
                    tracing::debug!(
                        stream_type = kind,
                        sequence = self.sequence,
                        "Sent Teams streaming progress"
                    );
                }
                Err(error) => {
                    if let Failure::Fatal = self.handle_error(&error) {
                        if self.stream_id.is_none() {
                            self.native = false;
                        } else {
                            self.started = Some(Instant::now() - MAX_STREAM_DURATION);
                        }
                    }
                }
            }
        } else {
            match self.write_message(&text).await {
                Ok(()) => {
                    self.rendered = Some(text);
                    tracing::debug!("Updated Teams progress reply");
                }
                Err(error) => {
                    self.handle_error(&error);
                }
            }
        }
    }

    fn needs_editable(&self) -> bool {
        self.started
            .is_some_and(|start| start.elapsed() >= MAX_STREAM_DURATION)
            || self.text.chars().count() > MAX_MESSAGE_CHARS
            || !self.text.starts_with(&self.streamed_text)
            || (!self.streamed_text.is_empty() && self.status.is_some())
    }

    fn snapshot(&self) -> String {
        // Preview only the first chunk. Finish delivers every remaining chunk.
        let text: String = self
            .text
            .chars()
            .take(MAX_MESSAGE_CHARS - MAX_STATUS_BYTES - 64)
            .collect();
        match (&self.status, text.is_empty()) {
            (Some(status), true) => format!("**Working…**\n\n{status}"),
            (Some(status), false) => format!("**Working…**\n\n{status}\n\n{text}"),
            (None, true) => "**Working…**".to_string(),
            (None, false) => format!("**Working…**\n\n{text}"),
        }
    }

    fn stream_activity(&self, kind: &str, text: &str) -> Value {
        let mut info = json!({"type": "streaminfo", "streamType": kind});
        let mut channel_data = json!({"streamType": kind});
        if kind != "final" {
            info["streamSequence"] = json!(self.sequence + 1);
            channel_data["streamSequence"] = json!(self.sequence + 1);
        }
        if let Some(id) = &self.stream_id {
            info["streamId"] = json!(id);
            channel_data["streamId"] = json!(id);
        }
        json!({
            "type": if kind == "final" { "message" } else { "typing" },
            "textFormat": "markdown", "text": text,
            "entities": [info], "channelData": channel_data,
        })
    }

    /// Close before editing. A status must never replace answer text inside a
    /// native stream, where all response chunks must retain the previous text.
    async fn close_native(&mut self) {
        if self.stream_id.is_none() {
            self.native = false;
            self.rendered = None;
            return;
        }
        let text = if self.streamed_text.is_empty() {
            self.rendered.as_deref().unwrap_or(WORKING_STATUS)
        } else {
            &self.streamed_text
        };
        let activity = self.stream_activity("final", text);
        self.next_update = Instant::now() + MIN_UPDATE_INTERVAL;
        if let Err(error) = self.target.send(&activity).await
            && !matches!(self.handle_error(&error), Failure::Fatal)
        {
            return;
        }
        self.message_id = self.stream_id.take();
        self.native = false;
        self.rendered = None;
        tracing::debug!("Teams response switched from native streaming to message updates");
    }

    async fn write_message(&mut self, text: &str) -> eyre::Result<()> {
        let activity = render::message(text, self.target.mention.as_ref());
        match &self.message_id {
            Some(id) => self.target.update(id, activity).await,
            None => {
                self.message_id = self.target.send(&activity).await?;
                self.updates_disabled = self.message_id.is_none();
                Ok(())
            }
        }
    }

    fn handle_error(&mut self, error: &eyre::Report) -> Failure {
        if let Some(error) = error.downcast_ref::<ActivityError>() {
            if error.stream_cancelled() {
                tracing::debug!("Teams native stream stopped by user");
                self.cancelled = true;
                return Failure::Cancelled;
            }
            if error.status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                self.next_update = Instant::now()
                    + error
                        .retry_after
                        .unwrap_or(Duration::from_secs(2))
                        .max(MIN_UPDATE_INTERVAL);
                return Failure::Throttled;
            }
        }
        tracing::warn!(%error, "Teams progress update failed");
        Failure::Fatal
    }

    async fn wait_ready(&self) {
        tokio::time::sleep_until(self.next_update).await;
    }

    /// Final deliveries get up to three throttled attempts.
    async fn deliver(&mut self, op: Op<'_>) -> Outcome {
        for _ in 0..3 {
            self.wait_ready().await;
            self.next_update = Instant::now() + MIN_UPDATE_INTERVAL;
            let result = match op {
                Op::Send(activity) => self.target.send(activity).await.map(|_| ()),
                Op::Write(text) => self.write_message(text).await,
            };
            let Err(error) = result else {
                return Outcome::Sent;
            };
            match self.handle_error(&error) {
                Failure::Cancelled => return Outcome::Cancelled,
                Failure::Throttled => {}
                Failure::Fatal => return Outcome::Failed(error),
            }
        }
        Outcome::Throttled
    }

    /// Replace progress with final content, including errors and approvals.
    pub async fn finish(&mut self, final_text: &str) -> eyre::Result<()> {
        self.finish_with_details(final_text, "").await
    }

    /// Native Stop freezes the streamed answer in Teams; only our separate
    /// control card can show its terminal state. Custom cancellation can still
    /// settle an editable reply or a native stream which remains open.
    pub async fn finish_stopped(&mut self) -> eyre::Result<()> {
        if self.cancelled {
            return Ok(());
        }
        let text = if self.text.trim().is_empty() {
            "**Stopped.**".to_string()
        } else {
            format!("**Stopped.**\n\n{}", self.text)
        };
        self.finish(&text).await
    }

    pub async fn finish_with_details(
        &mut self,
        text: &str,
        earlier_text: &str,
    ) -> eyre::Result<()> {
        let (text, attachment) = render::answer_with_details(text, earlier_text);
        // Teams expands text + card into multiple activities and rejects a
        // PUT containing both. Settle the existing text reply first, then
        // post the optional disclosure as its own card-only activity.
        self.finish_activity(&text).await?;
        if !self.cancelled
            && let Some(attachment) = attachment
        {
            let summary = format!("{}: {}", render::EARLIER_STEPS, short_status(earlier_text));
            let activity = render::card_message(attachment, &summary);
            match self.deliver(Op::Send(&activity)).await {
                Outcome::Sent | Outcome::Cancelled => return Ok(()),
                Outcome::Throttled | Outcome::Failed(_) => {}
            }
            // A card failure must never resend the answer or leave progress
            // showing. Preserve the earlier text as a separate text message.
            self.wait_ready().await;
            self.target
                .send_text(&render::earlier_steps_markdown(earlier_text))
                .await?;
        }
        Ok(())
    }

    async fn finish_activity(&mut self, final_text: &str) -> eyre::Result<()> {
        if self.cancelled {
            return Ok(());
        }
        let chunks = render::split_for_teams(final_text, MAX_MESSAGE_CHARS);
        self.text = final_text.to_string();
        self.status = None;
        if self.stream_id.is_some() {
            for _ in 0..3 {
                self.wait_ready().await;
                if chunks[0].starts_with(&self.streamed_text) && !self.needs_editable() {
                    let activity = self.stream_activity("final", &chunks[0]);
                    self.next_update = Instant::now() + MIN_UPDATE_INTERVAL;
                    match self.target.send(&activity).await {
                        Ok(_) => {
                            self.message_id = self.stream_id.take();
                            self.native = false;
                            tracing::debug!("Finalized Teams answer");
                            return self.target.send_chunks(&chunks[1..], false).await;
                        }
                        Err(error) => match self.handle_error(&error) {
                            Failure::Cancelled => return Ok(()),
                            Failure::Throttled => continue,
                            Failure::Fatal => {
                                self.message_id = self.stream_id.take();
                                self.native = false;
                                break;
                            }
                        },
                    }
                } else {
                    self.close_native().await;
                    if self.cancelled {
                        return Ok(());
                    }
                    if self.stream_id.is_none() {
                        break;
                    }
                }
            }
            if self.stream_id.is_some() {
                return Err(eyre::eyre!(
                    "Teams stream remained throttled while finalizing"
                ));
            }
        }
        let editing = self.message_id.is_some();
        match self.deliver(Op::Write(&chunks[0])).await {
            Outcome::Sent => {
                tracing::debug!("Finalized Teams answer");
                return self.target.send_chunks(&chunks[1..], false).await;
            }
            Outcome::Cancelled => return Ok(()),
            // A failed edit falls back to a new message. A failed post may
            // still have been delivered; posting again could duplicate it.
            Outcome::Failed(error) if !editing => return Err(error),
            Outcome::Throttled | Outcome::Failed(_) => {}
        }
        self.wait_ready().await;
        self.target.send_text(final_text).await
    }
}

fn short_status(text: &str) -> String {
    let text = text.trim();
    if text.len() <= MAX_STATUS_BYTES {
        return text.to_string();
    }
    let mut end = MAX_STATUS_BYTES - '…'.len_utf8();
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &text[..end])
}

#[cfg(test)]
mod tests;
