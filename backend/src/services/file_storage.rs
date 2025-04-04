use eyre::Report;
use opendal::{Operator, Writer};
use crate::config::{FileStorageProviderConfig, StorageProviderAzBlobConfig, StorageProviderS3Config, StorageProviderSpecificConfig};

#[derive(Debug, Clone)]
pub struct FileStorage {
    opendal_operator: Operator,
}

impl FileStorage {
    pub fn from_config(config: &FileStorageProviderConfig) -> Result<Self, Report> {
        let opendal_operator = Self::access_from_config_tuple(&config.specific_config()?)?;
        Ok(Self {
            opendal_operator,
        })
    }

    fn access_from_config_tuple(config: &StorageProviderSpecificConfig) -> Result<Operator, Report> {
        match config {
            StorageProviderSpecificConfig::S3(specific_config) => Self::access_from_config_s3(specific_config),
            StorageProviderSpecificConfig::AzBlob(specific_config) => Self::access_from_config_azblob(specific_config),
        }
    }

    fn access_from_config_s3(config: &StorageProviderS3Config) -> Result<Operator, Report> {
        let mut builder = opendal::services::S3::default()
            .bucket(config.bucket.as_str());
        if let Some(val) = &config.endpoint {
            builder = builder.endpoint(val);
        }
        if let Some(val) = &config.root {
            builder = builder.root(val);
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

    fn access_from_config_azblob(_config: &StorageProviderAzBlobConfig) -> Result<Operator, Report> {
        unimplemented!()
    }

    pub async fn upload_file_writer(&self, path: &str) -> Result<Writer, Report> {
        let writer = self.opendal_operator.writer(path).await?;
        Ok(writer)
    }
}