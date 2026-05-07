use crate::config::LangfuseConfig;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use chrono::{DateTime, Utc};
use eyre::{Result, eyre};
use opentelemetry::trace::{
    SpanContext, SpanId, SpanKind, Status, TraceFlags, TraceId, TraceState,
};
use opentelemetry::{Array, InstrumentationScope, KeyValue, StringValue, Value};
use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::trace::{SpanData, SpanEvents, SpanExporter, SpanLinks};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

const LANGFUSE_OTEL_ENDPOINT_PATH: &str = "/api/public/otel/v1/traces";
const LANGFUSE_TRACE_NAME: &str = "langfuse.trace.name";
const LANGFUSE_USER_ID: &str = "langfuse.user.id";
const LANGFUSE_SESSION_ID: &str = "langfuse.session.id";
const LANGFUSE_RELEASE: &str = "langfuse.release";
const LANGFUSE_ENVIRONMENT: &str = "langfuse.environment";
const LANGFUSE_TRACE_INPUT: &str = "langfuse.trace.input";
const LANGFUSE_TRACE_OUTPUT: &str = "langfuse.trace.output";
const LANGFUSE_TRACE_TAGS: &str = "langfuse.trace.tags";
const LANGFUSE_TRACE_PUBLIC: &str = "langfuse.trace.public";
const LANGFUSE_TRACE_METADATA_PREFIX: &str = "langfuse.trace.metadata";
const LANGFUSE_OBSERVATION_TYPE: &str = "langfuse.observation.type";
const LANGFUSE_OBSERVATION_LEVEL: &str = "langfuse.observation.level";
const LANGFUSE_OBSERVATION_STATUS_MESSAGE: &str = "langfuse.observation.status_message";
const LANGFUSE_OBSERVATION_INPUT: &str = "langfuse.observation.input";
const LANGFUSE_OBSERVATION_OUTPUT: &str = "langfuse.observation.output";
const LANGFUSE_OBSERVATION_MODEL: &str = "langfuse.observation.model.name";
const LANGFUSE_OBSERVATION_MODEL_PARAMETERS: &str = "langfuse.observation.model.parameters";
const LANGFUSE_OBSERVATION_USAGE_DETAILS: &str = "langfuse.observation.usage_details";
const LANGFUSE_OBSERVATION_COST_DETAILS: &str = "langfuse.observation.cost_details";
const LANGFUSE_OBSERVATION_COMPLETION_START_TIME: &str =
    "langfuse.observation.completion_start_time";
const LANGFUSE_OBSERVATION_METADATA_PREFIX: &str = "langfuse.observation.metadata";
const LANGFUSE_VERSION: &str = "langfuse.version";

/// Langfuse client for sending tracing data
#[derive(Debug, Clone)]
pub struct LangfuseClient {
    client: Client,
    base_url: String,
    public_key: String,
    secret_key: String,
    enabled: bool,
    environment: Option<String>,
    use_otel: bool,
}

impl LangfuseClient {
    /// Get the environment identifier for this client
    pub fn environment(&self) -> Option<&str> {
        self.environment.as_deref()
    }

    /// Create a new LangfuseClient from configuration
    pub fn from_config(config: &LangfuseConfig, environment: Option<String>) -> Result<Self> {
        tracing::debug!(
            enabled = config.enabled,
            tracing_enabled = config.tracing_enabled,
            base_url = ?config.base_url,
            public_key = ?config.public_key.as_ref().map(|k| format!("{}...", &k[..k.len().min(8)])),
            secret_key_set = config.secret_key.is_some(),
            environment = ?environment,
            "Creating LangfuseClient from configuration"
        );

        if !config.enabled {
            tracing::debug!("Langfuse is disabled, creating inactive client");
            return Ok(Self {
                client: Client::new(),
                base_url: String::new(),
                public_key: String::new(),
                secret_key: String::new(),
                enabled: false,
                environment: None,
                use_otel: false,
            });
        }

        let base_url = config
            .base_url
            .as_ref()
            .ok_or_else(|| eyre!("base_url is required when Langfuse is enabled"))?
            .trim_end_matches('/')
            .to_string();

        let public_key = config
            .public_key
            .as_ref()
            .ok_or_else(|| eyre!("public_key is required when Langfuse is enabled"))?
            .clone();

        let secret_key = config
            .secret_key
            .as_ref()
            .ok_or_else(|| eyre!("secret_key is required when Langfuse is enabled"))?
            .expose_secret()
            .to_string();

        tracing::debug!(
            base_url = %base_url,
            public_key = %format!("{}...", &public_key[..public_key.len().min(8)]),
            environment = ?environment,
            "Successfully created active LangfuseClient"
        );

        Ok(Self {
            client: Client::new(),
            base_url,
            public_key,
            secret_key,
            enabled: true,
            environment,
            use_otel: config.use_otel,
        })
    }

    /// Create a trace in Langfuse
    pub async fn create_trace(&self, request: CreateTraceRequest) -> Result<()> {
        if !self.enabled {
            tracing::debug!("Langfuse client is disabled, skipping trace creation");
            return Ok(());
        }

        tracing::debug!(
            trace_id = %request.id,
            name = ?request.name,
            "Creating Langfuse trace"
        );

        if self.use_otel {
            tracing::debug!(
                trace_id = %request.id,
                "Skipping standalone Langfuse trace-create in OTEL mode"
            );
            return Ok(());
        }

        let timestamp_iso = system_time_to_iso_string(SystemTime::now());

        let ingestion_event = IngestionEvent {
            id: request.id.clone(),
            r#type: "trace-create".to_string(),
            timestamp: timestamp_iso,
            body: IngestionEventBody::TraceCreate(CreateTraceEvent {
                id: request.id,
                name: request.name,
                user_id: request.user_id,
                session_id: request.session_id,
                release: request.release,
                environment: request.environment,
                input: request.input,
                output: request.output,
                metadata: request.metadata,
                tags: request.tags,
                public: request.public,
            }),
        };

        let batch = IngestionBatch {
            batch: vec![ingestion_event],
        };

        tracing::debug!(
            batch_size = batch.batch.len(),
            "Created Langfuse trace ingestion batch"
        );

        self.send_ingestion_batch(batch).await
    }

    /// Update a trace with output in Langfuse
    /// Note: This sends a trace-create event with the same id to update the trace
    pub async fn update_trace_output(
        &self,
        trace_id: String,
        output: serde_json::Value,
        environment: Option<String>,
    ) -> Result<()> {
        if !self.enabled {
            tracing::debug!("Langfuse client is disabled, skipping trace update");
            return Ok(());
        }

        tracing::debug!(
            trace_id = %trace_id,
            "Updating Langfuse trace with output"
        );

        if self.use_otel {
            tracing::debug!(
                trace_id = %trace_id,
                environment = ?environment,
                output = ?output,
                "Skipping standalone Langfuse trace output update in OTEL mode"
            );
            return Ok(());
        }

        let timestamp_iso = system_time_to_iso_string(SystemTime::now());

        let ingestion_event = IngestionEvent {
            id: format!("{}_output_update", trace_id),
            r#type: "trace-create".to_string(),
            timestamp: timestamp_iso,
            body: IngestionEventBody::TraceCreate(CreateTraceEvent {
                id: trace_id,
                name: None,
                user_id: None,
                session_id: None,
                release: None,
                environment,
                input: None,
                output: Some(output),
                metadata: None,
                tags: None,
                public: None,
            }),
        };

        let batch = IngestionBatch {
            batch: vec![ingestion_event],
        };

        tracing::debug!(
            batch_size = batch.batch.len(),
            "Created Langfuse trace update ingestion batch"
        );

        self.send_ingestion_batch(batch).await
    }

