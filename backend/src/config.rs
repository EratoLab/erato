use config::{Config, ConfigError, Environment};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone)]
pub struct AppConfig {
    // The HTTP host to listen on.
    // Defaults to `127.0.0.1`.
    pub http_host: String,
    // The HTTP port to listen on.
    // Defaults to `3130`.
    pub http_port: i32,
    // Where to find the static frontend files to serve.
    // Defaults to `./public`
    pub frontend_bundle_path: String,
    pub database_url: String,
}

impl AppConfig {
    pub fn new() -> Result<Self, ConfigError> {
        let s = Config::builder()
            .set_default("http_host", "127.0.0.1")?
            .set_default("http_port", "3130")?
            .set_default("frontend_bundle_path", "./public")?
            .add_source(Environment::default())
            .build()?;

        // You can deserialize (and thus freeze) the entire configuration as
        s.try_deserialize()
    }
}
