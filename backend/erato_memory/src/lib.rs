//! Portable accounting of owned children; never allocator bookkeeping or RSS.
extern crate self as erato_memory;
pub use erato_memory_derive::HeapSize;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::hash::BuildHasher;
use std::mem::{size_of, size_of_val};
use std::sync::Arc;

pub trait HeapSize {
    fn is_inline_only() -> bool
    where
        Self: Sized,
    {
        false
    }
    /// Inline storage belongs to the enclosing Vec/Box/Arc allocation.
    fn heap_size(&self, context: &mut Context);
}
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct Usage {
    pub capacity: usize,
    pub estimated: usize,
    pub locked: bool,
    pub unmeasured: BTreeMap<&'static str, usize>,
}
#[derive(Default)]
pub struct Context {
    usage: Usage,
    shared: HashSet<usize>,
    register_shared: bool,
}
impl Context {
    /// Owner reservations defer shared children to the global weak-root snapshot.
    pub fn for_owned() -> Self {
        Self {
            register_shared: true,
            ..Default::default()
        }
    }
    pub fn measure<T: HeapSize + ?Sized>(&mut self, value: &T) {
        value.heap_size(self);
    }
    pub fn capacity(&mut self, bytes: usize) {
        self.usage.capacity += bytes;
    }
    pub fn estimated(&mut self, bytes: usize) {
        self.usage.estimated += bytes;
    }
    pub fn locked(&mut self, name: &'static str) {
        self.usage.locked = true;
        self.unmeasured(name, 1);
    }
    pub fn opaque<T: ?Sized>(&mut self, _: &T) {
        self.unmeasured(std::any::type_name::<T>(), 1);
    }
    pub fn unmeasured(&mut self, name: &'static str, count: usize) {
        if count > 0 {
            *self.usage.unmeasured.entry(name).or_default() += count;
        }
    }
    /// Reuse across all roots of one snapshot to deduplicate shared allocations.
    pub fn shared(&mut self, address: usize) -> bool {
        self.shared.insert(address)
    }
    pub fn usage(&self) -> &Usage {
        &self.usage
    }
    pub fn finish(self) -> Usage {
        self.usage
    }
}
pub fn measure<T: HeapSize + ?Sized>(value: &T) -> Usage {
    let mut context = Context::default();
    context.measure(value);
    context.finish()
}
macro_rules! inline { ($($ty:ty),* $(,)?) => { $(impl HeapSize for $ty {
    #[inline]
    fn is_inline_only() -> bool { true }
    #[inline]
    fn heap_size(&self, _: &mut Context) {}
})* }; }
inline!(
    (),
    bool,
    char,
    u8,
    u16,
    u32,
    u64,
    u128,
    usize,
    i8,
    i16,
    i32,
    i64,
    i128,
    isize,
    f32,
    f64,
    std::time::Duration,
    std::time::Instant,
    tokio::time::Instant,
    std::time::SystemTime,
    uuid::Uuid,
    chrono::NaiveDate,
    chrono::NaiveDateTime,
    chrono::NaiveTime,
    std::sync::atomic::AtomicBool,
    std::sync::atomic::AtomicU64
);
impl<T: chrono::TimeZone> HeapSize for chrono::DateTime<T> {
    fn heap_size(&self, _: &mut Context) {}
}
impl HeapSize for String {
    fn heap_size(&self, c: &mut Context) {
        c.capacity(self.capacity());
    }
}
impl HeapSize for str {
    fn heap_size(&self, _: &mut Context) {}
}
impl<T: ?Sized> HeapSize for &T {
    fn heap_size(&self, _: &mut Context) {}
}
impl<T: ?Sized> HeapSize for std::marker::PhantomData<T> {
    fn heap_size(&self, _: &mut Context) {}
}
impl<T: HeapSize> HeapSize for Option<T> {
    fn heap_size(&self, c: &mut Context) {
        if let Some(v) = self {
            v.heap_size(c);
        }
    }
}
impl<T: HeapSize, E: HeapSize> HeapSize for Result<T, E> {
    fn heap_size(&self, c: &mut Context) {
        match self {
            Ok(v) => v.heap_size(c),
            Err(v) => v.heap_size(c),
        }
    }
}
impl<T: HeapSize> HeapSize for Vec<T> {
    fn heap_size(&self, c: &mut Context) {
        c.capacity(self.capacity() * size_of::<T>());
        if !T::is_inline_only() {
            for v in self {
                v.heap_size(c);
            }
        }
    }
}
impl<T: HeapSize, const N: usize> HeapSize for [T; N] {
    fn heap_size(&self, c: &mut Context) {
        for v in self {
            v.heap_size(c);
        }
    }
}
impl<T: HeapSize + ?Sized> HeapSize for Box<T> {
    fn heap_size(&self, c: &mut Context) {
        c.capacity(size_of_val(&**self));
        (**self).heap_size(c);
    }
}
impl<T: HeapSize + Send + Sync + 'static + ?Sized> HeapSize for Arc<T> {
    fn heap_size(&self, c: &mut Context) {
        if c.register_shared {
            register_shared(self);
            return;
        }
        if c.shared(Arc::as_ptr(self).cast::<()>() as usize) {
            c.estimated(size_of_val(&**self) + 2 * size_of::<usize>());
            (**self).heap_size(c);
        }
    }
}
impl<T: ?Sized> HeapSize for std::sync::Weak<T> {
    fn heap_size(&self, c: &mut Context) {
        // Weak handles do not own the pointee. They may retain its control
        // allocation, whose private layout/liveness is unavailable here.
        c.unmeasured("Weak Arc control storage", 1);
    }
}
impl<K: HeapSize, V: HeapSize, S: BuildHasher> HeapSize for HashMap<K, V, S> {
    fn heap_size(&self, c: &mut Context) {
        // Public capacity does not expose bucket layout and control storage.
        c.estimated(estimate_hash_table(self.capacity(), size_of::<(K, V)>()));
        for (k, v) in self {
            k.heap_size(c);
            v.heap_size(c);
        }
    }
}
impl<T: HeapSize, S: BuildHasher> HeapSize for HashSet<T, S> {
    fn heap_size(&self, c: &mut Context) {
        c.estimated(estimate_hash_table(self.capacity(), size_of::<T>()));
        for v in self {
            v.heap_size(c);
        }
    }
}
impl<K: HeapSize, V: HeapSize> HeapSize for BTreeMap<K, V> {
    fn heap_size(&self, c: &mut Context) {
        c.estimated(self.len() * (size_of::<(K, V)>() + 3 * size_of::<usize>()));
        for (k, v) in self {
            k.heap_size(c);
            v.heap_size(c);
        }
    }
}
impl<T: HeapSize> HeapSize for BTreeSet<T> {
    fn heap_size(&self, c: &mut Context) {
        c.estimated(self.len() * (size_of::<T>() + 3 * size_of::<usize>()));
        for v in self {
            v.heap_size(c);
        }
    }
}
impl<A: HeapSize, B: HeapSize> HeapSize for (A, B) {
    fn heap_size(&self, c: &mut Context) {
        self.0.heap_size(c);
        self.1.heap_size(c);
    }
}
impl<T: HeapSize> HeapSize for std::sync::Mutex<T> {
    fn heap_size(&self, c: &mut Context) {
        match self.try_lock() {
            Ok(v) => v.heap_size(c),
            Err(_) => c.locked("locked mutex"),
        }
    }
}
impl HeapSize for std::path::PathBuf {
    fn heap_size(&self, c: &mut Context) {
        c.capacity(self.capacity());
    }
}
impl HeapSize for url::Url {
    fn heap_size(&self, c: &mut Context) {
        c.estimated(self.as_str().len());
    }
}
impl HeapSize for http::HeaderValue {
    fn heap_size(&self, c: &mut Context) {
        c.estimated(self.as_bytes().len());
        c.unmeasured("HeaderValue shared backing", 1);
    }
}
impl<T: HeapSize> HeapSize for http::HeaderMap<T> {
    fn heap_size(&self, c: &mut Context) {
        // Public capacity exposes entry slots, but not indices, overflow values
        // or the backing allocation's layout. Keep this an explicit estimate.
        c.estimated(self.capacity() * size_of::<(http::HeaderName, T)>());
        for (name, value) in self {
            c.estimated(name.as_str().len());
            value.heap_size(c);
        }
        c.unmeasured("HeaderMap indices and shared backing", 1);
    }
}
impl HeapSize for secrecy::SecretString {
    fn heap_size(&self, c: &mut Context) {
        use secrecy::ExposeSecret;
        c.capacity(self.expose_secret().len());
    }
}
impl HeapSize for serde_json::Value {
    fn heap_size(&self, c: &mut Context) {
        match self {
            Self::String(v) => v.heap_size(c),
            Self::Array(v) => v.heap_size(c),
            Self::Object(v) => v.heap_size(c),
            _ => {}
        }
    }
}
impl HeapSize for serde_json::Map<String, serde_json::Value> {
    fn heap_size(&self, c: &mut Context) {
        c.estimated(
            self.len() * (size_of::<(String, serde_json::Value)>() + 3 * size_of::<usize>()),
        );
        for (k, v) in self {
            k.heap_size(c);
            v.heap_size(c);
        }
    }
}
impl<T: HeapSize> HeapSize for [T] {
    fn heap_size(&self, c: &mut Context) {
        for v in self {
            v.heap_size(c);
        }
    }
}
impl<B: std::borrow::ToOwned + ?Sized> HeapSize for std::borrow::Cow<'_, B>
where
    B::Owned: HeapSize,
{
    fn heap_size(&self, c: &mut Context) {
        if let Self::Owned(v) = self {
            v.heap_size(c);
        }
    }
}
impl<A: HeapSize, B: HeapSize, D: HeapSize> HeapSize for (A, B, D) {
    fn heap_size(&self, c: &mut Context) {
        self.0.heap_size(c);
        self.1.heap_size(c);
        self.2.heap_size(c);
    }
}
impl<T: HeapSize> HeapSize for tokio::sync::RwLock<T> {
    fn heap_size(&self, c: &mut Context) {
        match self.try_read() {
            Ok(v) => v.heap_size(c),
            Err(_) => c.locked("locked Tokio RwLock"),
        }
    }
}
impl<T: HeapSize> HeapSize for tokio::sync::Mutex<T> {
    fn heap_size(&self, c: &mut Context) {
        match self.try_lock() {
            Ok(v) => v.heap_size(c),
            Err(_) => c.locked("locked Tokio Mutex"),
        }
    }
}
impl Context {
    pub fn take_usage(&mut self) -> Usage {
        std::mem::take(&mut self.usage)
    }
}