    /// Update a trace with metadata in Langfuse
    /// Note: This sends a trace-create event with the same id to update the trace
    pub async fn update_trace_metadata(
        &self,
        trace_id: String,
        metadata: serde_json::Value,
        environment: Option<String>,
    ) -> Result<()> {
        if !self.enabled {
            tracing::debug!("Langfuse client is disabled, skipping trace metadata update");
            return Ok(());
        }

        tracing::debug!(
            trace_id = %trace_id,
            "Updating Langfuse trace with metadata"
        );

        if self.use_otel {
            tracing::debug!(
                trace_id = %trace_id,
                environment = ?environment,
                metadata = ?metadata,
                "Skipping standalone Langfuse trace metadata update in OTEL mode"
            );
            return Ok(());
        }

        let timestamp_iso = system_time_to_iso_string(SystemTime::now());

        let ingestion_event = IngestionEvent {
            id: format!("{}_metadata_update", trace_id),
            r#type: "trace-create".to_string(),
            timestamp: timestamp_iso,
            body: IngestionEventBody::TraceCreate(CreateTraceEvent {
                id: trace_id,
                name: None,
                user_id: None,
                session_id: None,
                release: None,
                environment,
                input: None,
                output: None,
                metadata: Some(metadata),
                tags: None,
                public: None,
            }),
        };

        let batch = IngestionBatch {
            batch: vec![ingestion_event],
        };

        tracing::debug!(
            batch_size = batch.batch.len(),
            "Created Langfuse trace metadata update ingestion batch"
        );

        self.send_ingestion_batch(batch).await
    }

    /// Update a trace with tags in Langfuse
    /// Note: This sends a trace-create event with the same id to update the trace
    pub async fn update_trace_tags(
        &self,
        trace_id: String,
        tags: Vec<String>,
        environment: Option<String>,
    ) -> Result<()> {
        if !self.enabled {
            tracing::debug!("Langfuse client is disabled, skipping trace tags update");
            return Ok(());
        }

        tracing::debug!(
            trace_id = %trace_id,
            tags = ?tags,
            "Updating Langfuse trace with tags"
        );

        if self.use_otel {
            tracing::debug!(
                trace_id = %trace_id,
                environment = ?environment,
                tags = ?tags,
                "Skipping standalone Langfuse trace tags update in OTEL mode"
            );
            return Ok(());
        }

        let timestamp_iso = system_time_to_iso_string(SystemTime::now());

        let ingestion_event = IngestionEvent {
            id: format!("{}_tags_update", trace_id),
            r#type: "trace-create".to_string(),
            timestamp: timestamp_iso,
            body: IngestionEventBody::TraceCreate(CreateTraceEvent {
                id: trace_id,
                name: None,
                user_id: None,
                session_id: None,
                release: None,
                environment,
                input: None,
                output: None,
                metadata: None,
                tags: Some(tags),
                public: None,
            }),
        };

        let batch = IngestionBatch {
            batch: vec![ingestion_event],
        };

        tracing::debug!(
            batch_size = batch.batch.len(),
            "Created Langfuse trace tags update ingestion batch"
        );

        self.send_ingestion_batch(batch).await
    }

    /// Send a generic observation event to Langfuse
    pub async fn finish_observation(
        &self,
        request: FinishGenerationRequest,
        observation_type: &str,
    ) -> Result<()> {
        if !self.enabled {
            tracing::debug!(
                observation_type = observation_type,
                "Langfuse client is disabled, skipping observation send"
            );
            return Ok(());
        }

        tracing::debug!(
            observation_id = %request.observation_id,
            trace_id = %request.trace_id,
            model = ?request.model,
            name = ?request.name,
            observation_type = observation_type,
            "Starting Langfuse observation finish request"
        );

        if self.use_otel {
            return self
                .send_otel_observation(request, observation_type, None)
                .await;
        }

        // Convert timestamp to ISO 8601 string as expected by Langfuse
        let timestamp_iso = system_time_to_iso_string(SystemTime::now());
        let event_observation_type = observation_type.to_lowercase();

        let ingestion_event = IngestionEvent {
            id: request.observation_id.clone(),
            r#type: format!("{event_observation_type}-create"),
            timestamp: timestamp_iso,
            body: IngestionEventBody::ObservationCreate(Box::new(CreateObservationEvent {
                id: request.observation_id,
                trace_id: request.trace_id,
                r#type: observation_type.to_string(),
                name: request.name,
                start_time: request.start_time,
                end_time: request.end_time,
                completion_start_time: request.completion_start_time,
                model: request.model,
                model_parameters: request.model_parameters,
                input: request.input,
                output: request.output,
                usage: request.usage,
                metadata: request.metadata,
                level: request.level.unwrap_or_else(|| "DEFAULT".to_string()),
                status_message: request.status_message,
                parent_observation_id: request.parent_observation_id,
                version: request.version,
                environment: request.environment,
            })),
        };

        let batch = IngestionBatch {
            batch: vec![ingestion_event],
        };

        tracing::debug!(
            batch_size = batch.batch.len(),
            "Created Langfuse ingestion batch"
        );

        self.send_ingestion_batch(batch).await
    }

    /// Finish a generation and send it to Langfuse
    pub async fn finish_generation(&self, request: FinishGenerationRequest) -> Result<()> {
        self.finish_observation(request, "GENERATION").await
    }

    /// Create both trace and generation observation in a single batch
    pub async fn create_trace_with_generation(
        &self,
        trace_request: CreateTraceRequest,
        generation_request: FinishGenerationRequest,
    ) -> Result<()> {
        if !self.enabled {
            tracing::debug!("Langfuse client is disabled, skipping trace and generation creation");
            return Ok(());
        }

        tracing::debug!(
            trace_id = %trace_request.id,
            observation_id = %generation_request.observation_id,
            "Creating Langfuse trace with generation in single batch"
        );

        if self.use_otel {
            return self
                .send_otel_spans(vec![otel_observation_span(
                    generation_request,
                    "GENERATION",
                    Some(trace_request),
                )])
                .await;
        }

        let timestamp_iso = system_time_to_iso_string(SystemTime::now());

        // Create trace event
        let trace_event = IngestionEvent {
            id: trace_request.id.clone(),
            r#type: "trace-create".to_string(),
            timestamp: timestamp_iso.clone(),
            body: IngestionEventBody::TraceCreate(CreateTraceEvent {
                id: trace_request.id,
                name: trace_request.name,
                user_id: trace_request.user_id,
                session_id: trace_request.session_id,
                release: trace_request.release,
                environment: trace_request.environment,
                input: trace_request.input,
                output: trace_request.output,
                metadata: trace_request.metadata,
                tags: trace_request.tags,
                public: trace_request.public,
            }),
        };

        // Create observation event
        let observation_event = IngestionEvent {
            id: generation_request.observation_id.clone(),
            r#type: "generation-create".to_string(),
            timestamp: timestamp_iso,
            body: IngestionEventBody::ObservationCreate(Box::new(CreateObservationEvent {
                id: generation_request.observation_id,
                trace_id: generation_request.trace_id,
                r#type: "GENERATION".to_string(),
                name: generation_request.name,
                start_time: generation_request.start_time,
                end_time: generation_request.end_time,
                completion_start_time: generation_request.completion_start_time,
                model: generation_request.model,
                model_parameters: generation_request.model_parameters,
                input: generation_request.input,
                output: generation_request.output,
                usage: generation_request.usage,
                metadata: generation_request.metadata,
                level: generation_request
                    .level
                    .unwrap_or_else(|| "DEFAULT".to_string()),
                status_message: generation_request.status_message,
                parent_observation_id: generation_request.parent_observation_id,
                version: generation_request.version,
                environment: generation_request.environment,
            })),
        };

        let batch = IngestionBatch {
            batch: vec![trace_event, observation_event],
        };

        tracing::debug!(
            batch_size = batch.batch.len(),
            "Created Langfuse batch with trace and observation"
        );

        self.send_ingestion_batch(batch).await
    }

