use crate::config::{
    FileStorageProviderConfig, StorageProviderAzBlobConfig, StorageProviderS3Config,
    StorageProviderSpecificConfig,
};
use eyre::{Report, WrapErr};
use graph_rs_sdk::GraphClient;
use opendal::{Operator, Reader, Writer};
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use std::time::Duration;
use tracing::instrument;

const CONTENT_DISPOSITION_FILENAME_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'%')
    .add(b'\'')
    .add(b';')
    .add(b'\\');

/// File storage backend supporting multiple providers.
///
/// - `OpenDal`: Uses OpenDAL for S3/AzBlob storage (static credentials at construction time)
/// - `Sharepoint`: Uses MS Graph API for Sharepoint/OneDrive (requires access token at request time)
#[derive(Debug, Clone)]
pub enum FileStorage {
    OpenDal(OpenDalStorage),
    Sharepoint(SharepointStorage),
}

/// OpenDAL-based file storage (S3, Azure Blob, etc.)
#[derive(Debug, Clone)]
pub struct OpenDalStorage {
    opendal_operator: Operator,
}

/// Sharepoint/OneDrive file storage via MS Graph API.
///
/// This variant doesn't store credentials - it requires an access token
/// to be passed at request time.
#[derive(Debug, Clone)]
pub struct SharepointStorage {
    // No fields needed - the access token is passed at request time
}

/// Context for Sharepoint operations that require authentication.
pub struct SharepointContext<'a> {
    pub access_token: &'a str,
}

#[derive(Debug, Clone)]
pub struct SharepointFileMetadata {
    pub download_url: String,
}

impl FileStorage {
    /// Create a FileStorage from configuration (for OpenDAL-based providers).
    pub fn from_config(config: &FileStorageProviderConfig) -> Result<Self, Report> {
        let opendal_operator =
            OpenDalStorage::access_from_config_tuple(&config.specific_config()?)?;
        Ok(Self::OpenDal(OpenDalStorage { opendal_operator }))
    }

    /// Create a Sharepoint FileStorage instance.
    ///
    /// This doesn't require configuration as authentication is handled
    /// via the user's access token at request time.
    pub fn sharepoint() -> Self {
        Self::Sharepoint(SharepointStorage {})
    }

    /// Check if this is a Sharepoint storage provider.
    pub fn is_sharepoint(&self) -> bool {
        matches!(self, Self::Sharepoint(_))
    }

    /// Upload a file (only supported for OpenDAL storage).
    pub async fn upload_file_writer(
        &self,
        path: &str,
        content_type: Option<&str>,
    ) -> Result<Writer, Report> {
        match self {
            Self::OpenDal(storage) => storage.upload_file_writer(path, content_type).await,
            Self::Sharepoint(_) => Err(eyre::eyre!(
                "File upload via Sharepoint storage is not supported. \
                 Files should be referenced by driveId and itemId instead."
            )),
        }
    }

    /// Read a file and return a Reader (only supported for OpenDAL storage).
    pub async fn get_file_reader(&self, path: &str) -> Result<Reader, Report> {
        match self {
            Self::OpenDal(storage) => storage.get_file_reader(path).await,
            Self::Sharepoint(_) => Err(eyre::eyre!(
                "Direct file reading via Sharepoint storage requires an access token. \
                 Use read_file_to_bytes_with_context instead."
            )),
        }
    }

    /// Read a complete file from storage and return its contents as a byte array.
    ///
    /// For Sharepoint storage, use `read_file_to_bytes_with_context` instead.
    #[instrument(skip_all)]
    pub async fn read_file_to_bytes(&self, path: &str) -> Result<Vec<u8>, Report> {
        match self {
            Self::OpenDal(storage) => storage.read_file_to_bytes(path).await,
            Self::Sharepoint(_) => Err(eyre::eyre!(
                "Direct file reading via Sharepoint storage requires an access token. \
                 Use read_file_to_bytes_with_context instead."
            )),
        }
    }

