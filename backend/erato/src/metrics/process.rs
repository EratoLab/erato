//! Process and allocator totals complement logical payload gauges. They overlap;
//! summing them would double count memory.

#[cfg(target_os = "linux")]
pub(super) fn start_reporter() {
    use metrics::{Unit, counter, describe_counter, describe_gauge};

    describe_gauge!(
        "erato_process_memory_bytes",
        Unit::Bytes,
        "Linux process memory from /proc/self/status; kinds overlap and must not be summed."
    );
    describe_counter!(
        "erato_memory_stats_collection_errors_total",
        "Failed process or allocator memory samples."
    );
    #[cfg(feature = "profiling")]
    describe_gauge!(
        "erato_allocator_memory_bytes",
        Unit::Bytes,
        "Jemalloc statistics after advancing the epoch; kinds overlap and must not be summed."
    );

    tokio::spawn(async {
        let mut interval = tokio::time::interval(super::MEMORY_STATS_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            // Filesystem reads and allocator locks must not block Tokio workers.
            if let Err(error) = tokio::task::spawn_blocking(report_once).await {
                counter!("erato_memory_stats_collection_errors_total", "source" => "reporter")
                    .increment(1);
                tracing::warn!(%error, "Memory statistics reporter failed");
            }
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub(super) fn start_reporter() {}

#[cfg(target_os = "linux")]
fn report_once() {
    use metrics::{counter, gauge};

    match std::fs::read_to_string("/proc/self/status")
        .and_then(|status| parse_process_memory(&status))
    {
        Ok(samples) => {
            for (kind, bytes) in samples {
                gauge!("erato_process_memory_bytes", "kind" => kind).set(bytes as f64);
            }
        }
        Err(error) => {
            counter!("erato_memory_stats_collection_errors_total", "source" => "process")
                .increment(1);
            tracing::warn!(%error, "Unable to collect process memory statistics");
        }
    }

    #[cfg(feature = "profiling")]
    if let Err(error) = report_allocator() {
        counter!("erato_memory_stats_collection_errors_total", "source" => "jemalloc").increment(1);
        tracing::warn!(%error, "Unable to collect allocator memory statistics");
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_process_memory(status: &str) -> std::io::Result<Vec<(&'static str, u64)>> {
    use std::io::{Error, ErrorKind};

    let mut samples = Vec::new();
    for line in status.lines() {
        let Some((field, value)) = line.split_once(':') else {
            continue;
        };
        let kind = match field {
            "VmRSS" => "resident",
            "RssAnon" => "resident_anonymous",
            "RssFile" => "resident_file",
            "RssShmem" => "resident_shared",
            "VmHWM" => "peak_resident",
            "VmSize" => "virtual",
            _ => continue,
        };
        let mut parts = value.split_whitespace();
        let bytes = parts
            .next()
            .and_then(|number| number.parse::<u64>().ok())
            .and_then(|kilobytes| kilobytes.checked_mul(1024))
            .filter(|_| parts.next() == Some("kB") && parts.next().is_none())
            .ok_or_else(|| Error::new(ErrorKind::InvalidData, "Invalid process memory field"))?;
        samples.push((kind, bytes));
    }
    if !samples.iter().any(|(kind, _)| *kind == "resident") {
        return Err(Error::new(ErrorKind::InvalidData, "Missing process RSS"));
    }
    Ok(samples)
}

#[cfg(all(target_os = "linux", feature = "profiling"))]
fn report_allocator() -> Result<(), tikv_jemalloc_ctl::Error> {
    use metrics::gauge;
    use tikv_jemalloc_ctl::{epoch, stats};

    epoch::advance()?;
    // Read every value before publishing so a failed sample cannot mix epochs.
    let samples = [
        ("allocated", stats::allocated::read()?),
        ("active", stats::active::read()?),
        ("resident", stats::resident::read()?),
        ("mapped", stats::mapped::read()?),
        ("retained", stats::retained::read()?),
        ("metadata", stats::metadata::read()?),
    ];
    super::components::report(samples[0].1)?;
    for (kind, bytes) in samples {
        gauge!("erato_allocator_memory_bytes", "kind" => kind).set(bytes as f64);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_process_memory;

    #[test]
    fn process_memory_converts_kernel_kilobytes_and_ignores_unrelated_fields() {
        let samples = parse_process_memory(
            "Name:\terato\nVmSize:\t5000 kB\nVmHWM: 2000 kB\nVmRSS: 1500 kB\nRssAnon: 1000 kB\nRssFile: 400 kB\nRssShmem: 100 kB\nThreads: 16\n",
        )
        .unwrap();
        assert_eq!(
            samples,
            vec![
                ("virtual", 5_120_000),
                ("peak_resident", 2_048_000),
                ("resident", 1_536_000),
                ("resident_anonymous", 1_024_000),
                ("resident_file", 409_600),
                ("resident_shared", 102_400),
            ]
        );
    }

    #[test]
    fn invalid_or_unavailable_process_memory_is_not_reported_as_zero() {
        for status in [
            "Name: erato\n",
            "VmRSS: nope kB\n",
            "VmRSS: 12 MB\n",
            "VmRSS: 12\n",
            "VmRSS: 12 kB trailing\n",
            "VmRSS: 18446744073709551615 kB\n",
        ] {
            assert!(parse_process_memory(status).is_err(), "{status}");
        }
        assert_eq!(
            parse_process_memory("VmRSS: 0 kB").unwrap(),
            vec![("resident", 0)]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_current_linux_process() {
        let status = std::fs::read_to_string("/proc/self/status").unwrap();
        let samples = parse_process_memory(&status).unwrap();
        assert!(
            samples
                .iter()
                .any(|(kind, bytes)| *kind == "resident" && *bytes > 0)
        );
    }
}