    /// Create a score (user feedback) in Langfuse
    pub async fn create_score(&self, request: CreateScoreRequest) -> Result<()> {
        if !self.enabled {
            tracing::debug!("Langfuse client is disabled, skipping score creation");
            return Ok(());
        }

        tracing::debug!(
            score_id = %request.id,
            trace_id = %request.trace_id,
            name = %request.name,
            value = %request.value,
            environment = ?request.environment,
            "Creating Langfuse score"
        );

        let timestamp_iso = system_time_to_iso_string(SystemTime::now());

        // Generate unique event ID by appending timestamp-derived suffix
        // This prevents event deduplication while keeping body.id stable for upsert
        let now = SystemTime::now();
        let timestamp_nanos = now
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let unique_event_id = format!("{}_event_{}", request.id, timestamp_nanos);

        let ingestion_event = IngestionEvent {
            id: unique_event_id,
            r#type: "score-create".to_string(),
            timestamp: timestamp_iso,
            body: IngestionEventBody::ScoreCreate(CreateScoreEvent {
                id: request.id,
                trace_id: request.trace_id,
                name: request.name,
                value: request.value,
                comment: request.comment,
                data_type: request.data_type,
                environment: request.environment,
            }),
        };

        let batch = IngestionBatch {
            batch: vec![ingestion_event],
        };

        tracing::debug!(
            batch_size = batch.batch.len(),
            "Created Langfuse score ingestion batch"
        );

        self.send_ingestion_batch(batch).await
    }

    /// Get a prompt from Langfuse by name
    pub async fn get_prompt(&self, prompt_name: &str) -> Result<LangfusePrompt> {
        let prompt = self
            .get_prompt_with_label(prompt_name, None)
            .await?
            .ok_or_else(|| {
                eyre!(
                    "Failed to retrieve prompt '{}' from Langfuse: prompt not found",
                    prompt_name
                )
            })?;
        Ok(prompt)
    }

    /// Get a prompt from Langfuse by name and optional label.
    /// Returns Ok(None) when the prompt or label is not found (HTTP 404).
    pub async fn get_prompt_with_label(
        &self,
        prompt_name: &str,
        label: Option<&str>,
    ) -> Result<Option<LangfusePrompt>> {
        if !self.enabled {
            return Err(eyre!("Langfuse client is disabled"));
        }

        tracing::debug!(
            prompt_name = %prompt_name,
            label = ?label,
            "Retrieving prompt from Langfuse"
        );

        let mut url = reqwest::Url::parse(&format!(
            "{}/api/public/v2/prompts/{}",
            self.base_url, prompt_name
        ))
        .map_err(|e| eyre!("Failed to build Langfuse prompt URL: {}", e))?;
        if let Some(label) = label {
            url.query_pairs_mut().append_pair("label", label);
        }

        tracing::debug!(
            url = %url.as_str(),
            "Sending request to Langfuse prompts endpoint"
        );

        let response = self
            .client
            .get(url.clone())
            .basic_auth(&self.public_key, Some(&self.secret_key))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| {
                tracing::error!(
                    error = %e,
                    url = %url.as_str(),
                    prompt_name = %prompt_name,
                    "Failed to send HTTP request to Langfuse prompts endpoint"
                );
                eyre!("Failed to retrieve prompt from Langfuse: {}", e)
            })?;

        let status = response.status();

        tracing::debug!(
            status = %status,
            prompt_name = %prompt_name,
            "Received response from Langfuse prompts endpoint"
        );

        if status == reqwest::StatusCode::NOT_FOUND {
            tracing::warn!(
                prompt_name = %prompt_name,
                label = ?label,
                "Langfuse prompt not found"
            );
            return Ok(None);
        }

        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read response body".to_string());

            tracing::error!(
                status = %status,
                response_body = %body,
                url = %url.as_str(),
                prompt_name = %prompt_name,
                "Langfuse prompt retrieval failed"
            );

            return Err(eyre!(
                "Failed to retrieve prompt '{}' from Langfuse with status {}: {}",
                prompt_name,
                status,
                body
            ));
        }

        let prompt = response.json::<LangfusePrompt>().await.map_err(|e| {
            tracing::error!(
                error = %e,
                prompt_name = %prompt_name,
                "Failed to parse Langfuse prompt response as JSON"
            );
            eyre!("Failed to parse prompt response from Langfuse: {}", e)
        })?;

        tracing::debug!(
            prompt_name = %prompt_name,
            prompt_type = ?prompt_type_from_prompt(&prompt),
            "Successfully retrieved prompt from Langfuse"
        );

        Ok(Some(prompt))
    }

    /// Send an ingestion batch to Langfuse
    async fn send_ingestion_batch(&self, batch: IngestionBatch) -> Result<()> {
        let url = format!("{}/api/public/ingestion", self.base_url);

        tracing::debug!(
            url = %url,
            public_key = %self.public_key,
            "Sending request to Langfuse ingestion endpoint"
        );

        // Serialize the batch for debugging
        let batch_json = serde_json::to_string_pretty(&batch)
            .unwrap_or_else(|e| format!("Failed to serialize batch: {}", e));

        tracing::debug!(
            request_body = %batch_json,
            "Langfuse request payload"
        );

        let response = self
            .client
            .post(&url)
            .basic_auth(&self.public_key, Some(&self.secret_key))
            .header("Content-Type", "application/json")
            .json(&batch)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(
                    error = %e,
                    url = %url,
                    "Failed to send HTTP request to Langfuse"
                );
                eyre!("Failed to send request to Langfuse: {}", e)
            })?;

        let status = response.status();

        tracing::debug!(
            status = %status,
            "Received response from Langfuse"
        );

        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read response body".to_string());

            tracing::error!(
                status = %status,
                response_body = %body,
                url = %url,
                "Langfuse ingestion request failed"
            );

            return Err(eyre!(
                "Langfuse ingestion failed with status {}: {}",
                status,
                body
            ));
        }

        // Handle response body and check for multi-status errors
        match response.text().await {
            Ok(response_body) => {
                tracing::debug!(
                    status = %status,
                    response_body = %response_body,
                    "Received response from Langfuse"
                );

                // For 207 Multi-Status, check for individual errors
                if status.as_u16() == 207 {
                    match serde_json::from_str::<MultiStatusResponse>(&response_body) {
                        Ok(multi_status) => {
                            if !multi_status.errors.is_empty() {
                                tracing::error!(
                                    errors = ?multi_status.errors,
                                    successes_count = multi_status.successes.len(),
                                    "Langfuse ingestion had errors"
                                );

                                // Return error with details from the first error
                                if let Some(first_error) = multi_status.errors.first() {
                                    return Err(eyre!(
                                        "Langfuse ingestion error for {}: {} - {}",
                                        first_error.id,
                                        first_error.message,
                                        first_error.error.as_deref().unwrap_or("No details")
                                    ));
                                }
                            } else {
                                tracing::debug!(
                                    successes_count = multi_status.successes.len(),
                                    "Successfully sent all ingestion events to Langfuse"
                                );
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                response_body = %response_body,
                                "Failed to parse multi-status response from Langfuse"
                            );
                        }
                    }
                } else {
                    tracing::debug!("Successfully sent ingestion batch to Langfuse");
                }
            }
            Err(e) => {
                tracing::debug!(
                    status = %status,
                    error = %e,
                    "Successfully sent ingestion batch to Langfuse (failed to read response body)"
                );
            }
        }

        Ok(())
    }

    async fn send_otel_observation(
        &self,
        request: FinishGenerationRequest,
        observation_type: &str,
        trace_request: Option<CreateTraceRequest>,
    ) -> Result<()> {
        self.send_otel_spans(vec![otel_observation_span(
            request,
            observation_type,
            trace_request,
        )])
        .await
    }

    async fn send_otel_spans(&self, spans: Vec<SpanData>) -> Result<()> {
        let endpoint = format!("{}{}", self.base_url, LANGFUSE_OTEL_ENDPOINT_PATH);
        let auth = BASE64_STANDARD.encode(format!("{}:{}", self.public_key, self.secret_key));
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), format!("Basic {auth}"));
        headers.insert("x-langfuse-ingestion-version".to_string(), "4".to_string());

        tracing::debug!(
            endpoint = %endpoint,
            span_count = spans.len(),
            "Sending Langfuse OTLP spans"
        );

        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut exporter = opentelemetry_otlp::SpanExporter::builder()
                .with_http()
                .with_endpoint(endpoint)
                .with_protocol(Protocol::HttpJson)
                .with_headers(headers)
                .build()
                .map_err(|e| eyre!("Failed to build Langfuse OTLP exporter: {}", e))?;

            let resource = Resource::builder()
                .with_service_name("erato")
                .with_attribute(KeyValue::new("telemetry.sdk.language", "rust"))
                .build();
            exporter.set_resource(&resource);

            futures::executor::block_on(exporter.export(spans))
                .map_err(|e| eyre!("Failed to export Langfuse OTLP spans: {}", e))?;

            exporter
                .shutdown_with_timeout(Duration::from_secs(5))
                .map_err(|e| eyre!("Failed to shut down Langfuse OTLP exporter: {}", e))?;

            Ok(())
        })
        .await
        .map_err(|e| eyre!("Langfuse OTLP export task failed: {}", e))??;

        Ok(())
    }
}

