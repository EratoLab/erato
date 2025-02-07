use config::{Config, ConfigError, Environment};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
pub struct AppConfig {
    pub address: String,
    pub port: i32,
}

impl AppConfig {
    pub fn new() -> Result<Self, ConfigError> {
        let s = Config::builder()
            .set_default("http_host", "127.0.0.1")?
            .set_default("http_port", "3130")?
            .add_source(Environment::default())
            .build()?;

        // You can deserialize (and thus freeze) the entire configuration as
        s.try_deserialize()
    }
}
