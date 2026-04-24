use crate::config::{
    FileStorageProviderConfig, StorageProviderAzBlobConfig, StorageProviderS3Config,
    StorageProviderSpecificConfig,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{SecondsFormat, Utc};
use eyre::{OptionExt, Report, WrapErr};
use graph_rs_sdk::GraphClient;
use hmac::{Hmac, Mac};
use opendal::{Operator, Reader, Writer};
use percent_encoding::{AsciiSet, CONTROLS, NON_ALPHANUMERIC, utf8_percent_encode};
use sha2::Sha256;
use std::time::Duration;
use tracing::instrument;
use url::Url;

const CONTENT_DISPOSITION_FILENAME_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'%')
    .add(b'\'')
    .add(b';')
    .add(b'\\');
const CONTENT_DISPOSITION_QUERY_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'+')
    .add(b';')
    .add(b'=')
    .add(b'\\');
const PATH_ENCODE_SET: AsciiSet = NON_ALPHANUMERIC
    .remove(b'/')
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');
const AZBLOB_SERVICE_SAS_VERSION: &str = "2023-11-03";

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
    provider_kind: OpenDalProviderKind,
    azblob_config: Option<StorageProviderAzBlobConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenDalProviderKind {
    S3,
    AzBlob,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContentDispositionKind {
    Attachment,
    Inline,
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
    pub etag: Option<String>,
    pub content_type: Option<String>,
}

impl FileStorage {
    /// Create a FileStorage from configuration (for OpenDAL-based providers).
    pub fn from_config(config: &FileStorageProviderConfig) -> Result<Self, Report> {
        let (opendal_operator, provider_kind) =
            OpenDalStorage::access_from_config_tuple(&config.specific_config()?)?;
        Ok(Self::OpenDal(OpenDalStorage {
            opendal_operator,
            provider_kind,
            azblob_config: config.azblob_config(),
        }))
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

    /// Generate a pre-signed URL for previewing a file.
    pub async fn generate_presigned_preview_url(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        preview_filename: Option<&str>,
    ) -> Result<String, Report> {
        match self {
            Self::OpenDal(storage) => {
                storage
                    .generate_presigned_preview_url(path, expires_in, preview_filename)
                    .await
            }
            Self::Sharepoint(_) => Err(eyre::eyre!(
                "Generating preview URL for Sharepoint storage requires an access token. \
                 Use generate_presigned_preview_url_with_context instead."
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

    /// Generate a preview URL with authentication context.
    pub async fn generate_presigned_preview_url_with_context(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        preview_filename: Option<&str>,
        context: Option<&SharepointContext<'_>>,
    ) -> Result<String, Report> {
        match self {
            Self::OpenDal(storage) => {
                storage
                    .generate_presigned_preview_url(path, expires_in, preview_filename)
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

    pub async fn get_file_content_type_with_context(
        &self,
        path: &str,
        context: Option<&SharepointContext<'_>>,
    ) -> Result<Option<String>, Report> {
        match self {
            Self::OpenDal(storage) => storage.get_file_content_type(path).await,
            Self::Sharepoint(storage) => {
                let ctx = context.ok_or_else(|| {
                    eyre::eyre!("Sharepoint storage requires an access token context")
                })?;
                Ok(storage.get_file_metadata(path, ctx).await?.content_type)
            }
        }
    }
}

impl OpenDalStorage {
    fn access_from_config_tuple(
        config: &StorageProviderSpecificConfig,
    ) -> Result<(Operator, OpenDalProviderKind), Report> {
        match config {
            StorageProviderSpecificConfig::S3(specific_config) => {
                Self::access_from_config_s3(specific_config)
            }
            StorageProviderSpecificConfig::AzBlob(specific_config) => {
                Self::access_from_config_azblob(specific_config)
            }
        }
    }

    fn access_from_config_s3(
        config: &StorageProviderS3Config,
    ) -> Result<(Operator, OpenDalProviderKind), Report> {
        let mut builder = opendal::services::S3::default().bucket(config.bucket.as_str());

        // When using a custom endpoint (e.g., a local S3-compatible service), we need to:
        // 1. NOT enable virtual host style (local S3-compatible services use path-style URLs)
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
        Ok((op, OpenDalProviderKind::S3))
    }

    fn access_from_config_azblob(
        config: &StorageProviderAzBlobConfig,
    ) -> Result<(Operator, OpenDalProviderKind), Report> {
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
        Ok((op, OpenDalProviderKind::AzBlob))
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

    pub async fn get_file_content_type(&self, path: &str) -> Result<Option<String>, Report> {
        Ok(self
            .opendal_operator
            .stat(path)
            .await?
            .content_type()
            .map(ToOwned::to_owned))
    }

    /// Generate a pre-signed URL for downloading a file
    /// The URL will be valid for the specified duration (defaulting to 1 hour if not specified)
    pub async fn generate_presigned_download_url(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        download_filename: Option<&str>,
    ) -> Result<String, Report> {
        self.generate_presigned_url(
            path,
            expires_in,
            download_filename,
            ContentDispositionKind::Attachment,
        )
        .await
    }

    pub async fn generate_presigned_preview_url(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        preview_filename: Option<&str>,
    ) -> Result<String, Report> {
        if self.provider_kind == OpenDalProviderKind::AzBlob
            && let Some(filename) = preview_filename
            && let Some(content_type) = preview_content_type_for_filename(filename)
        {
            return self.generate_azblob_preview_url_with_content_type(
                path,
                expires_in,
                content_type,
            );
        }

        self.generate_presigned_url(
            path,
            expires_in,
            preview_filename,
            ContentDispositionKind::Inline,
        )
        .await
    }

    async fn generate_presigned_url(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        filename: Option<&str>,
        disposition_kind: ContentDispositionKind,
    ) -> Result<String, Report> {
        let duration = expires_in.unwrap_or_else(|| Duration::from_secs(3600)); // Default: 1 hour

        let mut presign = self.opendal_operator.presign_read_with(path, duration);
        let content_disposition =
            build_presign_content_disposition(self.provider_kind, disposition_kind, filename);

        if let Some(content_disposition) = content_disposition.as_deref() {
            presign = presign.override_content_disposition(content_disposition);
        }

        let url = presign.await?;
        Ok(url.uri().to_string())
    }

    fn generate_azblob_preview_url_with_content_type(
        &self,
        path: &str,
        expires_in: Option<Duration>,
        content_type: &str,
    ) -> Result<String, Report> {
        let duration = expires_in.unwrap_or_else(|| Duration::from_secs(3600));
        let config = self
            .azblob_config
            .as_ref()
            .ok_or_eyre("Missing azblob config for preview URL generation")?;
        let account_name = config
            .account_name
            .as_deref()
            .ok_or_eyre("Missing azblob account_name for preview URL generation")?;
        let account_key = config
            .account_key
            .as_deref()
            .ok_or_eyre("Missing azblob account_key for preview URL generation")?;

        build_azblob_service_sas_preview_url(
            config,
            account_name,
            account_key,
            path,
            content_type,
            duration,
        )
    }
}

fn build_azblob_service_sas_preview_url(
    config: &StorageProviderAzBlobConfig,
    account_name: &str,
    account_key: &str,
    path: &str,
    content_type: &str,
    expires_in: Duration,
) -> Result<String, Report> {
    let blob_path = build_azblob_blob_path(config.root.as_deref(), path);
    let encoded_blob_path = utf8_percent_encode(&blob_path, &PATH_ENCODE_SET).to_string();
    let endpoint = config.endpoint.trim_end_matches('/');
    let mut url = Url::parse(&format!(
        "{}/{}/{}",
        endpoint, config.container, encoded_blob_path
    ))?;

    let now = Utc::now();
    let signed_start =
        (now - chrono::TimeDelta::minutes(5)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let signed_expiry =
        (now + chrono::TimeDelta::from_std(expires_in)?).to_rfc3339_opts(SecondsFormat::Secs, true);
    let signed_resource = "b";
    let canonicalized_resource = if url.host_str().unwrap_or_default().contains(account_name) {
        format!("/blob/{}{}", account_name, url.path())
    } else {
        format!("/blob{}", url.path())
    };

    let string_to_sign = [
        "r",
        signed_start.as_str(),
        signed_expiry.as_str(),
        canonicalized_resource.as_str(),
        "",
        "",
        "",
        AZBLOB_SERVICE_SAS_VERSION,
        signed_resource,
        "",
        "",
        "",
        "",
        "",
        "",
        content_type,
    ]
    .join("\n");

    let decoded_key = STANDARD.decode(account_key)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&decoded_key)
        .map_err(|e| eyre::eyre!("Failed to initialize azblob HMAC: {}", e))?;
    mac.update(string_to_sign.as_bytes());
    let signature = STANDARD.encode(mac.finalize().into_bytes());

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("sv", AZBLOB_SERVICE_SAS_VERSION);
        query.append_pair("sp", "r");
        query.append_pair("st", &signed_start);
        query.append_pair("se", &signed_expiry);
        query.append_pair("sr", signed_resource);
        query.append_pair("rsct", content_type);
        query.append_pair("sig", &signature);
    }

    Ok(url.to_string())
}

fn build_azblob_blob_path(root: Option<&str>, path: &str) -> String {
    let path = path.trim_start_matches('/');
    match root
        .map(|root| root.trim_matches('/'))
        .filter(|root| !root.is_empty())
    {
        Some(root) => format!("{}/{}", root, path),
        None => path.to_string(),
    }
}

fn preview_content_type_for_filename(filename: &str) -> Option<&'static str> {
    match filename
        .rsplit('.')
        .next()
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("eml") => Some("message/rfc822"),
        Some("pdf") => Some("application/pdf"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("svg") => Some("image/svg+xml"),
        Some("bmp") => Some("image/bmp"),
        _ => None,
    }
}

fn build_presign_content_disposition(
    provider_kind: OpenDalProviderKind,
    disposition_kind: ContentDispositionKind,
    filename: Option<&str>,
) -> Option<String> {
    if provider_kind == OpenDalProviderKind::AzBlob
        && disposition_kind == ContentDispositionKind::Inline
    {
        return None;
    }

    let header_value = build_content_disposition(disposition_kind, filename);

    match provider_kind {
        OpenDalProviderKind::S3 => Some(header_value),
        OpenDalProviderKind::AzBlob => Some(
            utf8_percent_encode(&header_value, CONTENT_DISPOSITION_QUERY_ENCODE_SET).to_string(),
        ),
    }
}

fn build_content_disposition(
    disposition_kind: ContentDispositionKind,
    filename: Option<&str>,
) -> String {
    let disposition = match disposition_kind {
        ContentDispositionKind::Attachment => "attachment",
        ContentDispositionKind::Inline => "inline",
    };

    let Some(filename) = filename else {
        return disposition.to_string();
    };

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
        "{}; filename=\"{}\"; filename*=UTF-8''{}",
        disposition, escaped_ascii_filename, utf8_filename
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

        Self::parse_file_metadata_response(&item, drive_id, item_id)
    }

    fn parse_file_metadata_response(
        item: &serde_json::Value,
        drive_id: &str,
        item_id: &str,
    ) -> Result<SharepointFileMetadata, Report> {
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

        let etag = item
            .get("eTag")
            .or_else(|| item.get("etag"))
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned);
        let content_type = item
            .get("file")
            .and_then(|file| file.get("mimeType"))
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned);

        Ok(SharepointFileMetadata {
            download_url: download_url.to_string(),
            etag,
            content_type,
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
    use super::ContentDispositionKind;
    use super::OpenDalProviderKind;
    use super::SharepointStorage;
    use super::build_content_disposition;
    use super::build_presign_content_disposition;
    use super::preview_content_type_for_filename;
    use serde_json::json;

    #[test]
    fn content_disposition_uses_original_filename() {
        assert_eq!(
            build_content_disposition(ContentDispositionKind::Attachment, Some("report final.pdf")),
            "attachment; filename=\"report final.pdf\"; filename*=UTF-8''report%20final.pdf"
        );
    }

    #[test]
    fn content_disposition_escapes_problematic_ascii_and_preserves_utf8() {
        assert_eq!(
            build_content_disposition(ContentDispositionKind::Attachment, Some("r\"ep\\ort-ä.pdf")),
            "attachment; filename=\"r\\\"ep\\\\ort-_.pdf\"; filename*=UTF-8''r%22ep%5Cort-%C3%A4.pdf"
        );
    }

    #[test]
    fn s3_presign_uses_raw_content_disposition_header_value() {
        assert_eq!(
            build_presign_content_disposition(
                OpenDalProviderKind::S3,
                ContentDispositionKind::Attachment,
                Some("report final.pdf"),
            ),
            Some(
                "attachment; filename=\"report final.pdf\"; filename*=UTF-8''report%20final.pdf"
                    .to_string(),
            )
        );
    }

    #[test]
    fn azblob_presign_percent_encodes_content_disposition_for_query_string() {
        assert_eq!(
            build_presign_content_disposition(
                OpenDalProviderKind::AzBlob,
                ContentDispositionKind::Attachment,
                Some("report final.pdf"),
            ),
            Some(
                "attachment%3B%20filename%3D%22report%20final.pdf%22%3B%20filename*%3DUTF-8%27%27report%2520final.pdf"
                    .to_string(),
            )
        );
    }

    #[test]
    fn inline_content_disposition_uses_filename_when_present() {
        assert_eq!(
            build_content_disposition(ContentDispositionKind::Inline, Some("report final.pdf")),
            "inline; filename=\"report final.pdf\"; filename*=UTF-8''report%20final.pdf"
        );
    }

    #[test]
    fn azblob_preview_presign_skips_content_disposition_override() {
        assert_eq!(
            build_presign_content_disposition(
                OpenDalProviderKind::AzBlob,
                ContentDispositionKind::Inline,
                None,
            ),
            None
        );
    }

    #[test]
    fn parse_sharepoint_metadata_extracts_etag() {
        let metadata = SharepointStorage::parse_file_metadata_response(
            &json!({
                "@microsoft.graph.downloadUrl": "https://example.test/download",
                "eTag": "\"abc123\""
            }),
            "drive",
            "item",
        )
        .unwrap();

        assert_eq!(metadata.download_url, "https://example.test/download");
        assert_eq!(metadata.etag.as_deref(), Some("\"abc123\""));
        assert_eq!(metadata.content_type, None);
    }

    #[test]
    fn parse_sharepoint_metadata_extracts_content_type() {
        let metadata = SharepointStorage::parse_file_metadata_response(
            &json!({
                "@microsoft.graph.downloadUrl": "https://example.test/download",
                "file": {
                    "mimeType": "message/rfc822"
                }
            }),
            "drive",
            "item",
        )
        .unwrap();

        assert_eq!(metadata.content_type.as_deref(), Some("message/rfc822"));
    }

    #[test]
    fn preview_content_type_for_filename_supports_eml() {
        assert_eq!(
            preview_content_type_for_filename("message.eml"),
            Some("message/rfc822")
        );
    }
}
