# Owned heap inspection

This crate measures storage reachable through known Rust owners without replacing
the allocator. `#[derive(HeapSize)]` visits every field; adding an unsupported
field fails compilation until its adapter or an explicit opaque annotation is
provided. `#[heap_size(opaque)]` exposes an unmeasured-object count, while
`#[heap_size(skip)]` is for accounting guards and other deliberately excluded
bookkeeping.

`String` and `Vec` report their capacities, including unused capacity. `Box`
includes its inline allocation and heap children. Inline fields belong to the
enclosing container and are never counted twice. Private container layouts,
Arc headers, and dependency sizes that expose only lengths are classified as
estimates. References are borrowed and do not own their referent.

Use one `Context::default()` across the roots of a shared snapshot; it remembers
allocation identities across `take_usage()` calls. Mutex/RwLock adapters try
their locks and flag unavailable measurements rather than waiting. The metric
publisher retains previous byte measurements for stale owners.

Use `measure_owned()` for a lifetime reservation. Independently owned children
are charged to that reservation; Arc children register weak roots and are
inspected once by `shared_roots()` alongside the shared snapshot. This separates
two independent String copies from two handles to the same allocation. Weak
registrations do not keep strong owners alive and are pruned during reporting.
They do retain the Arc control allocation until pruning; for `Arc<str>` or other
inline unsized data this also delays freeing the backing allocation by up to
the sampling interval. State
snapshots and shared-root traversal must use the same context.

Erato's metric wiring lives in `erato/src/metrics/owned.rs`. Immutable cache
values carry one reservation inside their shared wrapper. Mutable requests
refresh their reservation between tool turns; blocking jobs carry theirs until
completion or cancellation. Periodic inspection does not copy large payloads.
Labels contain only fixed owner paths and compiled Rust types, never user data.

HeaderMap entry/name/value storage is estimated through public APIs; private
indices and shared backing remain opaque. Weak pointers do not own their
pointees, so their retained control storage is marked opaque rather than
traversing the referenced object. Tokio timestamps carry no owned heap storage.

The tokenizer adapter uses unmodified, pinned upstream `tiktoken-rs`. It scans
o200k token lengths via public decoding once, then reuses an estimated vocabulary
and container layout for each instance. No dependency source or vocabulary
assets are vendored. Private spare capacity and compiled regex state remain
explicitly opaque; review the version/layout assumptions on dependency updates.

This is an application ownership estimate, not a complete heap census. Opaque
library state, enclosing future/framework allocations, allocator size classes,
allocator metadata, native stacks, mappings and freed pages are outside it.
Do not add overlapping payload metrics or diagnostic arena totals to these bytes.

Run `cargo nextest run -p erato_memory` from `backend` for the traversal, sharing,
cycle and secret-reporting tests. Erato's `metrics::owned` tests cover reservation
lifetimes, cross-thread drop, mutation, panic cleanup and stale-owner publication.