/// Convert SystemTime to ISO 8601 string format expected by Langfuse
fn system_time_to_iso_string(time: SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn otel_observation_span(
    request: FinishGenerationRequest,
    observation_type: &str,
    trace_request: Option<CreateTraceRequest>,
) -> SpanData {
    let now = SystemTime::now();
    let start_time = parse_otel_time(request.start_time.as_deref()).unwrap_or(now);
    let end_time = parse_otel_time(request.end_time.as_deref()).unwrap_or(now);
    let trace_id = trace_id_from_langfuse_id(&request.trace_id);
    let span_id = observation_span_id(&request.observation_id);
    let parent_span_id = request
        .parent_observation_id
        .as_deref()
        .map(observation_span_id)
        .unwrap_or(SpanId::INVALID);
    let span_name = request.name.clone().unwrap_or_else(|| {
        format!(
            "Langfuse {}",
            observation_type
                .chars()
                .flat_map(char::to_lowercase)
                .collect::<String>()
        )
    });
    let mut attributes = vec![
        KeyValue::new("langfuse.trace.id", request.trace_id.clone()),
        KeyValue::new("langfuse.observation.id", request.observation_id.clone()),
        KeyValue::new(
            LANGFUSE_OBSERVATION_TYPE,
            observation_type.to_ascii_lowercase(),
        ),
        KeyValue::new(
            opentelemetry_semantic_conventions::trace::GEN_AI_OPERATION_NAME,
            "chat",
        ),
        KeyValue::new(
            opentelemetry_semantic_conventions::trace::GEN_AI_SYSTEM,
            "_OTHER",
        ),
    ];

    push_string_attr(&mut attributes, LANGFUSE_ENVIRONMENT, request.environment);
    push_string_attr(&mut attributes, LANGFUSE_OBSERVATION_LEVEL, request.level);
    push_string_attr(
        &mut attributes,
        LANGFUSE_OBSERVATION_STATUS_MESSAGE,
        request.status_message,
    );
    push_json_string_attr(
        &mut attributes,
        LANGFUSE_OBSERVATION_INPUT,
        request.input.clone(),
    );
    push_json_string_attr(
        &mut attributes,
        LANGFUSE_OBSERVATION_OUTPUT,
        request.output.clone(),
    );
    push_json_string_attr(
        &mut attributes,
        opentelemetry_semantic_conventions::attribute::GEN_AI_PROMPT,
        request.input,
    );
    push_json_string_attr(
        &mut attributes,
        opentelemetry_semantic_conventions::attribute::GEN_AI_COMPLETION,
        request.output,
    );

    if let Some(model) = request.model {
        attributes.push(KeyValue::new(LANGFUSE_OBSERVATION_MODEL, model.clone()));
        attributes.push(KeyValue::new(
            opentelemetry_semantic_conventions::trace::GEN_AI_REQUEST_MODEL,
            model.clone(),
        ));
        attributes.push(KeyValue::new(
            opentelemetry_semantic_conventions::trace::GEN_AI_RESPONSE_MODEL,
            model,
        ));
    }
    push_json_string_attr(
        &mut attributes,
        LANGFUSE_OBSERVATION_MODEL_PARAMETERS,
        request.model_parameters,
    );
    if let Some(completion_start_time) = request.completion_start_time {
        attributes.push(KeyValue::new(
            LANGFUSE_OBSERVATION_COMPLETION_START_TIME,
            completion_start_time,
        ));
    }
    if let Some(usage) = request.usage {
        push_usage_attrs(&mut attributes, usage);
    }
    push_metadata_attrs(
        &mut attributes,
        LANGFUSE_OBSERVATION_METADATA_PREFIX,
        request.metadata,
    );
    push_string_attr(&mut attributes, LANGFUSE_VERSION, request.version);
    if let Some(trace_request) = trace_request {
        push_trace_attrs(&mut attributes, trace_request);
    }

    span_data(
        trace_id,
        span_id,
        parent_span_id,
        span_name,
        start_time,
        end_time,
        attributes,
    )
}

fn push_trace_attrs(attributes: &mut Vec<KeyValue>, request: CreateTraceRequest) {
    attributes.push(KeyValue::new("langfuse.trace.id", request.id));
    push_string_attr(attributes, LANGFUSE_TRACE_NAME, request.name);
    push_string_attr(attributes, LANGFUSE_USER_ID, request.user_id);
    push_string_attr(attributes, LANGFUSE_SESSION_ID, request.session_id);
    push_string_attr(attributes, LANGFUSE_RELEASE, request.release);
    push_string_attr(attributes, LANGFUSE_ENVIRONMENT, request.environment);
    push_json_string_attr(attributes, LANGFUSE_TRACE_INPUT, request.input);
    push_json_string_attr(attributes, LANGFUSE_TRACE_OUTPUT, request.output);
    push_metadata_attrs(attributes, LANGFUSE_TRACE_METADATA_PREFIX, request.metadata);
    if let Some(tags) = request.tags {
        attributes.push(string_array_attr(LANGFUSE_TRACE_TAGS, tags));
    }
    if let Some(public) = request.public {
        attributes.push(KeyValue::new(LANGFUSE_TRACE_PUBLIC, public));
    }
}

fn span_data(
    trace_id: TraceId,
    span_id: SpanId,
    parent_span_id: SpanId,
    name: String,
    start_time: SystemTime,
    end_time: SystemTime,
    attributes: Vec<KeyValue>,
) -> SpanData {
    SpanData {
        span_context: SpanContext::new(
            trace_id,
            span_id,
            TraceFlags::SAMPLED,
            false,
            TraceState::default(),
        ),
        parent_span_id,
        parent_span_is_remote: false,
        span_kind: SpanKind::Internal,
        name: Cow::Owned(name),
        start_time,
        end_time,
        attributes,
        dropped_attributes_count: 0,
        events: SpanEvents::default(),
        links: SpanLinks::default(),
        status: Status::Unset,
        instrumentation_scope: InstrumentationScope::builder("erato.langfuse").build(),
    }
}

fn push_usage_attrs(attributes: &mut Vec<KeyValue>, usage: Usage) {
    if let Some(input) = usage.input {
        attributes.push(KeyValue::new(
            opentelemetry_semantic_conventions::trace::GEN_AI_USAGE_INPUT_TOKENS,
            input as i64,
        ));
    }
    if let Some(output) = usage.output {
        attributes.push(KeyValue::new(
            opentelemetry_semantic_conventions::trace::GEN_AI_USAGE_OUTPUT_TOKENS,
            output as i64,
        ));
    }

    let usage_json = serde_json::json!({
        "input": usage.input,
        "output": usage.output,
        "total": usage.total,
        "unit": usage.unit,
    });
    attributes.push(KeyValue::new(
        LANGFUSE_OBSERVATION_USAGE_DETAILS,
        usage_json.to_string(),
    ));

    let cost_json = serde_json::json!({
        "input": usage.input_cost,
        "output": usage.output_cost,
        "total": usage.total_cost,
    });
    attributes.push(KeyValue::new(
        LANGFUSE_OBSERVATION_COST_DETAILS,
        cost_json.to_string(),
    ));
}

fn push_metadata_attrs(
    attributes: &mut Vec<KeyValue>,
    prefix: &'static str,
    metadata: Option<serde_json::Value>,
) {
    let Some(serde_json::Value::Object(metadata)) = metadata else {
        if let Some(metadata) = metadata {
            attributes.push(KeyValue::new(prefix, metadata.to_string()));
        }
        return;
    };

    for (key, value) in metadata {
        let attr_key = format!("{prefix}.{key}");
        attributes.push(KeyValue::new(attr_key, otel_json_value(value)));
    }
}

fn push_string_attr(attributes: &mut Vec<KeyValue>, key: &'static str, value: Option<String>) {
    if let Some(value) = value {
        attributes.push(KeyValue::new(key, value));
    }
}

fn push_json_string_attr(
    attributes: &mut Vec<KeyValue>,
    key: &'static str,
    value: Option<serde_json::Value>,
) {
    if let Some(value) = value {
        attributes.push(KeyValue::new(key, value.to_string()));
    }
}

fn otel_json_value(value: serde_json::Value) -> Value {
    match value {
        serde_json::Value::Bool(value) => value.into(),
        serde_json::Value::Number(value) => value.as_f64().unwrap_or_default().into(),
        serde_json::Value::String(value) => value.into(),
        other => other.to_string().into(),
    }
}

fn string_array_attr(key: &'static str, values: Vec<String>) -> KeyValue {
    KeyValue::new(
        key,
        Value::Array(Array::String(
            values.into_iter().map(StringValue::from).collect(),
        )),
    )
}

fn parse_otel_time(value: Option<&str>) -> Option<SystemTime> {
    value
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|datetime| datetime.with_timezone(&Utc).into())
}

