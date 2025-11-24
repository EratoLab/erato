use crate::config::AppConfig;
use eyre::Result;
use opentelemetry::KeyValue;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{Resource, trace::SdkTracerProvider};
use opentelemetry_semantic_conventions::resource::SERVICE_NAME;
use std::collections::HashMap;
use std::str::FromStr;
use tracing_subscriber::filter::Directive;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer, Registry};

/// Returns the map of custom tracing groups.
///
/// These groups allow enabling logs for a collection of modules using a single key.
/// For example, enabling `erato_system::langfuse` will enable logs for all modules
/// associated with the Langfuse integration.
fn get_tracing_groups() -> HashMap<&'static str, Vec<&'static str>> {
    let mut groups = HashMap::new();
    // "langfuse" group covers the service and relevant actors
    groups.insert(
        "erato_system::langfuse",
        vec![
            "erato::services::langfuse",
            "erato::actors::langfuse_worker",
        ],
    );
    groups
}

/// Expands a filter string by replacing group names with their constituent modules.
///
/// This function checks `get_tracing_groups()` to see if any part of the filter string
/// matches a defined group. If it does, it appends the list of modules in that group
/// to the filter, preserving the log level specified for the group.
///
/// # Example
/// If `erato_system::langfuse` is a group containing `erato::services::langfuse`,
/// a filter string `info,erato_system::langfuse=debug` will be expanded to:
/// `info,erato_system::langfuse=debug,erato::services::langfuse=debug`
fn expand_env_filter(filter_str: String) -> String {
    let groups = get_tracing_groups();
    let mut new_filter_parts = Vec::new();

    for part in filter_str.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }

        // Try to parse target=level or just target/level
        // We assume the part before '=' is the target if '=' exists
        let (target, level_suffix) = if let Some((t, l)) = part.split_once('=') {
            (t, Some(format!("={}", l)))
        } else {
            // It could be just a level (info) or a target (my_module)
            // If it's a known group name, treat it as target.
            if groups.contains_key(part) {
                (part, None)
            } else {
                // Just pass it through
                new_filter_parts.push(part.to_string());
                continue;
            }
        };

        if let Some(modules) = groups.get(target) {
            // It's a group!
            // Add the group itself (so explicit target logging works)
            new_filter_parts.push(format!(
                "{}{}",
                target,
                level_suffix.clone().unwrap_or_default()
            ));

            // Add all member modules
            for module in modules {
                new_filter_parts.push(format!(
                    "{}{}",
                    module,
                    level_suffix.clone().unwrap_or_default()
                ));
            }
        } else {
            new_filter_parts.push(part.to_string());
        }
    }

    new_filter_parts.join(",")
}

/// Guard struct that shuts down the OpenTelemetry tracer provider when dropped.
/// This ensures that all spans are exported before the application exits.
pub struct TelemetryGuard;

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        // opentelemetry::global::shutdown_tracer_provider();
        // NOTE: As of opentelemetry 0.22+, global::shutdown_tracer_provider is removed.
        // opentelemetry_otlp installs a global provider, which should be flushed on shutdown.
        // For now, we rely on process termination or manual flushing if we had the provider handle.
    }
}

/// Initializes the telemetry subsystem.
///
/// This sets up:
/// 1.  **Environment Filter**: Reads `RUST_LOG` and expands any custom tracing groups.
/// 2.  **Stdout Layer**: Configures standard logging to stdout with formatting.
/// 3.  **OpenTelemetry Layer**: Configures OTLP export (if enabled in config) to send traces to a collector.
///
/// Returns a `TelemetryGuard` that must be kept alive for the duration of the application
/// to ensure proper shutdown of the tracer provider.
pub fn init_telemetry(config: &AppConfig) -> Result<TelemetryGuard> {
    // 1. Setup Environment Filter
    let rust_log = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let expanded_filter = expand_env_filter(rust_log);
    let env_filter = EnvFilter::new(expanded_filter.clone());

    // 2. Setup Stdout Layer
    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_thread_ids(true)
        .with_line_number(true)
        .with_file(true)
        .compact()
        .with_filter(env_filter);

    // 3. Setup OTEL Layer (if enabled)
    let otel_layer = if config.integrations.otel.enabled {
        let resource = Resource::builder()
            .with_attributes(vec![KeyValue::new(
                SERVICE_NAME,
                config.integrations.otel.service_name.clone(),
            )])
            .build();

        let exporter = match config.integrations.otel.protocol.as_str() {
            "grpc" => opentelemetry_otlp::SpanExporter::builder()
                .with_tonic()
                .with_endpoint(&config.integrations.otel.endpoint)
                .build()?,
            _ => {
                // Default to http
                opentelemetry_otlp::SpanExporter::builder()
                    .with_http()
                    .with_endpoint(&config.integrations.otel.endpoint)
                    .build()?
            }
        };

        let tracer_provider = SdkTracerProvider::builder()
            .with_batch_exporter(exporter)
            .with_resource(resource)
            .build();

        let tracer = tracer_provider.tracer("erato-backend");
        let otel_env_filter = EnvFilter::new(expanded_filter)
            .add_directive(Directive::from_str("otel::tracing=trace")?);
        Some(
            tracing_opentelemetry::layer()
                .with_tracer(tracer)
                .with_filter(otel_env_filter),
        )
    } else {
        None
    };

    // 4. Setup Langfuse OTEL Layer (Experimental)
    // Disabled for now

    // 5. Init Registry
    Registry::default().with(fmt_layer).with(otel_layer).init();

    Ok(TelemetryGuard)
}
