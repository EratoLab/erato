//! Optional allocation-origin attribution for opaque library objects. Dedicated
//! jemalloc arenas remember allocations after scopes return and across threads.
//! Ordinary builds use only the owner-based payload metrics in `memory`.

use std::future::Future;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Component {
    ApiSchema,
    HttpRouting,
    MetricsExporter,
    Startup,
    HttpRequest,
    FileUpload,
    FileBytes,
    FileText,
    FileParser,
    AttachmentPlanning,
    TokenizerState,
    TokenizerWork,
    McpClient,
    McpSession,
    ChatPreparation,
    ProviderRequest,
    Policy,
    RuntimeDistribution,
    ProfileRender,
}

impl Component {
    pub const ALL: [Self; 19] = [
        Self::ApiSchema,
        Self::HttpRouting,
        Self::MetricsExporter,
        Self::Startup,
        Self::HttpRequest,
        Self::FileUpload,
        Self::FileBytes,
        Self::FileText,
        Self::FileParser,
        Self::AttachmentPlanning,
        Self::TokenizerState,
        Self::TokenizerWork,
        Self::McpClient,
        Self::McpSession,
        Self::ChatPreparation,
        Self::ProviderRequest,
        Self::Policy,
        Self::RuntimeDistribution,
        Self::ProfileRender,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::ApiSchema => "api_schema",
            Self::HttpRouting => "http_routing",
            Self::MetricsExporter => "metrics_exporter",
            Self::Startup => "startup_state",
            Self::HttpRequest => "http_request",
            Self::FileUpload => "file_upload",
            Self::FileBytes => "file_bytes",
            Self::FileText => "file_text",
            Self::FileParser => "file_parser",
            Self::AttachmentPlanning => "attachment_planning",
            Self::TokenizerState => "tokenizer_state",
            Self::TokenizerWork => "tokenizer_work",
            Self::McpClient => "mcp_http_client",
            Self::McpSession => "mcp_session",
            Self::ChatPreparation => "chat_preparation",
            Self::ProviderRequest => "provider_request",
            Self::Policy => "policy_engine",
            Self::RuntimeDistribution => "runtime_distribution",
            Self::ProfileRender => "profile_rendering",
        }
    }
}

pub fn sync<T>(component: Component, operation: impl FnOnce() -> T) -> T {
    #[cfg(all(feature = "profiling", target_os = "linux"))]
    let _guard = implementation::Scope::enter(component);
    #[cfg(not(all(feature = "profiling", target_os = "linux")))]
    let _ = component;
    operation()
}

/// Carry an explicit origin into a blocking worker instead of inheriting the
/// dispatching thread's allocator state.
pub fn blocking<T>(component: Component, operation: impl FnOnce() -> T) -> impl FnOnce() -> T {
    move || sync(component, operation)
}

/// Scope each poll, never a whole await: the future may migrate between workers.
pub fn scope<F: Future>(component: Component, future: F) -> impl Future<Output = F::Output> {
    // Allocate before constructing the async wrapper: storing large request
    // futures inline here multiplies their stack footprint at nested scopes.
    let mut future = Box::pin(future);
    std::future::poll_fn(move |context| {
        #[cfg(all(feature = "profiling", target_os = "linux"))]
        let _guard = implementation::Scope::enter(component);
        #[cfg(not(all(feature = "profiling", target_os = "linux")))]
        let _ = component;
        future.as_mut().poll(context)
    })
}

pub fn init(enabled: bool) -> eyre::Result<()> {
    #[cfg(all(feature = "profiling", target_os = "linux"))]
    implementation::init(enabled)?;
    #[cfg(not(all(feature = "profiling", target_os = "linux")))]
    let _ = enabled;
    Ok(())
}

#[cfg(all(feature = "profiling", target_os = "linux"))]
pub use implementation::{Sample, snapshot};

#[cfg(all(feature = "profiling", target_os = "linux"))]
pub(super) fn report(allocated: usize) -> Result<(), tikv_jemalloc_ctl::Error> {
    implementation::report(allocated)
}

#[cfg(all(feature = "profiling", target_os = "linux"))]
mod implementation {
    use super::Component;
    use metrics::{Unit, counter, describe_counter, describe_gauge, gauge};
    use std::marker::PhantomData;
    use std::rc::Rc;
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tikv_jemalloc_ctl::{Error, raw};

    static ARENAS: OnceLock<[u32; Component::ALL.len()]> = OnceLock::new();
    static SCOPE_ERRORS: AtomicU64 = AtomicU64::new(0);

    pub(super) fn init(enabled: bool) -> eyre::Result<()> {
        if !enabled || ARENAS.get().is_some() {
            return Ok(());
        }
        let mut arenas = [0; Component::ALL.len()];
        for arena in &mut arenas {
            // SAFETY: arenas.create returns C unsigned (u32), as documented by jemalloc.
            *arena = unsafe { raw::read::<u32>(b"arenas.create\0") }?;
        }
        ARENAS
            .set(arenas)
            .map_err(|_| eyre::eyre!("Component memory attribution initialized twice"))?;
        describe_gauge!(
            "erato_component_memory_bytes",
            Unit::Bytes,
            "Jemalloc allocation-origin statistics for named components; kinds overlap and payload gauges must not be added."
        );
        describe_gauge!(
            "erato_component_memory_unattributed_bytes",
            Unit::Bytes,
            "Live jemalloc allocations outside instrumented component arenas; not counted as named coverage."
        );
        describe_counter!(
            "erato_component_memory_scope_errors_total",
            "Failed component arena switches or restores."
        );
        Ok(())
    }