fn trace_id_from_langfuse_id(id: &str) -> TraceId {
    let hex = id
        .strip_prefix("trace_")
        .or_else(|| id.strip_prefix("trace-"))
        .unwrap_or(id);
    TraceId::from_hex(hex)
        .ok()
        .filter(|id| *id != TraceId::INVALID)
        .unwrap_or_else(|| TraceId::from_bytes(first_hash_bytes::<16>(id)))
}

fn observation_span_id(observation_id: &str) -> SpanId {
    stable_span_id(observation_id)
}

fn stable_span_id(id: &str) -> SpanId {
    let hex = id
        .strip_prefix("obs_")
        .or_else(|| id.strip_prefix("obs-"))
        .unwrap_or(id);
    SpanId::from_hex(hex)
        .ok()
        .filter(|id| *id != SpanId::INVALID)
        .unwrap_or_else(|| SpanId::from_bytes(first_hash_bytes::<8>(id)))
}

fn first_hash_bytes<const N: usize>(value: &str) -> [u8; N] {
    let hash = Sha256::digest(value.as_bytes());
    let mut bytes = [0u8; N];
    bytes.copy_from_slice(&hash[..N]);
    bytes
}

/// Request for creating a trace
#[derive(Debug, Clone)]
pub struct CreateTraceRequest {
    pub id: String,
    pub name: Option<String>,
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    pub release: Option<String>,
    pub environment: Option<String>,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub tags: Option<Vec<String>>,
    pub public: Option<bool>,
}

/// Request for finishing a generation
#[derive(Debug, Clone)]
pub struct FinishGenerationRequest {
    pub observation_id: String,
    pub trace_id: String,
    pub name: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub completion_start_time: Option<String>,
    pub model: Option<String>,
    pub model_parameters: Option<serde_json::Value>,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub usage: Option<Usage>,
    pub metadata: Option<serde_json::Value>,
    pub level: Option<String>,
    pub status_message: Option<String>,
    pub parent_observation_id: Option<String>,
    pub version: Option<String>,
    pub environment: Option<String>,
}

/// Request for creating a score (user feedback)
#[derive(Debug, Clone)]
pub struct CreateScoreRequest {
    pub id: String,
    pub trace_id: String,
    pub name: String,
    pub value: f64,
    pub comment: Option<String>,
    pub data_type: String,
    pub environment: Option<String>,
}

/// Ingestion batch structure
#[derive(Debug, Serialize)]
struct IngestionBatch {
    batch: Vec<IngestionEvent>,
}

/// Ingestion event structure
#[derive(Debug, Serialize)]
struct IngestionEvent {
    id: String,
    r#type: String,
    timestamp: String, // ISO 8601 timestamp string
    body: IngestionEventBody,
}

/// Ingestion event body
#[derive(Debug, Serialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
#[allow(clippy::enum_variant_names)]
enum IngestionEventBody {
    TraceCreate(CreateTraceEvent),
    ObservationCreate(Box<CreateObservationEvent>),
    ScoreCreate(CreateScoreEvent),
}

/// Create trace event according to Langfuse OpenAPI spec
/// Note: This is also used for updates by sending with the same id
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateTraceEvent {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public: Option<bool>,
}

/// Create observation event according to Langfuse OpenAPI spec
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateObservationEvent {
    pub id: String,
    pub trace_id: String,
    pub r#type: String, // "GENERATION", "SPAN", "EVENT"
    pub name: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub completion_start_time: Option<String>,
    pub model: Option<String>,
    pub model_parameters: Option<serde_json::Value>,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub usage: Option<Usage>,
    pub metadata: Option<serde_json::Value>,
    pub level: String, // "DEBUG", "DEFAULT", "WARNING", "ERROR"
    pub status_message: Option<String>,
    pub parent_observation_id: Option<String>,
    pub version: Option<String>,
    pub environment: Option<String>,
}

