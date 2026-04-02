mod client_side_sse;
mod http_header;

use std::{
    pin::Pin,
    sync::{Arc, RwLock},
};

use client_side_sse::{BoxedSseResponse, SseAutoReconnectStream, SseStreamReconnect};
use futures::{StreamExt, future::BoxFuture};
use http::Uri;
use reqwest::header::ACCEPT;
use rmcp::{
    RoleClient,
    model::ClientJsonRpcMessage,
    service::{RxJsonRpcMessage, TxJsonRpcMessage},
    transport::Transport,
};
use sse_stream::{Error as SseError, Sse, SseStream};
use thiserror::Error;

use crate::http_header::{EVENT_STREAM_MIME_TYPE, HEADER_LAST_EVENT_ID};
pub use client_side_sse::{ExponentialBackoff, FixedInterval, SseRetryPolicy};

#[derive(Error, Debug)]
pub enum SseTransportError<E: std::error::Error + Send + Sync + 'static> {
    #[error("SSE error: {0}")]
    Sse(#[from] SseError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Client error: {0}")]
    Client(E),
    #[error("unexpected end of stream")]
    UnexpectedEndOfStream,
    #[error("Unexpected content type: {0:?}")]
    UnexpectedContentType(Option<String>),
    #[error("Invalid uri: {0}")]
    InvalidUri(#[from] http::uri::InvalidUri),
    #[error("Invalid uri parts: {0}")]
    InvalidUriParts(#[from] http::uri::InvalidUriParts),
}

pub trait SseClient: Clone + Send + Sync + 'static {
    type Error: std::error::Error + Send + Sync + 'static;

    fn post_message(
        &self,
        uri: Uri,
        message: ClientJsonRpcMessage,
        auth_token: Option<String>,
    ) -> impl Future<Output = Result<(), SseTransportError<Self::Error>>> + Send + '_;

    fn get_stream(
        &self,
        uri: Uri,
        last_event_id: Option<String>,
        auth_token: Option<String>,
    ) -> impl Future<Output = Result<BoxedSseResponse, SseTransportError<Self::Error>>> + Send + '_;
}

struct SseClientReconnect<C> {
    client: C,
    uri: Uri,
    message_endpoint: Arc<RwLock<Uri>>,
}

impl<C: SseClient> SseStreamReconnect for SseClientReconnect<C> {
    type Error = SseTransportError<C::Error>;
    type Future = BoxFuture<'static, Result<BoxedSseResponse, Self::Error>>;

    fn retry_connection(&mut self, last_event_id: Option<&str>) -> Self::Future {
        let client = self.client.clone();
        let uri = self.uri.clone();
        let last_event_id = last_event_id.map(|id| id.to_owned());
        Box::pin(async move { client.get_stream(uri, last_event_id, None).await })
    }

    fn handle_control_event(&mut self, event: &Sse) -> Result<(), Self::Error> {
        if event.event.as_deref() != Some("endpoint") {
            return Ok(());
        }
        let Some(data) = event.data.as_ref() else {
            return Ok(());
        };

        let new_endpoint = message_endpoint(self.uri.clone(), data.clone())
            .map_err(SseTransportError::InvalidUri)?;
        *self
            .message_endpoint
            .write()
            .expect("message endpoint lock poisoned") = new_endpoint;
        Ok(())
    }

    fn handle_stream_error(
        &mut self,
        error: &(dyn std::error::Error + 'static),
        last_event_id: Option<&str>,
    ) {
        tracing::warn!(
            uri = %self.uri,
            last_event_id = last_event_id.unwrap_or(""),
            "sse stream error: {error}"
        );
    }
}

type ServerMessageStream<C> = Pin<Box<SseAutoReconnectStream<SseClientReconnect<C>>>>;

pub struct SseClientTransport<C: SseClient> {
    client: C,
    config: SseClientConfig,
    message_endpoint: Arc<RwLock<Uri>>,
    stream: Option<ServerMessageStream<C>>,
}

impl<C: SseClient> Transport<RoleClient> for SseClientTransport<C> {
    type Error = SseTransportError<C::Error>;

    async fn receive(&mut self) -> Option<RxJsonRpcMessage<RoleClient>> {
        self.stream.as_mut()?.next().await?.ok()
    }

    fn send(
        &mut self,
        item: TxJsonRpcMessage<RoleClient>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
        let client = self.client.clone();
        let message_endpoint = self.message_endpoint.clone();
        async move {
            let uri = {
                let guard = message_endpoint
                    .read()
                    .expect("message endpoint lock poisoned");
                guard.clone()
            };
            client.post_message(uri, item, None).await
        }
    }

    async fn close(&mut self) -> Result<(), Self::Error> {
        self.stream.take();
        Ok(())
    }
}

impl<C: SseClient + std::fmt::Debug> std::fmt::Debug for SseClientTransport<C> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SseClientTransport")
            .field("client", &self.client)
            .field("config", &self.config)
            .finish()
    }
}