    // A guard must stay on its creating thread. Async scopes create and drop one
    // inside poll; no thread-local allocator state survives an await or unwind.
    pub(super) struct Scope {
        arena: u32,
        cache: bool,
        _same_thread: PhantomData<Rc<()>>,
    }

    impl Scope {
        pub(super) fn enter(component: Component) -> Option<Self> {
            let arenas = ARENAS.get()?;
            // SAFETY: thread.arena is unsigned; thread.tcache.enabled is C bool.
            let state = unsafe {
                raw::read::<u32>(b"thread.arena\0").and_then(|arena| {
                    raw::read::<bool>(b"thread.tcache.enabled\0").map(|cache| (arena, cache))
                })
            };
            let Ok((arena, cache)) = state else {
                SCOPE_ERRORS.fetch_add(1, Ordering::Relaxed);
                return None;
            };
            let guard = Self {
                arena,
                cache,
                _same_thread: PhantomData,
            };
            // Tcache bins otherwise reuse allocations from another arena and
            // obscure their origin. Disabling is diagnostic-only and opt-in.
            let result = (|| -> Result<(), Error> {
                // SAFETY: documented C bool and unsigned mallctl values.
                unsafe {
                    if cache {
                        raw::write(b"thread.tcache.enabled\0", false)?;
                    }
                    raw::write(b"thread.arena\0", arenas[component as usize])
                }
            })();
            if result.is_err() {
                SCOPE_ERRORS.fetch_add(1, Ordering::Relaxed);
                drop(guard);
                return None;
            }
            Some(guard)
        }
    }

    impl Drop for Scope {
        fn drop(&mut self) {
            // SAFETY: restore exactly the C unsigned/bool values read on entry.
            // Never panic in Drop; expose failures in the telemetry instead.
            let arena = unsafe { raw::write(b"thread.arena\0", self.arena) };
            let cache = unsafe { raw::write(b"thread.tcache.enabled\0", self.cache) };
            if arena.is_err() || cache.is_err() {
                SCOPE_ERRORS.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    #[derive(Debug)]
    pub struct Sample {
        pub component: Component,
        pub allocated: usize,
        pub active: usize,
        pub dirty: usize,
        pub metadata: usize,
        pub resident: usize,
        pub retained: usize,
    }

    fn read_stat(arena: u32, field: &str) -> Result<usize, Error> {
        let name = format!("stats.arenas.{arena}.{field}\0");
        // SAFETY: every caller uses a documented size_t arena statistic.
        unsafe { raw::read::<usize>(name.as_bytes()) }
    }

    /// Caller advances the epoch once for a consistent global/component sample.
    pub fn snapshot() -> Result<Vec<Sample>, Error> {
        let Some(arenas) = ARENAS.get() else {
            return Ok(Vec::new());
        };
        // SAFETY: arenas.page is size_t.
        let page = unsafe { raw::read::<usize>(b"arenas.page\0") }?;
        Component::ALL
            .into_iter()
            .zip(arenas)
            .map(|(component, &arena)| {
                Ok(Sample {
                    component,
                    allocated: read_stat(arena, "small.allocated")?
                        + read_stat(arena, "large.allocated")?,
                    active: read_stat(arena, "pactive")? * page,
                    dirty: read_stat(arena, "pdirty")? * page,
                    metadata: read_stat(arena, "base")? + read_stat(arena, "internal")?,
                    resident: read_stat(arena, "resident")?,
                    retained: read_stat(arena, "retained")?,
                })
            })
            .collect()
    }

    pub(super) fn report(allocated: usize) -> Result<(), Error> {
        if ARENAS.get().is_none() {
            return Ok(());
        }
        let samples = snapshot()?;
        let named: usize = samples.iter().map(|sample| sample.allocated).sum();
        for sample in samples {
            for (kind, bytes) in [
                ("allocated", sample.allocated),
                ("active", sample.active),
                ("dirty", sample.dirty),
                ("metadata", sample.metadata),
                ("resident", sample.resident),
                ("retained", sample.retained),
            ] {
                gauge!("erato_component_memory_bytes", "component" => sample.component.name(), "kind" => kind).set(bytes as f64);
            }
        }
        gauge!("erato_component_memory_unattributed_bytes", "kind" => "allocated")
            .set(allocated.saturating_sub(named) as f64);
        counter!("erato_component_memory_scope_errors_total")
            .absolute(SCOPE_ERRORS.load(Ordering::Relaxed));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Component, scope};
    use std::future::Future;
    use std::pin::Pin;
    use std::task::{Context, Poll, Waker};

    #[test]
    fn large_scoped_futures_stay_small_and_forward_polls() {
        struct LargeFuture {
            payload: [u8; 64 * 1024],
            pending: bool,
        }
        impl Future for LargeFuture {
            type Output = u8;

            fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<u8> {
                if self.pending {
                    self.pending = false;
                    cx.waker().wake_by_ref();
                    Poll::Pending
                } else {
                    Poll::Ready(self.payload[0])
                }
            }
        }

        let future = scope(
            Component::ChatPreparation,
            scope(
                Component::ProviderRequest,
                LargeFuture {
                    payload: [42; 64 * 1024],
                    pending: true,
                },
            ),
        );
        assert!(std::mem::size_of_val(&future) < 1024);
        let mut future = std::pin::pin!(future);
        let mut cx = Context::from_waker(Waker::noop());
        assert_eq!(future.as_mut().poll(&mut cx), Poll::Pending);
        assert_eq!(future.as_mut().poll(&mut cx), Poll::Ready(42));
    }
}