/// Usage information for token counting and cost tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: Option<i32>,
    pub output: Option<i32>,
    pub total: Option<i32>,
    pub unit: Option<String>, // "TOKENS", "CHARACTERS", "MILLISECONDS", "SECONDS", "IMAGES"
    pub input_cost: Option<f64>,
    pub output_cost: Option<f64>,
    pub total_cost: Option<f64>,
}

/// Create score event according to Langfuse OpenAPI spec
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateScoreEvent {
    pub id: String,
    pub trace_id: String,
    pub name: String,
    pub value: f64,
    pub comment: Option<String>,
    pub data_type: String,
    pub environment: Option<String>,
}

/// Multi-status response structure from Langfuse
#[derive(Debug, Deserialize)]
struct MultiStatusResponse {
    pub successes: Vec<serde_json::Value>, // We don't need to parse success details
    pub errors: Vec<IngestionError>,
}

/// Individual ingestion error from multi-status response
#[derive(Debug, Deserialize)]
struct IngestionError {
    pub id: String,
    pub message: String,
    pub error: Option<String>,
}

/// Langfuse prompt response structure
#[derive(Debug, Deserialize, Clone)]
pub struct LangfusePrompt {
    pub id: String,
    pub name: String,
    pub version: i32,
    pub prompt: serde_json::Value,
    #[serde(rename = "type")]
    pub prompt_type: String,
    pub labels: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Helper function to extract prompt type for logging
fn prompt_type_from_prompt(prompt: &LangfusePrompt) -> &str {
    &prompt.prompt_type
}

/// Request-scoped tracing client that centralizes metadata for the lifecycle of a request.
///
/// This wrapper around LangfuseClient stores common metadata (trace_id, user_id, session_id, environment)
/// that applies to all tracing operations within a single request. This eliminates the need to pass
/// these values repeatedly when creating traces, observations, and scores.
#[derive(Debug, Clone)]
pub struct TracingLangfuseClient {
    client: LangfuseClient,
    trace_id: String,
    user_id: Option<String>,
    session_id: Option<String>,
    environment: Option<String>,
}

impl TracingLangfuseClient {
    /// Create a new TracingLangfuseClient with request-scoped metadata
    pub fn new(
        client: LangfuseClient,
        trace_id: String,
        user_id: Option<String>,
        session_id: Option<String>,
    ) -> Self {
        let environment = client.environment().map(|s| s.to_string());

        tracing::debug!(
            trace_id = %trace_id,
            user_id = ?user_id,
            session_id = ?session_id,
            environment = ?environment,
            "Creating TracingLangfuseClient with request-scoped metadata"
        );

        Self {
            client,
            trace_id,
            user_id,
            session_id,
            environment,
        }
    }

    /// Get the trace ID for this tracing context
    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    /// Get the environment for this tracing context
    pub fn environment(&self) -> Option<&str> {
        self.environment.as_deref()
    }

    /// Create a trace using the stored metadata
    pub async fn create_trace(
        &self,
        name: Option<String>,
        input: Option<serde_json::Value>,
        metadata: Option<serde_json::Value>,
        tags: Option<Vec<String>>,
    ) -> Result<()> {
        let request = CreateTraceRequest {
            id: self.trace_id.clone(),
            name,
            user_id: self.user_id.clone(),
            session_id: self.session_id.clone(),
            release: None,
            environment: self.environment.clone(),
            input,
            output: None,
            metadata,
            tags,
            public: None,
        };

        self.client.create_trace(request).await
    }

    /// Update the trace output
    pub async fn update_trace_output(&self, output: serde_json::Value) -> Result<()> {
        self.client
            .update_trace_output(self.trace_id.clone(), output, self.environment.clone())
            .await
    }

    /// Update the trace metadata
    pub async fn update_trace_metadata(&self, metadata: serde_json::Value) -> Result<()> {
        self.client
            .update_trace_metadata(self.trace_id.clone(), metadata, self.environment.clone())
            .await
    }

    /// Update the trace tags
    pub async fn update_trace_tags(&self, tags: Vec<String>) -> Result<()> {
        self.client
            .update_trace_tags(self.trace_id.clone(), tags, self.environment.clone())
            .await
    }

    /// Create a generation observation using the stored trace_id and environment
    #[allow(clippy::too_many_arguments)]
    pub async fn create_generation(
        &self,
        observation_id: String,
        name: Option<String>,
        start_time: Option<String>,
        end_time: Option<String>,
        completion_start_time: Option<String>,
        model: Option<String>,
        model_parameters: Option<serde_json::Value>,
        input: Option<serde_json::Value>,
        output: Option<serde_json::Value>,
        usage: Option<Usage>,
        metadata: Option<serde_json::Value>,
        level: Option<String>,
        status_message: Option<String>,
        parent_observation_id: Option<String>,
        version: Option<String>,
    ) -> Result<()> {
        let request = FinishGenerationRequest {
            observation_id,
            trace_id: self.trace_id.clone(),
            name,
            start_time,
            end_time,
            completion_start_time,
            model,
            model_parameters,
            input,
            output,
            usage,
            metadata,
            level,
            status_message,
            parent_observation_id,
            version,
            environment: self.environment.clone(),
        };

        self.create_observation(
            request.observation_id,
            "GENERATION".to_string(),
            request.name,
            request.start_time,
            request.end_time,
            request.completion_start_time,
            request.model,
            request.model_parameters,
            request.input,
            request.output,
            request.usage,
            request.metadata,
            request.level,
            request.status_message,
            request.parent_observation_id,
            request.version,
        )
        .await
    }

    /// Create an arbitrary observation (for example, a SPAN) on the current trace.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_observation(
        &self,
        observation_id: String,
        observation_type: String,
        name: Option<String>,
        start_time: Option<String>,
        end_time: Option<String>,
        completion_start_time: Option<String>,
        model: Option<String>,
        model_parameters: Option<serde_json::Value>,
        input: Option<serde_json::Value>,
        output: Option<serde_json::Value>,
        usage: Option<Usage>,
        metadata: Option<serde_json::Value>,
        level: Option<String>,
        status_message: Option<String>,
        parent_observation_id: Option<String>,
        version: Option<String>,
    ) -> Result<()> {
        let request = FinishGenerationRequest {
            observation_id,
            trace_id: self.trace_id.clone(),
            name,
            start_time,
            end_time,
            completion_start_time,
            model,
            model_parameters,
            input,
            output,
            usage,
            metadata,
            level,
            status_message,
            parent_observation_id,
            version,
            environment: self.environment.clone(),
        };

        self.client
            .finish_observation(request, &observation_type)
            .await
    }

    /// Create both trace and generation in a single batch
    #[allow(clippy::too_many_arguments)]
    pub async fn create_trace_with_generation(
        &self,
        trace_name: Option<String>,
        trace_input: Option<serde_json::Value>,
        trace_metadata: Option<serde_json::Value>,
        trace_tags: Option<Vec<String>>,
        observation_id: String,
        generation_name: Option<String>,
        start_time: Option<String>,
        end_time: Option<String>,
        completion_start_time: Option<String>,
        model: Option<String>,
        model_parameters: Option<serde_json::Value>,
        generation_input: Option<serde_json::Value>,
        generation_output: Option<serde_json::Value>,
        usage: Option<Usage>,
        generation_metadata: Option<serde_json::Value>,
        level: Option<String>,
        status_message: Option<String>,
        parent_observation_id: Option<String>,
        version: Option<String>,
    ) -> Result<()> {
        let trace_request = CreateTraceRequest {
            id: self.trace_id.clone(),
            name: trace_name,
            user_id: self.user_id.clone(),
            session_id: self.session_id.clone(),
            release: None,
            environment: self.environment.clone(),
            input: trace_input,
            output: None,
            metadata: trace_metadata,
            tags: trace_tags,
            public: None,
        };

        let generation_request = FinishGenerationRequest {
            observation_id,
            trace_id: self.trace_id.clone(),
            name: generation_name,
            start_time,
            end_time,
            completion_start_time,
            model,
            model_parameters,
            input: generation_input,
            output: generation_output,
            usage,
            metadata: generation_metadata,
            level,
            status_message,
            parent_observation_id,
            version,
            environment: self.environment.clone(),
        };

        self.client
            .create_trace_with_generation(trace_request, generation_request)
            .await
    }