impl<C: SseClient> SseClientTransport<C> {
    pub async fn start_with_client(
        client: C,
        config: SseClientConfig,
    ) -> Result<Self, SseTransportError<C::Error>> {
        let sse_endpoint = config.sse_endpoint.as_ref().parse::<Uri>()?;

        let mut sse_stream = client.get_stream(sse_endpoint.clone(), None, None).await?;
        let initial_message_endpoint = if let Some(endpoint) = config.use_message_endpoint.clone() {
            let endpoint_uri = endpoint.parse::<Uri>()?;
            let mut sse_endpoint_parts = sse_endpoint.clone().into_parts();
            sse_endpoint_parts.path_and_query = endpoint_uri.into_parts().path_and_query;
            Uri::from_parts(sse_endpoint_parts)?
        } else {
            loop {
                let sse = sse_stream
                    .next()
                    .await
                    .ok_or(SseTransportError::UnexpectedEndOfStream)??;
                let Some("endpoint") = sse.event.as_deref() else {
                    continue;
                };
                let endpoint = sse.data.unwrap_or_default();
                break message_endpoint(sse_endpoint.clone(), endpoint)?;
            }
        };

        let message_endpoint = Arc::new(RwLock::new(initial_message_endpoint));
        let stream = Box::pin(SseAutoReconnectStream::new(
            sse_stream,
            SseClientReconnect {
                client: client.clone(),
                uri: sse_endpoint.clone(),
                message_endpoint: message_endpoint.clone(),
            },
            config.retry_policy.clone(),
        ));

        Ok(Self {
            client,
            config,
            message_endpoint,
            stream: Some(stream),
        })
    }
}

fn message_endpoint(base: Uri, endpoint: String) -> Result<Uri, http::uri::InvalidUri> {
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        return endpoint.parse::<Uri>();
    }

    let mut base_parts = base.into_parts();
    let endpoint_clone = endpoint.clone();

    if endpoint.starts_with('?') {
        if let Some(base_path_and_query) = &base_parts.path_and_query {
            let base_path = base_path_and_query.path();
            base_parts.path_and_query = Some(format!("{base_path}{endpoint}").parse()?);
        } else {
            base_parts.path_and_query = Some(format!("/{endpoint}").parse()?);
        }
    } else {
        let path_to_use = if endpoint.starts_with('/') {
            endpoint
        } else {
            format!("/{endpoint}")
        };
        base_parts.path_and_query = Some(path_to_use.parse()?);
    }

    Uri::from_parts(base_parts).map_err(|_| endpoint_clone.parse::<Uri>().unwrap_err())
}

#[derive(Debug, Clone)]
pub struct SseClientConfig {
    pub sse_endpoint: Arc<str>,
    pub retry_policy: Arc<dyn SseRetryPolicy>,
    pub use_message_endpoint: Option<String>,
}

impl Default for SseClientConfig {
    fn default() -> Self {
        Self {
            sse_endpoint: "".into(),
            retry_policy: Arc::new(client_side_sse::FixedInterval::default()),
            use_message_endpoint: None,
        }
    }
}

impl From<reqwest::Error> for SseTransportError<reqwest::Error> {
    fn from(error: reqwest::Error) -> Self {
        Self::Client(error)
    }
}

impl SseClient for reqwest::Client {
    type Error = reqwest::Error;

    async fn post_message(
        &self,
        uri: Uri,
        message: ClientJsonRpcMessage,
        auth_token: Option<String>,
    ) -> Result<(), SseTransportError<Self::Error>> {
        let mut request_builder = self.post(uri.to_string()).json(&message);
        if let Some(auth_header) = auth_token {
            request_builder = request_builder.bearer_auth(auth_header);
        }

        request_builder
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(SseTransportError::from)
            .map(drop)
    }

