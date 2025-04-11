use crate::config::{
    FileStorageProviderConfig, StorageProviderAzBlobConfig, StorageProviderS3Config,
    StorageProviderSpecificConfig,
};
use eyre::{eyre, Report};
use opendal::{Operator, Reader, Writer};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct FileStorage {
    opendal_operator: Operator,
}

impl FileStorage {
    pub fn from_config(config: &FileStorageProviderConfig) -> Result<Self, Report> {
        let opendal_operator = Self::access_from_config_tuple(&config.specific_config()?)?;
        Ok(Self { opendal_operator })
    }

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
        if let Some(val) = &config.endpoint {
            builder = builder.endpoint(val);
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
    ) -> Result<String, Report> {
        let duration = expires_in.unwrap_or_else(|| Duration::from_secs(3600)); // Default: 1 hour

        // Check if the storage provider supports presigned URLs
        if !self.opendal_operator.info().full_capability().presign_read {
            return Err(eyre!("Storage provider does not support presigned URLs"));
        }

        let url = self.opendal_operator.presign_read(path, duration).await?;
        Ok(url.uri().to_string())
    }
}