    /// Read a file from storage with authentication context.
    ///
    /// For Sharepoint storage, the path should be in the format `{driveId} | {itemId}`.
    #[instrument(skip_all)]
    pub async fn read_file_to_bytes_with_context(
        &self,
        path: &str,
        context: Option<&SharepointContext<'_>>,
    ) -> Result<Vec<u8>, Report> {
        match self {
            Self::OpenDal(storage) => storage.read_file_to_bytes(path).await,
            Self::Sharepoint(storage) => {
                let ctx = context.ok_or_else(|| {
                    eyre::eyre!("Sharepoint storage requires an access token context")
                })?;
                storage.read_file_to_bytes(path, ctx).await
            }
        }
    }

    /// Generate a pre-signed URL for downloading a file.
    ///
    /// For Sharepoint storage, use `generate_presigned_download_url_with_context` instead.
    pub async fn generate_presigned_download_url(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        download_filename: Option<&str>,
    ) -> Result<String, Report> {
        match self {
            Self::OpenDal(storage) => {
                storage
                    .generate_presigned_download_url(path, expires_in, download_filename)
                    .await
            }
            Self::Sharepoint(_) => Err(eyre::eyre!(
                "Generating download URL for Sharepoint storage requires an access token. \
                 Use generate_presigned_download_url_with_context instead."
            )),
        }
    }

    /// Generate a download URL with authentication context.
    ///
    /// For Sharepoint storage, the path should be in the format `{driveId} | {itemId}`.
    pub async fn generate_presigned_download_url_with_context(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        download_filename: Option<&str>,
        context: Option<&SharepointContext<'_>>,
    ) -> Result<String, Report> {
        match self {
            Self::OpenDal(storage) => {
                storage
                    .generate_presigned_download_url(path, expires_in, download_filename)
                    .await
            }
            Self::Sharepoint(storage) => {
                let ctx = context.ok_or_else(|| {
                    eyre::eyre!("Sharepoint storage requires an access token context")
                })?;
                storage.generate_download_url(path, ctx).await
            }
        }
    }

    pub async fn get_sharepoint_file_metadata_with_context(
        &self,
        path: &str,
        context: Option<&SharepointContext<'_>>,
    ) -> Result<SharepointFileMetadata, Report> {
        match self {
            Self::Sharepoint(storage) => {
                let ctx = context.ok_or_else(|| {
                    eyre::eyre!("Sharepoint storage requires an access token context")
                })?;
                storage.get_file_metadata(path, ctx).await
            }
            Self::OpenDal(_) => Err(eyre::eyre!(
                "Sharepoint file metadata is only available for Sharepoint storage"
            )),
        }
    }
}

impl OpenDalStorage {
    fn access_from_config_tuple(
        config: &StorageProviderSpecificConfig,
    ) -> Result<Operator, Report> {
        match config {
            StorageProviderSpecificConfig::S3(specific_config) => {
                Self::access_from_config_s3(specific_config)
            }
            StorageProviderSpecificConfig::AzBlob(specific_config) => {
                Self::access_from_config_azblob(specific_config)
            }
        }
    }

    fn access_from_config_s3(config: &StorageProviderS3Config) -> Result<Operator, Report> {
        let mut builder = opendal::services::S3::default().bucket(config.bucket.as_str());

        // When using a custom endpoint (e.g., MinIO), we need to:
        // 1. NOT enable virtual host style (MinIO uses path-style URLs)
        // 2. Disable loading AWS credentials from environment/config files
        if let Some(val) = &config.endpoint {
            builder = builder.endpoint(val).disable_config_load();
        }

        if let Some(val) = &config.root {
            builder = builder.root(val);
        }
        if let Some(val) = &config.region {
            builder = builder.region(val);
        }
        if let Some(val) = &config.access_key_id {
            builder = builder.access_key_id(val);
        }
        if let Some(val) = &config.secret_access_key {
            builder = builder.secret_access_key(val);
        }

        let op: Operator = Operator::new(builder)?.finish();
        Ok(op)
    }

