//! Binary allocator selection and early reclamation setup, before Tokio starts.

#[cfg(all(
    target_os = "linux",
    not(target_env = "musl"),
    not(feature = "profiling-dial9")
))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

// Linux uses unprefixed symbols with unprefixed_malloc_on_supported_platforms.
// Keep thread creation out of allocator initialization; enable it in init().
// A reference to the first byte has the thin-pointer ABI of C's const char *.
#[cfg(all(
    target_os = "linux",
    not(target_env = "musl"),
    not(feature = "profiling-dial9")
))]
#[unsafe(export_name = "malloc_conf")]
pub static MALLOC_CONF: &u8 = if cfg!(feature = "profiling") {
    &b"background_thread:false,dirty_decay_ms:10000,muzzy_decay_ms:0,prof:true,prof_active:true,lg_prof_sample:19\0"[0]
} else {
    &b"background_thread:false,dirty_decay_ms:10000,muzzy_decay_ms:0\0"[0]
};

#[cfg(all(feature = "profiling-dial9", not(feature = "profiling")))]
#[global_allocator]
static GLOBAL: dial9::memory::Dial9Allocator = dial9::memory::Dial9Allocator::system();

pub fn init() -> eyre::Result<()> {
    #[cfg(all(
        target_os = "linux",
        not(target_env = "musl"),
        not(feature = "profiling-dial9")
    ))]
    {
        use eyre::WrapErr;
        use tikv_jemalloc_ctl::{background_thread, raw};

        // Read before dotenv loading, just like jemalloc's MALLOC_CONF itself.
        let enabled = match std::env::var("ERATO_JEMALLOC_BACKGROUND_THREAD") {
            Ok(value) if value == "false" => false,
            Ok(value) if value == "true" => true,
            Err(std::env::VarError::NotPresent) => true,
            _ => eyre::bail!("ERATO_JEMALLOC_BACKGROUND_THREAD must be true or false"),
        };
        background_thread::write(enabled)
            .wrap_err("Failed to configure jemalloc background purging")?;
        let background = background_thread::read()?;
        // SAFETY: decay controls use ssize_t (isize); config.prof/opt.prof use bool.
        let (dirty, muzzy, profiling) = unsafe {
            let compiled = raw::read::<bool>(b"config.prof\0")?;
            (
                raw::read::<isize>(b"arenas.dirty_decay_ms\0")?,
                raw::read::<isize>(b"arenas.muzzy_decay_ms\0")?,
                compiled && raw::read::<bool>(b"opt.prof\0")?,
            )
        };
        erato::startup_log::info_preinit(format!(
            "Allocator: jemalloc; background_thread={background}, dirty_decay_ms={dirty}, muzzy_decay_ms={muzzy}, heap_profiling={profiling}"
        ));
    }
    Ok(())
}

#[cfg(all(
    test,
    target_os = "linux",
    not(target_env = "musl"),
    not(feature = "profiling-dial9")
))]
mod tests {
    #[test]
    fn allocator_settings_and_live_statistics() {
        use tikv_jemalloc_ctl::{background_thread, epoch, raw, stats};

        super::init().unwrap();
        assert_eq!(
            background_thread::read().unwrap(),
            std::env::var("ERATO_JEMALLOC_BACKGROUND_THREAD").as_deref() != Ok("false")
        );
        if std::env::var_os("MALLOC_CONF").is_none() {
            // SAFETY: jemalloc declares these controls as ssize_t and bool.
            unsafe {
                assert_eq!(
                    raw::read::<isize>(b"arenas.dirty_decay_ms\0").unwrap(),
                    10_000
                );
                assert_eq!(raw::read::<isize>(b"arenas.muzzy_decay_ms\0").unwrap(), 0);
                assert_eq!(
                    raw::read::<bool>(b"config.prof\0").unwrap(),
                    cfg!(feature = "profiling")
                );
                if cfg!(feature = "profiling") {
                    assert!(raw::read::<bool>(b"opt.prof\0").unwrap());
                }
            }
        }
        let allocation = vec![42_u8; 16 * 1024 * 1024];
        std::hint::black_box(&allocation);
        epoch::advance().unwrap();
        assert!(stats::allocated::read().unwrap() >= allocation.len());
        assert!(stats::active::read().unwrap() >= stats::allocated::read().unwrap());
        assert!(stats::resident::read().unwrap() > 0);
        assert!(stats::mapped::read().unwrap() > 0);
        stats::retained::read().unwrap();
    }

    /// Run alone in a release build with no allocator environment overrides.
    /// This probes idle purging, not application performance or an RSS guarantee.
    #[test]
    #[ignore = "allocates 256 MiB and observes idle reclamation for 60 seconds"]
    fn background_reclamation_after_temporary_allocations() {
        use std::time::Duration;
        use tikv_jemalloc_ctl::{epoch, stats};

        super::init().unwrap();
        assert!(tikv_jemalloc_ctl::background_thread::read().unwrap());
        let allocations: Vec<_> = (0..256).map(|_| vec![42_u8; 1024 * 1024]).collect();
        std::hint::black_box(&allocations);
        epoch::advance().unwrap();
        let peak = stats::resident::read().unwrap();
        drop(allocations);
        let mut previous = 0;
        let mut lowest = peak;
        for seconds in [10, 30, 60] {
            std::thread::sleep(Duration::from_secs(seconds - previous));
            previous = seconds;
            epoch::advance().unwrap();
            let resident = stats::resident::read().unwrap();
            lowest = lowest.min(resident);
            let status = std::fs::read_to_string("/proc/self/status").unwrap();
            let rss = status
                .lines()
                .find(|line| line.starts_with("VmRSS:"))
                .unwrap();
            eprintln!(
                "idle={seconds}s peak_allocator_resident={peak} allocator_resident={resident} allocated={} retained={} {rss}",
                stats::allocated::read().unwrap(),
                stats::retained::read().unwrap(),
            );
        }
        assert!(
            lowest < peak,
            "No allocator resident decrease observed during idle"
        );
    }
}
