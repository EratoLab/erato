use sqlx::postgres::PgListener;
use std::time::Duration;
use tokio::task::JoinHandle;

const CONFIGURATION_CHANGED_CHANNEL: &str = "configuration_changed";
const INITIAL_RETRY_DELAY: Duration = Duration::from_secs(1);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);

/// Listens for configuration changes published by other Erato services.
///
/// The listener is deliberately independent from configuration loading for now. A
/// notification only produces an info log; handling the reload will be added in a
/// follow-up.
#[derive(Debug)]
pub struct ConfigurationReloadListener {
    task: JoinHandle<()>,
}

impl ConfigurationReloadListener {
    /// Start the listener in a resilient background task.
    pub fn spawn(database_url: String) -> Self {
        let task = tokio::spawn(async move {
            run_with_retries(database_url).await;
        });

        Self { task }
    }
}

impl Drop for ConfigurationReloadListener {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn run_with_retries(database_url: String) {
    let mut retry_delay = INITIAL_RETRY_DELAY;

    loop {
        match listen_for_configuration_changes(&database_url).await {
            Ok(()) => {
                tracing::warn!(
                    channel = CONFIGURATION_CHANGED_CHANNEL,
                    "Configuration reload notification listener stopped"
                );
            }
            Err(error) => {
                tracing::warn!(
                    channel = CONFIGURATION_CHANGED_CHANNEL,
                    %error,
                    "Configuration reload notification listener failed"
                );
            }
        }

        tracing::info!(
            channel = CONFIGURATION_CHANGED_CHANNEL,
            retry_in_seconds = retry_delay.as_secs(),
            "Retrying configuration reload notification listener"
        );
        tokio::time::sleep(retry_delay).await;
        retry_delay = (retry_delay * 2).min(MAX_RETRY_DELAY);
    }
}

async fn listen_for_configuration_changes(database_url: &str) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect(database_url).await?;
    listener.listen(CONFIGURATION_CHANGED_CHANNEL).await?;

    tracing::info!(
        channel = CONFIGURATION_CHANGED_CHANNEL,
        "Listening for configuration reload notifications"
    );

    loop {
        let notification = listener.recv().await?;
        tracing::info!(
            channel = notification.channel(),
            "Received configuration reload notification; reload is not implemented yet"
        );
    }
}
