use crate::config::LangfuseConfig;
use eyre::{eyre, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Langfuse client for sending tracing data
#[derive(Debug, Clone)]
pub struct LangfuseClient {
    client: Client,
    base_url: String,
    public_key: String,
    secret_key: String,
    enabled: bool,
}

impl LangfuseClient {
    /// Create a new LangfuseClient from configuration
    pub fn from_config(config: &LangfuseConfig) -> Result<Self> {
        tracing::debug!(
            enabled = config.enabled,
            tracing_enabled = config.tracing_enabled,
            base_url = ?config.base_url,
            public_key = ?config.public_key.as_ref().map(|k| format!("{}...", &k[..k.len().min(8)])),
            secret_key_set = config.secret_key.is_some(),
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
            "Successfully created active LangfuseClient"
        );

        Ok(Self {
            client: Client::new(),
            base_url,
            public_key,
            secret_key,
            enabled: true,
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
            r#type: "observation-create".to_string(),
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
            r#type: "observation-create".to_string(),
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
    let duration_since_epoch = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0));

    // Convert to milliseconds since epoch
    let millis = duration_since_epoch.as_millis() as u64;

    // Create a simple ISO 8601 timestamp
    let secs = millis / 1000;
    let remaining_millis = millis % 1000;

    // This is a basic implementation - for production you might want to use chrono
    format!(
        "{}T{}Z",
        format_timestamp_date(secs),
        format_timestamp_time(secs, remaining_millis)
    )
}

fn format_timestamp_date(secs: u64) -> String {
    // Basic date formatting - this is simplified
    // In production, use chrono for proper date/time handling
    let days_since_epoch = secs / 86400;
    let year = 1970 + (days_since_epoch / 365); // Simplified year calculation
    let day_of_year = days_since_epoch % 365;
    let month = (day_of_year / 30) + 1; // Simplified month calculation
    let day = (day_of_year % 30) + 1;

    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn format_timestamp_time(secs: u64, millis: u64) -> String {
    let seconds_in_day = secs % 86400;
    let hours = seconds_in_day / 3600;
    let minutes = (seconds_in_day % 3600) / 60;
    let seconds = seconds_in_day % 60;

    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

/// Request for creating a trace
#[derive(Debug, Clone)]
pub struct CreateTraceRequest {
    pub id: String,
    pub name: Option<String>,
    pub user_id: Option<String>,
    pub session_id: Option<String>,
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
enum IngestionEventBody {
    TraceCreate(CreateTraceEvent),
    ObservationCreate(Box<CreateObservationEvent>),
}

/// Create trace event according to Langfuse OpenAPI spec
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateTraceEvent {
    pub id: String,
    pub name: Option<String>,
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub tags: Option<Vec<String>>,
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

        let client = LangfuseClient::from_config(&config).unwrap();
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

        let result = LangfuseClient::from_config(&config);
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

        let client = LangfuseClient::from_config(&config).unwrap();
        assert!(client.enabled);
        assert_eq!(client.base_url, "https://cloud.langfuse.com");
        assert_eq!(client.public_key, "pk-lf-test");
        assert_eq!(client.secret_key, "sk-lf-test");
    }
}
