use crate::config::McpServerConfig;
use async_trait::async_trait;
use futures_util::{Stream, FutureExt, StreamExt};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client,
};
use reqwest_eventsource::{Event, EventSource};
use rust_mcp_sdk::{
    McpDispatch, MessageDispatcher, Transport, TransportError, IoStream
};
use rust_mcp_schema::schema_utils::McpMessage;
use serde::{de::DeserializeOwned, Serialize};
use std::{
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use thiserror::Error;
use tokio::sync::Mutex; // Not strictly used yet, but might be useful for more complex state
use url::Url;

#[derive(Error, Debug)]
pub enum SseTransportError {
    #[error("Reqwest error: {0}")]
    Reqwest(#[from] reqwest::Error),
    #[error("Reqwest EventSource error: {0}")]
    ReqwestEventSource(#[from] reqwest_eventsource::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("URL parse error: {0}")]
    UrlParse(#[from] url::ParseError),
    #[error("Invalid header value: {0}")]
    InvalidHeaderValue(#[from] reqwest::header::InvalidHeaderValue),
    #[error("Invalid header name: {0}")]
    InvalidHeaderName(#[from] reqwest::header::InvalidHeaderName),
    #[error("Messages endpoint not derivable from base URL: {0}")]
    MessagesEndpointError(String),
    #[error("Connection already shut down")]
    AlreadyShutDown,
    #[error("Failed to send message: {0}")]
    SendError(String),
    #[error("SSE connection failed: {status}")]
    SseConnectionFailed { status: reqwest::StatusCode },
    #[error("Transport operation failed: {0}")]
    OperationFailed(String),
}

// Helper to map our SseTransportError to the SDK's TransportError
// impl From<SseTransportError> for TransportError {
//     fn from(e: SseTransportError) -> Self {
//         match e {
//             SseTransportError::Reqwest(err) => TransportError::ConnectionFailed(err.to_string()),
//             SseTransportError::ReqwestEventSource(err) => TransportError::ConnectionFailed(err.to_string()),
//             SseTransportError::Json(err) => TransportError::ProtocolError(err.to_string()),
//             // SseTransportError::UrlParse(err) => TransportError::ConfigurationError(err.to_string()),
//             SseTransportError::InvalidHeaderValue(err) => TransportError::ConfigurationError(err.to_string()),
//             SseTransportError::InvalidHeaderName(err) => TransportError::ConfigurationError(err.to_string()),
//             SseTransportError::MessagesEndpointError(msg) => TransportError::ConfigurationError(msg),
//             SseTransportError::AlreadyShutDown => TransportError::ConnectionClosed,
//             SseTransportError::SendError(msg) => TransportError::InternalError(msg),
//             SseTransportError::SseConnectionFailed { status } => TransportError::ConnectionFailed(format!("SSE connection failed with status: {}", status)),
//             SseTransportError::OperationFailed(msg) => TransportError::InternalError(msg),
//         }
//     }
// }

pub struct SseTransport<R, S>
where
    R: McpMessage + Clone + Send + Sync + DeserializeOwned + 'static,
    S: Clone + Send + Sync + Serialize + 'static,
{
    config: Arc<McpServerConfig>,
    client: Client,
    default_headers: HeaderMap,
    messages_url: Url,
    is_shut_down: Arc<AtomicBool>,
    _marker: std::marker::PhantomData<fn() -> (R, S)>,
}

impl<R, S> SseTransport<R, S>
where
    R: McpMessage + Clone + Send + Sync + DeserializeOwned + 'static,
    S: Clone + Send + Sync + Serialize + 'static,
{
    pub fn from_config(config: McpServerConfig) -> Result<Self, SseTransportError> {
        let client = Client::builder().build()?;
        let mut default_headers = HeaderMap::new();
        if let Some(config_headers) = &config.http_headers {
            for (key, value) in config_headers {
                let header_name = HeaderName::from_bytes(key.as_bytes())?;
                let header_value = HeaderValue::from_str(value)?;
                default_headers.insert(header_name, header_value);
            }
        }

        let base_url = Url::parse(&config.url)?;
        // Per MCP docs, client-to-server messages are typically POSTed to `/messages`
        let messages_url = base_url
            .join("messages") // Assuming relative path, common for SSE setups
            .map_err(|e| SseTransportError::MessagesEndpointError(e.to_string()))?;

        Ok(Self {
            config: Arc::new(config),
            client,
            default_headers,
            messages_url,
            is_shut_down: Arc::new(AtomicBool::new(false)),
            _marker: std::marker::PhantomData,
        })
    }
}

// Placeholder/Example IoStream. The actual rust-mcp-sdk::IoStream might be a trait
// or a concrete type with a specific constructor. This SseIoStream needs to be
// adapted or used to construct the SDK's IoStream.
pub struct SseIoStreamImpl<S: Serialize> {
    client: Client,
    messages_url: Url,
    headers: HeaderMap,
    _marker: std::marker::PhantomData<S>,
}

impl<S: Serialize + Send + Sync + 'static> SseIoStreamImpl<S> {
    // This method would be called by the SDK's IoStream logic, or SseIoStreamImpl
    // would implement a trait expected by the SDK.
    pub async fn send_mcp_message(&self, message: S) -> Result<(), SseTransportError> {
        let response = self
            .client
            .post(self.messages_url.clone())
            .headers(self.headers.clone())
            .json(&message)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            return Err(SseTransportError::SendError(format!(
                "Failed to send message (status {}): {}",
                response.status(),
                error_text
            )));
        }
        Ok(())
    }
}


// Placeholder for the SDK's MessageDispatcher<R> interaction.
// This SseMessageDispatcherImpl would implement rust-mcp-sdk::McpDispatch<R,S>
// or be used by the SDK's MessageDispatcher<R>.
pub struct SseMessageDispatcherImpl<R, S>
where
    R: McpMessage + Clone + Send + Sync + DeserializeOwned + 'static,
    S: Clone + Send + Sync + Serialize + 'static,
{
    // It likely needs a way to send messages (S), possibly via a wrapped SseIoStreamImpl
    // or a channel connected to it.
    io_sender: Arc<SseIoStreamImpl<S>>, // Example: direct reference to our sender logic
    _marker: std::marker::PhantomData<R>,
}

// #[async_trait]
// impl<R, S> McpDispatch<R, S> for SseMessageDispatcherImpl<R, S>
// where
//     R: McpMessage + Clone + Send + Sync + DeserializeOwned + 'static,
//     S: Clone + Send + Sync + Serialize + 'static,
// {
//     async fn dispatch(&self, message: R) -> Result<(), TransportError> {
//         // This is where incoming messages 'R' from the SSE stream would be processed.
//         // The current Transport::start signature suggests this dispatcher is *returned*
//         // and the SDK might use it.
//         // For this example, we'll just log it.
//         tracing::debug!(?message, "SseMessageDispatcherImpl received message");
//         // If a response 'S' needs to be sent based on 'R', it would be done here
//         // using self.io_sender.send_mcp_message(...).await;
//         Ok(())
//     }
//
//     async fn send(&self, message: S) -> Result<(), TransportError> {
//         // This allows sending 'S' type messages through the dispatcher.
//         tracing::debug!(?message, "SseMessageDispatcherImpl sending message");
//         self.io_sender.send_mcp_message(message).await.map_err(TransportError::from)
//     }
// }


#[async_trait]
impl<R, S> Transport<R, S> for SseTransport<R, S>
where
    R: McpMessage + Clone + Send + Sync + DeserializeOwned + 'static,
    S: Clone + Send + Sync + Serialize + 'static,
    // The trait definition for Transport<R,S> implies that MessageDispatcher<R> must implement McpDispatch<R,S>.
    // This means the MessageDispatcher<R> type provided by the SDK is generic itself and handles both R and S.
    // We will construct our SseMessageDispatcherImpl and assume it can be used to create
    // the SDK's MessageDispatcher<R> instance, or that MessageDispatcher<R> can wrap it.
    MessageDispatcher<R>: McpDispatch<R, S>, // This bound comes from rust-mcp-sdk::Transport
{
    fn start<'life0, 'async_trait>(
        &'life0 self,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<(Pin<Box<dyn Stream<Item = R> + Send>>, MessageDispatcher<R>, IoStream), TransportError>> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            if self.is_shut_down.load(Ordering::SeqCst) {
                return Err(SseTransportError::AlreadyShutDown.into());
            }

            let client = self.client.clone();
            let sse_url = self.config.url.clone();
            let headers = self.default_headers.clone();

            // 1. Setup SSE Stream (Receiving R)
            let event_source_fut = client.get(&sse_url).headers(headers.clone()).send();

            let event_source_result = event_source_fut.await;
            let response = event_source_result.map_err(SseTransportError::from)?;


            if !response.status().is_success() {
                return Err(SseTransportError::SseConnectionFailed{status: response.status()}.into());
            }

            // reqwest-eventsource might not be directly compatible with error mapping needed for TransportError.
            // We need to ensure EventSource errors are also mapped.
            let mut event_source = EventSource::new(response) // EventSource::from_request requires a builder
                .map_err(|e| TransportError::ConnectionFailed(format!("Failed to create EventSource from response: {}", e)))?;


            let message_stream = futures_util::stream::poll_fn(move |cx| {
                match event_source.poll_next_event(cx) {
                    std::task::Poll::Ready(Some(Ok(event))) => {
                        match event {
                            Event::Open => std::task::Poll::Ready(None), // Ignored for item stream
                            Event::Message(message) => {
                                match serde_json::from_str::<R>(&message.data) {
                                    Ok(parsed_msg) => std::task::Poll::Ready(Some(Ok(parsed_msg))),
                                    Err(e) => std::task::Poll::Ready(Some(Err(TransportError::ProtocolError(format!("JSON parse error: {}", e))))),
                                }
                            }
                        }
                    }
                    std::task::Poll::Ready(Some(Err(e))) => {
                         // reqwest_eventsource::Error needs mapping
                        std::task::Poll::Ready(Some(Err(TransportError::ConnectionFailed(format!("SSE event error: {}", e)))))
                    }
                    std::task::Poll::Ready(None) => std::task::Poll::Ready(None), // Stream ended
                    std::task::Poll::Pending => std::task::Poll::Pending,
                }
            })
            .filter_map(|result_item| async move { result_item.ok() }) // This will drop errors, which might not be ideal.
                                                                  // The trait expects Stream<Item = R>, not Stream<Item = Result<R, Error>>.
                                                                  // Consider how errors in the stream should be handled. If an error means
                                                                  // the stream is dead, then filter_map is okay.
            .boxed();


            // 2. Setup Sending Mechanism (IoStream for S)
            // This part is highly dependent on how rust-mcp-sdk::IoStream is defined and constructed.
            // We create our SseIoStreamImpl and assume it's used by/for the SDK's IoStream.
            let sse_io_stream_impl = Arc::new(SseIoStreamImpl {
                client: self.client.clone(),
                messages_url: self.messages_url.clone(),
                headers: self.default_headers.clone(),
                _marker: std::marker::PhantomData,
            });

            // TODO: Construct the actual rust-mcp-sdk::IoStream.
            // This is a placeholder. The SDK must provide a way to create an IoStream,
            // possibly from a raw sender/receiver pair or a custom implementation.
            // For now, let's assume a hypothetical constructor or that SseIoStreamImpl
            // itself could be wrapped or directly used if IoStream were a trait we implement.
            let sdk_io_stream = IoStream::new_placeholder(); // HYPOTHETICAL - THIS WILL NOT COMPILE


            // 3. Setup Message Dispatcher
            // Similar to IoStream, constructing MessageDispatcher<R> (which must be McpDispatch<R,S>)
            // depends on the SDK. We use our SseMessageDispatcherImpl.
            let sse_dispatcher_impl = SseMessageDispatcherImpl {
                io_sender: sse_io_stream_impl.clone(), // Our dispatcher uses our sender
                _marker: std::marker::PhantomData,
            };

            // TODO: Construct the actual rust-mcp-sdk::MessageDispatcher<R>.
            // This is a placeholder. The SDK must provide this.
            // It needs to fulfill `McpDispatch<R, S>`.
            // Perhaps it takes our `sse_dispatcher_impl` or parts of it.
            let sdk_message_dispatcher = MessageDispatcher::<R>::new_placeholder(sse_dispatcher_impl); // HYPOTHETICAL


            Ok((message_stream, sdk_message_dispatcher, sdk_io_stream))
        })
    }

    fn shut_down<'life0, 'async_trait>(
        &'life0 self,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<(), TransportError>> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            self.is_shut_down.store(true, Ordering::SeqCst);
            // TODO: Implement actual shutdown logic:
            // - Close the EventSource stream (reqwest_eventsource::EventSource is !Unpin, manage its lifetime)
            // - Cancel any ongoing tasks related to this transport.
            // - Close the IoStream if it has resources.
            tracing::info!(url = %self.config.url, "Shutdown requested for SSE transport");
            Ok(())
        })
    }

    fn is_shut_down<'life0, 'async_trait>(
        &'life0 self,
    ) -> Pin<Box<dyn std::future::Future<Output = bool> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        Self: 'async_trait,
    {
        let flag = self.is_shut_down.clone();
        Box::pin(async move { flag.load(Ordering::SeqCst) })
    }
}