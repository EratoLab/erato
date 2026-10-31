//! Idempotent approved attachments through the normal backend storage provider.
//! Blob keys include the immutable content digest. A crash before SQL finalization
//! can leave an unreferenced blob, but a retry writes the same key and file ID.
use super::{contract, store};
use crate::db::entity::client_operation_attempts::AttemptState;
use crate::models::outlook_provenance::OutlookFileProvenance;
use crate::state::AppState;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{Result, eyre};
use sea_orm::prelude::Uuid;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub struct PreparedFiles {
    pub(super) files: Vec<PreparedFile>,
}
pub(super) struct PreparedFile {
    pub id: Uuid,
    pub filename: String,
    pub provider: String,
    pub path: String,
    /// Where the artifact came from, when the sidecar supplied a usable one.
    pub provenance: Option<OutlookFileProvenance>,
}
pub fn file_id(job_id: Uuid, export_id: &str, artifact_id: &str, digest: &str) -> Uuid {
    let key = serde_json::to_vec(&(job_id, export_id, artifact_id, digest)).expect("string tuple");
    let digest = Sha256::digest(key);
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}
/// The sidecar's optional `outlookProvenance` member of an approved artifact,
/// as the version 1 `OutlookFileProvenance` it declares. The shared schema has
/// checked its shape with the package; this applies the model's identity rules.
pub fn provenance_of(artifact: &Value) -> Option<OutlookFileProvenance> {
    OutlookFileProvenance::from_value(artifact.get("outlookProvenance")?).ok()
}
pub async fn stage(
    state: &AppState,
    job: &store::NativeJob,
    package: &Value,
) -> Result<PreparedFiles> {
    contract::validate_export(
        package,
        &job.binding,
        &job.plan,
        chrono::Utc::now().timestamp(),
    )?;
    if job.state != AttemptState::Claimed {
        return Err(eyre!("Local result is no longer pending"));
    }
    let artifacts = package["artifacts"]
        .as_array()
        .ok_or_else(|| eyre!("Invalid package"))?;
    if artifacts.len() > state.config.frontend.max_files {
        return Err(eyre!("Too many approved attachments"));
    }
    let storage = state.default_file_storage_provider();
    let provider = state.default_file_storage_provider_id();
    let mut files = Vec::new();
    for artifact in artifacts {
        let id = file_id(
            job.request.attempt_id,
            package["exportId"].as_str().unwrap(),
            artifact["artifactId"].as_str().unwrap(),
            artifact["sha256"].as_str().unwrap(),
        );
        let path = format!("local-delegation/{}/{id}", job.request.attempt_id);
        let bytes = STANDARD.decode(artifact["contentBase64"].as_str().unwrap())?;
        if state
            .config
            .max_upload_size_bytes()
            .is_some_and(|max| bytes.len() as u64 > max)
        {
            return Err(eyre!("Approved attachment exceeds upload limit"));
        }
        let mut writer = storage
            .upload_file_writer(&path, Some("text/plain"))
            .await?;
        writer.write(bytes).await?;
        writer.close().await?;
        let provenance = provenance_of(artifact);
        if provenance.is_none() && artifact.get("outlookProvenance").is_some() {
            // A navigation hint, never a grant: the approved text is still accepted.
            tracing::warn!(
                attempt = %job.request.attempt_id,
                "ignoring an approved artifact's outlookProvenance without a usable identity"
            );
        }
        files.push(PreparedFile {
            id,
            filename: artifact["filename"].as_str().unwrap().into(),
            provider: provider.clone(),
            path,
            provenance,
        });
    }
    Ok(PreparedFiles { files })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retry_keys_are_stable_and_distinct_content_gets_distinct_blob_identity() {
        let job = Uuid::new_v4();
        let id = file_id(job, "export", "artifact", "digest");
        assert_eq!(id, file_id(job, "export", "artifact", "digest"));
        assert_ne!(id, file_id(job, "export", "artifact", "changed"));
        assert_ne!(id, file_id(Uuid::new_v4(), "export", "artifact", "digest"));
        assert_ne!(id, file_id(job, "other", "artifact", "digest"));
    }
    #[test]
    fn provenance_is_kept_only_when_valid_and_yields_the_documents_ews_id() {
        let valid = serde_json::json!({"outlookProvenance": {"version": 1, "origins": [{"document": {
            "documentId": "0f5a8a48-1b2c-4d3e-9f10-a1b2c3d4e5f6",
            "external_ids": [
                {"key": "email_message_id", "value": "<minutes@example.test>"},
                {"key": "ews_id", "value": "AQMk/CaseSensitive+EwsId=="}
            ],
            "mailbox": {"mailboxId": "0123456789abcdef0123456789abcdef", "emailAddress": "owner@example.test"}
        }}]}});
        let provenance = provenance_of(&valid).unwrap();
        assert_eq!(
            provenance.document_ews_id(),
            Some("AQMk/CaseSensitive+EwsId==")
        );
        assert_eq!(
            serde_json::to_value(&provenance).unwrap(),
            valid["outlookProvenance"]
        );
        // An attachment knows only its containing message: no EWS ID of its own.
        let parent_only = serde_json::json!({"outlookProvenance": {"version": 1, "origins": [{"topLevelParent": {
            "external_ids": [{"key": "ews_id", "value": "AQMk/Parent=="}]}}]}});
        let provenance = provenance_of(&parent_only).unwrap();
        assert!(provenance.document_ews_id().is_none());
        for invalid in [
            serde_json::json!({}),
            serde_json::json!({"outlookProvenance": null}),
            serde_json::json!({"outlookProvenance": {"version": 2, "origins": []}}),
            serde_json::json!({"outlookProvenance": {"version": 1, "origins": [{"document": {"external_ids": []}}]}}),
            serde_json::json!({"outlookProvenance": {"version": 1, "origins": [{"document": {
                "documentId": "row-17", "external_ids": [{"key": "ews_id", "value": "x"}]}}]}}),
        ] {
            assert!(provenance_of(&invalid).is_none(), "{invalid}");
        }
    }
}