    /// Create a score (user feedback) using the stored trace_id and environment
    pub async fn create_score(
        &self,
        score_id: String,
        name: String,
        value: f64,
        comment: Option<String>,
        data_type: String,
    ) -> Result<()> {
        let request = CreateScoreRequest {
            id: score_id,
            trace_id: self.trace_id.clone(),
            name,
            value,
            comment,
            data_type,
            environment: self.environment.clone(),
        };

        self.client.create_score(request).await
    }

    /// Get access to the underlying LangfuseClient for operations that don't fit the scoped pattern
    pub fn client(&self) -> &LangfuseClient {
        &self.client
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::LangfuseConfig;
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::{HeaderMap, Uri};
    use axum::{Router, routing::post};
    use serde_json::json;
    use tokio::sync::mpsc;

    #[derive(Debug)]
    struct RecordedRequest {
        path: String,
        headers: HeaderMap,
        body: Bytes,
    }

    async fn record_request(
        State(sender): State<mpsc::Sender<RecordedRequest>>,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> &'static str {
        sender
            .send(RecordedRequest {
                path: uri.path().to_string(),
                headers,
                body,
            })
            .await
            .unwrap();
        "{}"
    }

    async fn mock_langfuse_server() -> (String, mpsc::Receiver<RecordedRequest>) {
        let (sender, receiver) = mpsc::channel(8);
        let app = Router::new()
            .route("/api/public/ingestion", post(record_request))
            .route("/api/public/otel/v1/traces", post(record_request))
            .with_state(sender);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{addr}"), receiver)
    }

    fn enabled_config(base_url: String, use_otel: bool) -> LangfuseConfig {
        LangfuseConfig {
            enabled: true,
            base_url: Some(base_url),
            public_key: Some("pk-lf-test".to_string()),
            secret_key: Some("sk-lf-test".into()),
            use_otel,
            ..Default::default()
        }
    }

    fn test_trace_request() -> CreateTraceRequest {
        CreateTraceRequest {
            id: "trace_58406520a006649127e371903a2de979".to_string(),
            name: Some("Test trace".to_string()),
            user_id: Some("user-1".to_string()),
            session_id: Some("session-1".to_string()),
            release: Some("release-1".to_string()),
            environment: Some("test".to_string()),
            input: Some(json!({"prompt": "hello"})),
            output: Some(json!({"answer": "world"})),
            metadata: Some(json!({"assistant_id": "assistant-1", "attempt": 2})),
            tags: Some(vec!["model-gpt-4".to_string(), "chat".to_string()]),
            public: Some(false),
        }
    }

    fn test_generation_request(observation_type: &str) -> FinishGenerationRequest {
        FinishGenerationRequest {
            observation_id: "obs_78406520a006649127e371903a2de979".to_string(),
            trace_id: "trace_58406520a006649127e371903a2de979".to_string(),
            name: Some(format!("{observation_type} name")),
            start_time: Some("2026-05-07T10:00:00.000Z".to_string()),
            end_time: Some("2026-05-07T10:00:01.000Z".to_string()),
            completion_start_time: Some("2026-05-07T10:00:00.500Z".to_string()),
            model: Some("gpt-4.1".to_string()),
            model_parameters: Some(json!({"temperature": 0.2})),
            input: Some(json!([{"role": "user", "content": "hello"}])),
            output: Some(json!({"content": "world"})),
            usage: Some(Usage {
                input: Some(10),
                output: Some(20),
                total: Some(30),
                unit: Some("TOKENS".to_string()),
                input_cost: Some(0.1),
                output_cost: Some(0.2),
                total_cost: Some(0.3),
            }),
            metadata: Some(json!({"assistant_id": "assistant-1"})),
            level: Some("DEFAULT".to_string()),
            status_message: None,
            parent_observation_id: None,
            version: Some("v1".to_string()),
            environment: Some("test".to_string()),
        }
    }

    fn test_score_request() -> CreateScoreRequest {
        CreateScoreRequest {
            id: "score-1".to_string(),
            trace_id: "trace_58406520a006649127e371903a2de979".to_string(),
            name: "user_feedback".to_string(),
            value: 1.0,
            comment: Some("good".to_string()),
            data_type: "NUMERIC".to_string(),
            environment: Some("test".to_string()),
        }
    }

    async fn recv_json(
        receiver: &mut mpsc::Receiver<RecordedRequest>,
    ) -> (RecordedRequest, serde_json::Value) {
        let request = receiver.recv().await.unwrap();
        let body = serde_json::from_slice(&request.body).unwrap();
        (request, body)
    }

    async fn assert_no_request(receiver: &mut mpsc::Receiver<RecordedRequest>) {
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), receiver.recv())
                .await
                .is_err()
        );
    }

    fn assert_basic_auth(headers: &HeaderMap) {
        assert_eq!(
            headers.get("authorization").unwrap(),
            "Basic cGstbGYtdGVzdDpzay1sZi10ZXN0"
        );
    }

    fn otel_attr<'a>(body: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Value> {
        match body {
            serde_json::Value::Object(map) => {
                if map.get("key").and_then(|key| key.as_str()) == Some(key) {
                    return map.get("value");
                }
                map.values().find_map(|value| otel_attr(value, key))
            }
            serde_json::Value::Array(values) => {
                values.iter().find_map(|value| otel_attr(value, key))
            }
            _ => None,
        }
    }

    fn otel_string_attr(body: &serde_json::Value, key: &str) -> Option<String> {
        otel_attr(body, key)
            .and_then(|value| value.get("stringValue"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
    }

    #[test]
    fn test_langfuse_client_disabled() {
        let config = LangfuseConfig {
            enabled: false,
            ..Default::default()
        };

        let client = LangfuseClient::from_config(&config, None).unwrap();
        assert!(!client.enabled);
    }

    #[test]
    fn test_langfuse_client_enabled_missing_config() {
        let config = LangfuseConfig {
            enabled: true,
            base_url: None,
            public_key: None,
            secret_key: None,
            ..Default::default()
        };

        let result = LangfuseClient::from_config(&config, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_langfuse_client_enabled_valid_config() {
        let config = LangfuseConfig {
            enabled: true,
            base_url: Some("https://cloud.langfuse.com".to_string()),
            public_key: Some("pk-lf-test".to_string()),
            secret_key: Some("sk-lf-test".into()),
            ..Default::default()
        };

        let client = LangfuseClient::from_config(&config, Some("production".to_string())).unwrap();
        assert!(client.enabled);
        assert_eq!(client.base_url, "https://cloud.langfuse.com");
        assert_eq!(client.public_key, "pk-lf-test");
        assert_eq!(client.secret_key, "sk-lf-test");
        assert_eq!(client.environment, Some("production".to_string()));
    }

    #[tokio::test]
    async fn sends_trace_to_legacy_ingestion_endpoint() {
        let (base_url, mut receiver) = mock_langfuse_server().await;
        let client = LangfuseClient::from_config(&enabled_config(base_url, false), None).unwrap();

        client.create_trace(test_trace_request()).await.unwrap();

        let (request, body) = recv_json(&mut receiver).await;
        assert_eq!(request.path, "/api/public/ingestion");
        assert_basic_auth(&request.headers);
        assert_eq!(body["batch"][0]["type"], "trace-create");
        assert_eq!(
            body["batch"][0]["body"]["id"],
            "trace_58406520a006649127e371903a2de979"
        );
        assert_eq!(body["batch"][0]["body"]["name"], "Test trace");
        assert_eq!(
            body["batch"][0]["body"]["metadata"]["assistant_id"],
            "assistant-1"
        );
        assert_eq!(body["batch"][0]["body"]["tags"][0], "model-gpt-4");
    }

    #[tokio::test]
    async fn skips_standalone_trace_create_in_otel_mode() {
        let (base_url, mut receiver) = mock_langfuse_server().await;
        let client = LangfuseClient::from_config(&enabled_config(base_url, true), None).unwrap();

        client.create_trace(test_trace_request()).await.unwrap();

        assert_no_request(&mut receiver).await;
    }

    #[tokio::test]
    async fn sends_trace_updates_to_both_transports() {
        for use_otel in [false, true] {
            let (base_url, mut receiver) = mock_langfuse_server().await;
            let client =
                LangfuseClient::from_config(&enabled_config(base_url, use_otel), None).unwrap();

            client
                .update_trace_output(
                    "trace_58406520a006649127e371903a2de979".to_string(),
                    json!({"content": "done"}),
                    Some("test".to_string()),
                )
                .await
                .unwrap();
            client
                .update_trace_metadata(
                    "trace_58406520a006649127e371903a2de979".to_string(),
                    json!({"assistant_id": "assistant-1"}),
                    Some("test".to_string()),
                )
                .await
                .unwrap();
            client
                .update_trace_tags(
                    "trace_58406520a006649127e371903a2de979".to_string(),
                    vec!["model-gpt-4".to_string()],
                    Some("test".to_string()),
                )
                .await
                .unwrap();

            if use_otel {
                assert_no_request(&mut receiver).await;
            } else {
                let (_, output_body) = recv_json(&mut receiver).await;
                let (_, metadata_body) = recv_json(&mut receiver).await;
                let (_, tags_body) = recv_json(&mut receiver).await;
                assert_eq!(output_body["batch"][0]["type"], "trace-create");
                assert_eq!(output_body["batch"][0]["body"]["output"]["content"], "done");
                assert_eq!(
                    metadata_body["batch"][0]["body"]["metadata"]["assistant_id"],
                    "assistant-1"
                );
                assert_eq!(tags_body["batch"][0]["body"]["tags"][0], "model-gpt-4");
            }
        }
    }

    #[tokio::test]
    async fn sends_generation_to_legacy_ingestion_endpoint() {
        let (base_url, mut receiver) = mock_langfuse_server().await;
        let client = LangfuseClient::from_config(&enabled_config(base_url, false), None).unwrap();

        client
            .finish_generation(test_generation_request("generation"))
            .await
            .unwrap();

        let (request, body) = recv_json(&mut receiver).await;
        assert_eq!(request.path, "/api/public/ingestion");
        assert_eq!(body["batch"][0]["type"], "generation-create");
        assert_eq!(body["batch"][0]["body"]["type"], "GENERATION");
        assert_eq!(body["batch"][0]["body"]["model"], "gpt-4.1");
        assert_eq!(body["batch"][0]["body"]["usage"]["input"], 10);
    }

    #[tokio::test]
    async fn sends_generation_to_otel_endpoint_when_enabled() {
        let (base_url, mut receiver) = mock_langfuse_server().await;
        let client = LangfuseClient::from_config(&enabled_config(base_url, true), None).unwrap();

        client
            .finish_generation(test_generation_request("generation"))
            .await
            .unwrap();

        let (request, body) = recv_json(&mut receiver).await;
        assert_eq!(request.path, "/api/public/otel/v1/traces");
        assert_eq!(
            otel_string_attr(&body, LANGFUSE_OBSERVATION_TYPE).unwrap(),
            "generation"
        );
        assert_eq!(
            otel_string_attr(&body, LANGFUSE_OBSERVATION_MODEL).unwrap(),
            "gpt-4.1"
        );
        assert_eq!(
            otel_attr(
                &body,
                opentelemetry_semantic_conventions::trace::GEN_AI_USAGE_INPUT_TOKENS
            )
            .unwrap()["intValue"],
            "10"
        );
    }

    #[tokio::test]
    async fn sends_span_observation_to_both_transports() {
        for use_otel in [false, true] {
            let (base_url, mut receiver) = mock_langfuse_server().await;
            let client =
                LangfuseClient::from_config(&enabled_config(base_url, use_otel), None).unwrap();

            client
                .finish_observation(test_generation_request("span"), "SPAN")
                .await
                .unwrap();

            let (request, body) = recv_json(&mut receiver).await;
            if use_otel {
                assert_eq!(request.path, "/api/public/otel/v1/traces");
                assert_eq!(
                    otel_string_attr(&body, LANGFUSE_OBSERVATION_TYPE).unwrap(),
                    "span"
                );
            } else {
                assert_eq!(request.path, "/api/public/ingestion");
                assert_eq!(body["batch"][0]["type"], "span-create");
                assert_eq!(body["batch"][0]["body"]["type"], "SPAN");
            }
        }
    }

    #[tokio::test]
    async fn sends_trace_with_generation_to_both_transports() {
        for use_otel in [false, true] {
            let (base_url, mut receiver) = mock_langfuse_server().await;
            let client =
                LangfuseClient::from_config(&enabled_config(base_url, use_otel), None).unwrap();

            client
                .create_trace_with_generation(
                    test_trace_request(),
                    test_generation_request("generation"),
                )
                .await
                .unwrap();

            let (request, body) = recv_json(&mut receiver).await;
            if use_otel {
                assert_eq!(request.path, "/api/public/otel/v1/traces");
                let spans = body["resourceSpans"][0]["scopeSpans"][0]["spans"]
                    .as_array()
                    .unwrap();
                assert_eq!(spans.len(), 1);
                assert_eq!(spans[0]["name"], "generation name");
                assert_ne!(spans[0]["name"], "Langfuse Trace");
                assert_eq!(
                    otel_string_attr(&body, LANGFUSE_TRACE_NAME).unwrap(),
                    "Test trace"
                );
                assert_eq!(
                    otel_string_attr(
                        &body,
                        &(LANGFUSE_TRACE_METADATA_PREFIX.to_owned() + ".assistant_id")
                    )
                    .unwrap(),
                    "assistant-1"
                );
            } else {
                assert_eq!(request.path, "/api/public/ingestion");
                assert_eq!(body["batch"].as_array().unwrap().len(), 2);
                assert_eq!(body["batch"][0]["type"], "trace-create");
                assert_eq!(body["batch"][1]["type"], "generation-create");
            }
        }
    }

    #[tokio::test]
    async fn sends_score_to_legacy_ingestion_endpoint() {
        let (base_url, mut receiver) = mock_langfuse_server().await;
        let client = LangfuseClient::from_config(&enabled_config(base_url, false), None).unwrap();

        client.create_score(test_score_request()).await.unwrap();

        let (request, body) = recv_json(&mut receiver).await;
        assert_eq!(request.path, "/api/public/ingestion");
        assert_eq!(body["batch"][0]["type"], "score-create");
        assert_eq!(body["batch"][0]["body"]["name"], "user_feedback");
        assert_eq!(body["batch"][0]["body"]["value"], 1.0);
    }
}