    fn access_from_config_azblob(config: &StorageProviderAzBlobConfig) -> Result<Operator, Report> {
        let mut builder = opendal::services::Azblob::default()
            .container(config.container.as_str())
            .endpoint(config.endpoint.as_str());
        if let Some(val) = &config.root {
            builder = builder.root(val);
        }
        if let Some(val) = &config.account_name {
            builder = builder.account_name(val);
        }
        if let Some(val) = &config.account_key {
            builder = builder.account_key(val);
        }

        let op: Operator = Operator::new(builder)?.finish();
        Ok(op)
    }

    pub async fn upload_file_writer(
        &self,
        path: &str,
        content_type: Option<&str>,
    ) -> Result<Writer, Report> {
        let mut writer = self.opendal_operator.writer_with(path);
        if let Some(content_type) = content_type {
            writer = writer.content_type(content_type);
        }
        Ok(writer.await?)
    }

    /// Read a file from the storage and return a Reader
    pub async fn get_file_reader(&self, path: &str) -> Result<Reader, Report> {
        Ok(self.opendal_operator.reader(path).await?)
    }

    /// Read a complete file from storage and return its contents as a byte array
    pub async fn read_file_to_bytes(&self, path: &str) -> Result<Vec<u8>, Report> {
        let reader = self.get_file_reader(path).await?;
        let mut buffer = Vec::new();
        reader.read_into(&mut buffer, ..).await?;
        Ok(buffer)
    }

    /// Generate a pre-signed URL for downloading a file
    /// The URL will be valid for the specified duration (defaulting to 1 hour if not specified)
    pub async fn generate_presigned_download_url(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        download_filename: Option<&str>,
    ) -> Result<String, Report> {
        let duration = expires_in.unwrap_or_else(|| Duration::from_secs(3600)); // Default: 1 hour

        let mut presign = self.opendal_operator.presign_read_with(path, duration);
        let content_disposition = download_filename.map(build_attachment_content_disposition);

        if let Some(content_disposition) = content_disposition.as_deref() {
            presign = presign.override_content_disposition(content_disposition);
        }

        let url = presign.await?;
        Ok(url.uri().to_string())
    }
}

fn build_attachment_content_disposition(filename: &str) -> String {
    let escaped_ascii_filename = filename
        .chars()
        .map(|ch| match ch {
            '"' => "\\\"".to_string(),
            '\\' => "\\\\".to_string(),
            ch if ch.is_ascii() && !ch.is_ascii_control() => ch.to_string(),
            _ => "_".to_string(),
        })
        .collect::<String>();
    let utf8_filename =
        utf8_percent_encode(filename, CONTENT_DISPOSITION_FILENAME_ENCODE_SET).to_string();

    format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        escaped_ascii_filename, utf8_filename
    )
}

impl SharepointStorage {
    /// Parse a Sharepoint file path in the format `{driveId} | {itemId}`.
    fn parse_path(path: &str) -> Result<(&str, &str), Report> {
        let parts: Vec<&str> = path.split(" | ").collect();
        if parts.len() != 2 {
            return Err(eyre::eyre!(
                "Invalid Sharepoint path format. Expected '{{driveId}} | {{itemId}}', got: {}",
                path
            ));
        }
        Ok((parts[0], parts[1]))
    }

    /// Create a GraphClient with the provided access token.
    fn create_graph_client(access_token: &str) -> GraphClient {
        GraphClient::new(access_token)
    }

