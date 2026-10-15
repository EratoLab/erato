#![cfg(all(feature = "profiling", target_os = "linux"))]

use erato::metrics::components::{self, Component};

#[global_allocator]
static ALLOCATOR: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

fn allocated(component: Component) -> usize {
    tikv_jemalloc_ctl::epoch::advance().unwrap();
    components::snapshot()
        .unwrap()
        .into_iter()
        .find(|sample| sample.component == component)
        .unwrap()
        .allocated
}

fn thread_state() -> (u32, bool) {
    // SAFETY: documented unsigned/bool mallctl values for the calling thread.
    unsafe {
        (
            tikv_jemalloc_ctl::raw::read(b"thread.arena\0").unwrap(),
            tikv_jemalloc_ctl::raw::read(b"thread.tcache.enabled\0").unwrap(),
        )
    }
}

#[test]
fn attribution_survives_scope_return_worker_migration_and_cross_thread_free() {
    components::init(true).unwrap();
    // SAFETY: documented C unsigned/bool thread-local mallctl values.
    let original_arena = unsafe { tikv_jemalloc_ctl::raw::read::<u32>(b"thread.arena\0") }.unwrap();
    let original_cache =
        unsafe { tikv_jemalloc_ctl::raw::read::<bool>(b"thread.tcache.enabled\0") }.unwrap();
    let before = allocated(Component::TokenizerState);
    let bytes = components::sync(Component::TokenizerState, || vec![7u8; 8 * 1024 * 1024]);
    assert!(allocated(Component::TokenizerState) >= before + bytes.len());
    std::thread::spawn(move || drop(bytes)).join().unwrap();
    assert!(allocated(Component::TokenizerState) < before + 1024 * 1024);

    // Nested scopes charge the inner arena exactly once and restore the parent.
    let (outer, inner, restored) = components::sync(Component::FileBytes, || {
        let outer = vec![1u8; 4 * 1024 * 1024];
        let inner = components::sync(Component::McpClient, || vec![2u8; 4 * 1024 * 1024]);
        let restored = vec![3u8; 4 * 1024 * 1024];
        (outer, inner, restored)
    });
    assert!(allocated(Component::FileBytes) >= outer.len() + restored.len());
    assert!(allocated(Component::McpClient) >= inner.len());
    let _ =
        std::panic::catch_unwind(|| components::sync(Component::Policy, || panic!("scope unwind")));
    let after_unwind = vec![4u8; 4 * 1024 * 1024];
    assert!(allocated(Component::Policy) < after_unwind.len());
    assert_eq!(
        unsafe { tikv_jemalloc_ctl::raw::read::<u32>(b"thread.arena\0") }.unwrap(),
        original_arena
    );
    assert_eq!(
        unsafe { tikv_jemalloc_ctl::raw::read::<bool>(b"thread.tcache.enabled\0") }.unwrap(),
        original_cache
    );
    drop((outer, inner, restored, after_unwind));

    // Force consecutive polls onto different threads instead of depending on
    // Tokio's scheduler to migrate the future after a yield.
    let mut first = None;
    let future = Box::pin(components::scope(
        Component::AttachmentPlanning,
        std::future::poll_fn(move |_| match first.take() {
            None => {
                first = Some(vec![5u8; 4 * 1024 * 1024]);
                std::task::Poll::Pending
            }
            Some(first) => std::task::Poll::Ready((first, vec![6u8; 4 * 1024 * 1024])),
        }),
    ));
    let future = std::thread::spawn(move || {
        let state = thread_state();
        let mut future = future;
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        assert!(std::future::Future::poll(future.as_mut(), &mut context).is_pending());
        assert_eq!(thread_state(), state);
        future
    })
    .join()
    .unwrap();
    assert!(allocated(Component::AttachmentPlanning) >= 4 * 1024 * 1024);
    let values = std::thread::spawn(move || {
        let state = thread_state();
        let mut future = future;
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        let std::task::Poll::Ready(values) =
            std::future::Future::poll(future.as_mut(), &mut context)
        else {
            panic!("second poll should complete");
        };
        assert_eq!(thread_state(), state);
        values
    })
    .join()
    .unwrap();
    assert!(allocated(Component::AttachmentPlanning) >= 8 * 1024 * 1024);
    drop(values);
    assert!(allocated(Component::AttachmentPlanning) < 1024 * 1024);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let job = tokio::spawn(components::scope(Component::AttachmentPlanning, async {
            tokio::task::yield_now().await;
            let first = vec![5u8; 4 * 1024 * 1024];
            tokio::task::yield_now().await;
            let second = vec![6u8; 4 * 1024 * 1024];
            (first, second)
        }));
        let values = job.await.unwrap();
        assert!(allocated(Component::AttachmentPlanning) >= 8 * 1024 * 1024);
        drop(values);

        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let cancelled = tokio::spawn(components::scope(Component::TokenizerWork, async {
            let bytes = vec![8u8; 8 * 1024 * 1024];
            started_tx.send(()).unwrap();
            std::future::pending::<()>().await;
            std::hint::black_box(bytes);
        }));
        started_rx.await.unwrap();
        assert!(allocated(Component::TokenizerWork) >= 8 * 1024 * 1024);
        cancelled.abort();
        assert!(cancelled.await.unwrap_err().is_cancelled());
        assert!(allocated(Component::TokenizerWork) < 1024 * 1024);
    });
    assert!(allocated(Component::AttachmentPlanning) < 1024 * 1024);
}
