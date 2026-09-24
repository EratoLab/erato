//! Idempotent approved attachments through the normal backend storage provider.
//! Blob keys include the immutable content digest. A crash before SQL finalization
//! can leave an unreferenced blob, but a retry writes the same key and file ID.
use super::{contract, store};
use crate::db::entity::local_delegation_jobs::JobState;
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
pub async fn stage(
    state: &AppState,
    job: &store::PendingJob,
    package: &Value,
) -> Result<PreparedFiles> {
    contract::validate_export(
        package,
        job.binding
            .as_ref()
            .ok_or_else(|| eyre!("Unbound local job"))?,
        &job.plan,
        chrono::Utc::now().timestamp(),
    )?;
    if job.state != JobState::WaitingForLocalResult {
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
            job.id,
            package["exportId"].as_str().unwrap(),
            artifact["artifactId"].as_str().unwrap(),
            artifact["sha256"].as_str().unwrap(),
        );
        let path = format!("local-delegation/{}/{id}", job.id);
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
        files.push(PreparedFile {
            id,
            filename: artifact["filename"].as_str().unwrap().into(),
            provider: provider.clone(),
            path,
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
}