    /// Read a file from Sharepoint/OneDrive and return its contents as bytes.
    ///
    /// The path should be in the format `{driveId} | {itemId}`.
    pub async fn read_file_to_bytes(
        &self,
        path: &str,
        context: &SharepointContext<'_>,
    ) -> Result<Vec<u8>, Report> {
        let metadata = self.get_file_metadata(path, context).await?;

        // Download the file content
        let response = reqwest::get(&metadata.download_url)
            .await
            .wrap_err("Failed to download file from Sharepoint")?;

        if !response.status().is_success() {
            return Err(eyre::eyre!(
                "Failed to download file from Sharepoint: HTTP {}",
                response.status()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .wrap_err("Failed to read file content from Sharepoint")?;

        Ok(bytes.to_vec())
    }

    /// Generate a download URL for a Sharepoint file.
    ///
    /// The path should be in the format `{driveId} | {itemId}`.
    pub async fn generate_download_url(
        &self,
        path: &str,
        context: &SharepointContext<'_>,
    ) -> Result<String, Report> {
        Ok(self.get_file_metadata(path, context).await?.download_url)
    }

    pub async fn get_file_metadata(
        &self,
        path: &str,
        context: &SharepointContext<'_>,
    ) -> Result<SharepointFileMetadata, Report> {
        let (drive_id, item_id) = Self::parse_path(path)?;
        let client = Self::create_graph_client(context.access_token);

        self.get_file_metadata_internal(&client, drive_id, item_id, context.access_token)
            .await
    }

    /// Internal helper to get the download URL for a drive item.
    async fn get_file_metadata_internal(
        &self,
        client: &GraphClient,
        drive_id: &str,
        item_id: &str,
        _access_token: &str,
    ) -> Result<SharepointFileMetadata, Report> {
        // Use the MS Graph API to get the drive item with download URL
        let response = client
            .drive(drive_id)
            .item(item_id)
            .get_items()
            .send()
            .await
            .wrap_err("Failed to get drive item from MS Graph API")?;

        let item: serde_json::Value = response
            .json()
            .await
            .wrap_err("Failed to parse MS Graph API response")?;

        // Extract the download URL from the response
        // The download URL is in @microsoft.graph.downloadUrl
        let download_url = item
            .get("@microsoft.graph.downloadUrl")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                eyre::eyre!(
                    "No download URL found in MS Graph API response for drive {} item {}",
                    drive_id,
                    item_id
                )
            })?;

        Ok(SharepointFileMetadata {
            download_url: download_url.to_string(),
        })
    }
}

/// The well-known provider ID for Sharepoint file uploads.
pub const SHAREPOINT_PROVIDER_ID: &str = "integrations_sharepoint";

/// Best-effort classifier for Sharepoint/OneDrive permission/access failures.
///
/// We use this to avoid failing entire assistant/chat flows when a shared assistant
/// contains a cloud file that the current user cannot access in MS Graph.
pub fn is_missing_permissions_error(error: &Report) -> bool {
    let msg = error.to_string().to_lowercase();
    msg.contains("failed to parse ms graph api response")
        || msg.contains("failed to get drive item from ms graph api")
        || msg.contains("no download url found in ms graph api response")
        || msg.contains("sharepoint storage requires an access token context")
        || msg.contains("http 401")
        || msg.contains("http 403")
        || msg.contains("unauthorized")
        || msg.contains("forbidden")
        || msg.contains("access denied")
        || msg.contains("insufficient")
        || msg.contains("permission")
}

#[cfg(test)]
mod tests {
    use super::build_attachment_content_disposition;

    #[test]
    fn content_disposition_uses_original_filename() {
        assert_eq!(
            build_attachment_content_disposition("report final.pdf"),
            "attachment; filename=\"report final.pdf\"; filename*=UTF-8''report%20final.pdf"
        );
    }

    #[test]
    fn content_disposition_escapes_problematic_ascii_and_preserves_utf8() {
        assert_eq!(
            build_attachment_content_disposition("r\"ep\\ort-ä.pdf"),
            "attachment; filename=\"r\\\"ep\\\\ort-_.pdf\"; filename*=UTF-8''r%22ep%5Cort-%C3%A4.pdf"
        );
    }
}