/// Shared descendants of owner reservations are reported once, even when
/// aliases cross cached/request roots. Only Weak references are retained.
struct SharedReporter {
    type_name: &'static str,
    report: Box<dyn Fn(&mut Context) -> bool + Send + Sync>,
}
static SHARED_ROOTS: std::sync::LazyLock<std::sync::Mutex<BTreeMap<usize, Arc<SharedReporter>>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(BTreeMap::new()));
fn register_shared<T: HeapSize + Send + Sync + 'static + ?Sized>(value: &Arc<T>) {
    let id = Arc::as_ptr(value).cast::<()>() as usize;
    let mut roots = SHARED_ROOTS.lock().unwrap_or_else(|e| e.into_inner());
    roots.entry(id).or_insert_with(|| {
        let weak = Arc::downgrade(value);
        Arc::new(SharedReporter {
            type_name: std::any::type_name::<T>(),
            report: Box::new(move |c| {
                if let Some(value) = weak.upgrade() {
                    value.heap_size(c);
                    true
                } else {
                    false
                }
            }),
        })
    });
}
pub fn measure_owned<T: HeapSize + ?Sized>(value: &T) -> Usage {
    let mut c = Context::for_owned();
    c.measure(value);
    c.finish()
}
pub fn shared_roots(context: &mut Context) -> BTreeMap<&'static str, Usage> {
    let roots: Vec<_> = SHARED_ROOTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(&id, r)| (id, r.clone()))
        .collect();
    let mut report = BTreeMap::<&'static str, Usage>::new();
    let mut dead = Vec::new();
    for (id, root) in roots {
        if !(root.report)(context) {
            dead.push((id, root.clone()));
        }
        let delta = context.take_usage();
        let usage = report.entry(root.type_name).or_default();
        usage.capacity += delta.capacity;
        usage.estimated += delta.estimated;
        usage.locked |= delta.locked;
        for (name, count) in delta.unmeasured {
            *usage.unmeasured.entry(name).or_default() += count;
        }
    }
    let mut roots = SHARED_ROOTS.lock().unwrap_or_else(|e| e.into_inner());
    for (id, old) in dead {
        if roots
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(current, &old))
        {
            roots.remove(&id);
        }
    }
    report
}