    async fn get_stream(
        &self,
        uri: Uri,
        last_event_id: Option<String>,
        auth_token: Option<String>,
    ) -> Result<BoxedSseResponse, SseTransportError<Self::Error>> {
        let mut request_builder = self
            .get(uri.to_string())
            .header(ACCEPT, EVENT_STREAM_MIME_TYPE);

        if let Some(auth_header) = auth_token {
            request_builder = request_builder.bearer_auth(auth_header);
        }
        if let Some(last_event_id) = last_event_id {
            request_builder = request_builder.header(HEADER_LAST_EVENT_ID, last_event_id);
        }

        let response = request_builder.send().await?;
        let response = response.error_for_status()?;
        match response.headers().get(reqwest::header::CONTENT_TYPE) {
            Some(content_type) => {
                if !content_type
                    .as_bytes()
                    .starts_with(EVENT_STREAM_MIME_TYPE.as_bytes())
                {
                    return Err(SseTransportError::UnexpectedContentType(Some(
                        String::from_utf8_lossy(content_type.as_bytes()).to_string(),
                    )));
                }
            }
            None => return Err(SseTransportError::UnexpectedContentType(None)),
        }

        Ok(SseStream::from_byte_stream(response.bytes_stream()).boxed())
    }
}

impl SseClientTransport<reqwest::Client> {
    pub async fn start(
        uri: impl Into<Arc<str>>,
    ) -> Result<Self, SseTransportError<reqwest::Error>> {
        Self::start_with_client(
            reqwest::Client::default(),
            SseClientConfig {
                sse_endpoint: uri.into(),
                ..Default::default()
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;
    use rmcp::model::ServerJsonRpcMessage;
    use serde_json::{Value, json};

    use super::*;

    #[derive(Clone, Debug)]
    struct DummyClient;

    #[derive(Debug, thiserror::Error)]
    #[error("dummy error")]
    struct DummyError;

    impl SseClient for DummyClient {
        type Error = DummyError;

        async fn post_message(
            &self,
            _uri: Uri,
            _message: ClientJsonRpcMessage,
            _auth_token: Option<String>,
        ) -> Result<(), SseTransportError<Self::Error>> {
            Ok(())
        }

        async fn get_stream(
            &self,
            _uri: Uri,
            _last_event_id: Option<String>,
            _auth_token: Option<String>,
        ) -> Result<BoxedSseResponse, SseTransportError<Self::Error>> {
            unreachable!("get_stream should not be called in this test")
        }
    }

    #[test]
    fn test_message_endpoint() {
        let base_url = "https://localhost/sse".parse::<Uri>().unwrap();

        let result = message_endpoint(base_url.clone(), "?sessionId=x".to_string()).unwrap();
        assert_eq!(result.to_string(), "https://localhost/sse?sessionId=x");

        let result = message_endpoint(base_url.clone(), "mypath?sessionId=x".to_string()).unwrap();
        assert_eq!(result.to_string(), "https://localhost/mypath?sessionId=x");

        let result = message_endpoint(base_url.clone(), "/xxx?sessionId=x".to_string()).unwrap();
        assert_eq!(result.to_string(), "https://localhost/xxx?sessionId=x");

        let result =
            message_endpoint(base_url, "http://example.com/xxx?sessionId=x".to_string()).unwrap();
        assert_eq!(result.to_string(), "http://example.com/xxx?sessionId=x");
    }

    #[test]
    fn handle_endpoint_control_event_updates_uri() {
        let initial_endpoint = "https://example.com/message?sessionId=old"
            .parse::<Uri>()
            .unwrap();
        let shared_endpoint = Arc::new(RwLock::new(initial_endpoint));
        let mut reconnect = SseClientReconnect {
            client: DummyClient,
            uri: "https://example.com/sse".parse::<Uri>().unwrap(),
            message_endpoint: shared_endpoint.clone(),
        };

        let control_event = Sse::default()
            .event("endpoint")
            .data("/message?sessionId=new");

        reconnect.handle_control_event(&control_event).unwrap();

        let guard = shared_endpoint.read().expect("lock poisoned");
        assert_eq!(
            guard.to_string(),
            "https://example.com/message?sessionId=new"
        );
    }

    #[tokio::test]
    async fn control_event_frames_are_skipped() {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"ok": true}
        })
        .to_string();

        let events = vec![
            Ok(Sse::default()
                .event("endpoint")
                .data("/message?sessionId=reconnect")),
            Ok(Sse::default().event("message").data(payload)),
        ];

        let sse_src: BoxedSseResponse = futures::stream::iter(events).boxed();
        let reconn_stream = SseAutoReconnectStream::never_reconnect(sse_src, DummyError);
        futures::pin_mut!(reconn_stream);

        let message = reconn_stream.next().await.expect("stream item").unwrap();
        let actual: Value = serde_json::to_value(&message).expect("serialize actual message");
        assert_eq!(actual.get("jsonrpc"), Some(&Value::String("2.0".into())));
        assert_eq!(actual.get("id"), Some(&Value::Number(1u64.into())));
        assert!(matches!(message, ServerJsonRpcMessage::Response(_)));
    }
}
