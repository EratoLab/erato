//! Teams' streaming protocol for personal chats: a first `typing` activity
//! with a `streaminfo` entity opens a stream, later ones replace its text, and
//! a final `message` closes it.
//!
//! Teams allows about one update per second and two minutes per stream, and
//! streaming only in personal chats. Any failure, and every other scope,
//! degrades to a plain message at the end.

use super::connector::Connector;
use super::render::{self, MAX_MESSAGE_CHARS};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const MIN_UPDATE_INTERVAL: Duration = Duration::from_millis(1_500);
const MAX_STREAM_DURATION: Duration = Duration::from_secs(100);

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

    /// Send a (possibly long) markdown answer as one or more messages.
    pub async fn send_text(&self, text: &str) -> eyre::Result<()> {
        for (index, chunk) in render::split_for_teams(text, MAX_MESSAGE_CHARS)
            .iter()
            .enumerate()
        {
            let mention = if index == 0 {
                self.mention.as_ref()
            } else {
                None
            };
            self.send(&render::message(chunk, mention)).await?;
        }
        Ok(())
    }
}

pub struct StreamingReply<'a> {
    target: &'a ReplyTarget<'a>,
    enabled: bool,
    stream_id: Option<String>,
    sequence: u32,
    last_update: Option<Instant>,
    started: Instant,
    sent_chars: usize,
}

impl<'a> StreamingReply<'a> {
    pub fn new(target: &'a ReplyTarget<'a>, enabled: bool) -> Self {
        Self {
            target,
            enabled,
            stream_id: None,
            sequence: 0,
            last_update: None,
            started: Instant::now(),
            sent_chars: 0,
        }
    }

    /// A status line shown before text arrives ("Searching…").
    pub async fn informative(&mut self, text: &str) {
        if self.enabled && self.sent_chars == 0 {
            self.push("informative", text).await;
        }
    }

    /// The full answer so far; sent only when it grew and the throttle allows.
    pub async fn update(&mut self, full_text: &str) {
        if !self.enabled || full_text.chars().count() <= self.sent_chars {
            return;
        }
        if full_text.chars().count() > MAX_MESSAGE_CHARS
            || self.started.elapsed() > MAX_STREAM_DURATION
        {
            // Long answers and slow turns finish as regular messages.
            self.enabled = false;
            return;
        }
        if self
            .last_update
            .is_some_and(|last| last.elapsed() < MIN_UPDATE_INTERVAL)
        {
            return;
        }
        self.push("streaming", full_text).await;
        if self.enabled {
            self.sent_chars = full_text.chars().count();
        }
    }

    /// Close the stream with the final answer, or send it plainly.
    ///
    /// An open stream is always closed, even after updates stopped (long or
    /// slow answer), so Teams never keeps a stale partial message: it gets the
    /// first chunk and the rest follows as regular messages.
    pub async fn finish(mut self, final_text: &str) -> eyre::Result<()> {
        if let Some(stream_id) = self.stream_id.take() {
            let chunks = render::split_for_teams(final_text, MAX_MESSAGE_CHARS);
            let mut activity = render::message(&chunks[0], None);
            activity["entities"] = json!([{
                "type": "streaminfo",
                "streamId": stream_id,
                "streamType": "final",
            }]);
            activity["channelData"] = json!({"streamType": "final", "streamId": stream_id});
            match self.target.send(&activity).await {
                Ok(_) => {
                    for chunk in &chunks[1..] {
                        self.target.send(&render::message(chunk, None)).await?;
                    }
                    return Ok(());
                }
                Err(error) => {
                    tracing::warn!(%error, "Closing the Teams stream failed; sending plainly");
                }
            }
        }
        self.target.send_text(final_text).await
    }

    async fn push(&mut self, stream_type: &str, text: &str) {
        self.sequence += 1;
        let mut info = json!({
            "type": "streaminfo",
            "streamType": stream_type,
            "streamSequence": self.sequence,
        });
        let mut channel_data = json!({
            "streamType": stream_type,
            "streamSequence": self.sequence,
        });
        if let Some(stream_id) = &self.stream_id {
            info["streamId"] = json!(stream_id);
            channel_data["streamId"] = json!(stream_id);
        }
        let activity = json!({
            "type": "typing",
            "text": text,
            "entities": [info],
            "channelData": channel_data,
        });
        match self.target.send(&activity).await {
            Ok(id) => {
                if self.stream_id.is_none() {
                    self.stream_id = id;
                    if self.stream_id.is_none() {
                        self.enabled = false;
                    }
                }
                self.last_update = Some(Instant::now());
            }
            Err(error) => {
                tracing::warn!(%error, "Teams streaming update failed; finishing without streaming");
                self.enabled = false;
            }
        }
    }
}
