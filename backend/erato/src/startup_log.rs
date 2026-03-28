use std::sync::{Mutex, OnceLock};

use crate::config::{LoggingConfig, LoggingFormat};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupLogLevel {
    Info,
    Warn,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StartupLogEntry {
    level: StartupLogLevel,
    message: String,
}

fn startup_log_buffer() -> &'static Mutex<Vec<StartupLogEntry>> {
    static BUFFER: OnceLock<Mutex<Vec<StartupLogEntry>>> = OnceLock::new();
    BUFFER.get_or_init(|| Mutex::new(Vec::new()))
}

fn emit_preinit(level: StartupLogLevel, message: String) {
    match level {
        StartupLogLevel::Info => println!("{message}"),
        StartupLogLevel::Warn => eprintln!("{message}"),
    }

    startup_log_buffer()
        .lock()
        .expect("startup log buffer lock poisoned")
        .push(StartupLogEntry { level, message });
}

pub fn info_preinit(message: String) {
    emit_preinit(StartupLogLevel::Info, message);
}

pub fn warn_preinit(message: String) {
    emit_preinit(StartupLogLevel::Warn, message);
}

pub fn reemit_buffered_logs_if_json(logging: &LoggingConfig) {
    if logging.format != LoggingFormat::Json {
        startup_log_buffer()
            .lock()
            .expect("startup log buffer lock poisoned")
            .clear();
        return;
    }

    let buffered = startup_log_buffer()
        .lock()
        .expect("startup log buffer lock poisoned")
        .drain(..)
        .collect::<Vec<_>>();

    for entry in buffered {
        match entry.level {
            StartupLogLevel::Info => tracing::info!(bootstrap = true, "{}", entry.message),
            StartupLogLevel::Warn => tracing::warn!(bootstrap = true, "{}", entry.message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        StartupLogEntry, StartupLogLevel, reemit_buffered_logs_if_json, startup_log_buffer,
    };
    use crate::config::{LoggingConfig, LoggingFormat};

    #[test]
    fn clears_buffer_for_plain_logging() {
        let buffer = startup_log_buffer();
        {
            let mut guard = buffer.lock().expect("startup log buffer lock poisoned");
            guard.clear();
            guard.push(StartupLogEntry {
                level: StartupLogLevel::Info,
                message: "hello".to_string(),
            });
        }

        reemit_buffered_logs_if_json(&LoggingConfig {
            format: LoggingFormat::Plain,
        });

        assert!(
            buffer
                .lock()
                .expect("startup log buffer lock poisoned")
                .is_empty()
        );
    }
}