/// Current standard HashMap uses SwissTable load factors and control groups;
/// private layout is deliberately classified as estimated, not capacity bytes.
pub fn estimate_hash_table(capacity: usize, entry_size: usize) -> usize {
    if capacity == 0 {
        0
    } else {
        let buckets = (capacity + 1).next_power_of_two();
        buckets * entry_size + buckets + 16
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(HeapSize)]
    struct Owned {
        names: Vec<String>,
        count: u64,
    }
    // Deliberately exercise an allocated outer object with heap children.
    #[allow(clippy::box_collection)]
    #[derive(HeapSize)]
    enum Choice {
        Empty,
        Tuple(Box<String>),
        Named { data: Vec<u8> },
    }
    #[test]
    fn nested_capacity_and_inline_storage_are_counted_once() {
        let mut names = Vec::with_capacity(4);
        let mut s = String::with_capacity(200);
        s.push_str("small");
        names.push(s);
        let value = Owned { names, count: 1 };
        let usage = measure(&value);
        assert_eq!(usage.capacity, 4 * size_of::<String>() + 200);
        assert_eq!(usage.estimated, 0);
        let usage = measure(&Choice::Tuple(Box::new(String::with_capacity(50))));
        assert_eq!(usage.capacity, size_of::<String>() + 50);
        assert_eq!(
            measure(&Choice::Named {
                data: Vec::with_capacity(100)
            })
            .capacity,
            100
        );
        assert_eq!(measure(&Choice::Empty).capacity, 0);
    }
    #[test]
    fn shared_snapshots_deduplicate_and_weak_registry_does_not_keep_data_alive() {
        #[derive(HeapSize)]
        struct Shared {
            bytes: Vec<u8>,
        }
        let value = Arc::new(Shared {
            bytes: Vec::with_capacity(9000),
        });
        let alias = value.clone();
        let weak = Arc::downgrade(&value);
        let mut context = Context::default();
        context.measure(&value);
        context.measure(&alias);
        assert_eq!(context.finish().capacity, 9000);
        // Two independently registered owner roots must not charge their alias
        // twice, and global reporting must not prolong the object's lifetime.
        assert_eq!(measure_owned(&value).capacity, 0);
        assert_eq!(measure_owned(&alias).capacity, 0);
        let mut c = Context::default();
        let roots = shared_roots(&mut c);
        assert_eq!(roots[std::any::type_name::<Shared>()].capacity, 9000);
        drop(value);
        drop(alias);
        assert!(weak.upgrade().is_none());
        let roots = shared_roots(&mut Context::default());
        assert_eq!(
            roots
                .get(std::any::type_name::<Shared>())
                .map_or(0, |u| u.capacity),
            0
        );
    }
    #[test]
    fn cycles_are_visited_once_and_opaque_fields_are_explicit() {
        #[derive(HeapSize)]
        struct Node {
            next: std::sync::Mutex<Option<Arc<Node>>>,
            bytes: Vec<u8>,
            #[heap_size(opaque)]
            hidden: Vec<u8>,
        }
        let node = Arc::new(Node {
            next: std::sync::Mutex::new(None),
            bytes: Vec::with_capacity(30),
            hidden: Vec::with_capacity(300),
        });
        *node.next.lock().unwrap() = Some(node.clone());
        let usage = measure(&node);
        assert_eq!(usage.capacity, 30);
        assert_eq!(usage.unmeasured[std::any::type_name::<Vec<u8>>()], 1);
        *node.next.lock().unwrap() = None;
    }
    #[test]
    fn secret_reporting_exposes_sizes_without_contents() {
        let secret = secrecy::SecretString::from("never-export-this");
        let usage = measure(&secret);
        assert_eq!(usage.capacity, 17);
        assert!(
            !serde_json::to_string(&usage)
                .unwrap()
                .contains("never-export-this")
        );
    }
}
