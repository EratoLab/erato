use crate::config::LangfuseConfig;
use chrono::{DateTime, Utc};
use eyre::{Result, eyre};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::SystemTime;

/// Langfuse client for sending tracing data
#[derive(Debug, Clone)]
pub struct LangfuseClient {
    client: Client,
    base_url: String,
    public_key: String,
    secret_key: String,
    enabled: bool,
    environment: Option<String>,
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
            .clone();

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

    /// Finish a generation and send it to Langfuse
    pub async fn finish_generation(&self, request: FinishGenerationRequest) -> Result<()> {
        if !self.enabled {
            tracing::debug!("Langfuse client is disabled, skipping generation finish");
            return Ok(());
        }

        tracing::debug!(
            observation_id = %request.observation_id,
            trace_id = %request.trace_id,
            model = ?request.model,
            name = ?request.name,
            "Starting Langfuse generation finish request"
        );

        // Convert timestamp to ISO 8601 string as expected by Langfuse
        let timestamp_iso = system_time_to_iso_string(SystemTime::now());

        let ingestion_event = IngestionEvent {
            id: request.observation_id.clone(),
            r#type: "generation-create".to_string(),
            timestamp: timestamp_iso,
            body: IngestionEventBody::ObservationCreate(Box::new(CreateObservationEvent {
                id: request.observation_id,
                trace_id: request.trace_id,
                r#type: "GENERATION".to_string(),
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
        if !self.enabled {
            return Err(eyre!("Langfuse client is disabled"));
        }

        tracing::debug!(
            prompt_name = %prompt_name,
            "Retrieving prompt from Langfuse"
        );

        let url = format!("{}/api/public/v2/prompts/{}", self.base_url, prompt_name);

        tracing::debug!(
            url = %url,
            "Sending request to Langfuse prompts endpoint"
        );

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.public_key, Some(&self.secret_key))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| {
                tracing::error!(
                    error = %e,
                    url = %url,
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

        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read response body".to_string());

            tracing::error!(
                status = %status,
                response_body = %body,
                url = %url,
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

        Ok(prompt)
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
}

/// Convert SystemTime to ISO 8601 string format expected by Langfuse
fn system_time_to_iso_string(time: SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
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

        self.client.finish_generation(request).await
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
            secret_key: Some("sk-lf-test".to_string()),
            ..Default::default()
        };

        let client = LangfuseClient::from_config(&config, Some("production".to_string())).unwrap();
        assert!(client.enabled);
        assert_eq!(client.base_url, "https://cloud.langfuse.com");
        assert_eq!(client.public_key, "pk-lf-test");
        assert_eq!(client.secret_key, "sk-lf-test");
        assert_eq!(client.environment, Some("production".to_string()));
    }
}
