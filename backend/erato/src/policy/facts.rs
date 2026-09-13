//! Reusable facts, never cached authorization decisions.
//!
//! Warm checks use only memory. Committed change notifications invalidate
//! affected generations; absolute expiry bounds missed-notification staleness.
use super::types::{Action, ResourceKind};
use crate::db::entity::{
    assistant_file_uploads, assistant_hub_assistant_versions, assistants, chat_file_uploads, chats,
    file_uploads, share_grants, share_links,
};
use eyre::{Report, eyre};
use moka::future::Cache;
use sea_orm::prelude::Uuid;
use sea_orm::{
    AccessMode, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, FromQueryResult,
    IsolationLevel, QueryFilter, QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const CACHE_CAPACITY: u64 = 20_000;
const BATCH_SIZE: usize = 256;
const FACT_MAX_AGE: Duration = Duration::from_secs(5);
const FACTS_CHANGED_CHANNEL: &str = "policy_facts_changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Chat,
    Assistant,
    File,
    Associations,
    Grants,
    Hub,
    Links,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
struct Key(Kind, Uuid);

#[derive(Debug, Clone, Serialize, FromQueryResult)]
struct ChatFacts {
    id: Uuid,
    #[serde(rename = "owner_id")]
    owner_user_id: String,
    archived_at: Option<sea_orm::prelude::DateTimeWithTimeZone>,
}
impl From<&chats::Model> for ChatFacts {
    fn from(model: &chats::Model) -> Self {
        Self {
            id: model.id,
            owner_user_id: model.owner_user_id.clone(),
            archived_at: model.archived_at,
        }
    }
}
#[derive(Debug, Clone, Serialize, FromQueryResult)]
struct AssistantFacts {
    id: Uuid,
    #[serde(rename = "owner_id")]
    owner_user_id: Uuid,
}
#[derive(Debug, Clone, Serialize, FromQueryResult)]
struct FileFacts {
    id: Uuid,
    #[serde(rename = "owner_id")]
    owner_user_id: String,
}
#[derive(Debug, Clone, Default, Serialize)]
struct Associations {
    linked_chat_ids: Vec<Uuid>,
    linked_assistant_ids: Vec<Uuid>,
}
#[derive(Debug, Clone, Serialize, FromQueryResult)]
struct Grant {
    resource_type: String,
    resource_id: String,
    subject_type: String,
    subject_id_type: String,
    subject_id: String,
    role: String,
}
#[derive(Debug, Clone, Serialize, FromQueryResult)]
struct HubState {
    assistant_id: Uuid,
    status: String,
    is_published: bool,
    is_current_published_version: bool,
}
#[derive(Debug, Clone, Serialize, FromQueryResult)]
struct ShareLink {
    resource_type: String,
    resource_id: String,
    enabled: bool,
}
#[derive(Debug, Clone)]
enum Fact {
    Chat(Option<ChatFacts>),
    Assistant(Option<AssistantFacts>),
    File(Option<FileFacts>),
    Associations(Associations),
    Grants(Vec<Grant>),
    Hub(Vec<HubState>),
    Links(Vec<ShareLink>),
}
impl Fact {
    fn absent(kind: Kind) -> Self {
        match kind {
            Kind::Chat => Self::Chat(None),
            Kind::Assistant => Self::Assistant(None),
            Kind::File => Self::File(None),
            Kind::Associations => Self::Associations(Associations::default()),
            Kind::Grants => Self::Grants(vec![]),
            Kind::Hub => Self::Hub(vec![]),
            Kind::Links => Self::Links(vec![]),
        }
    }
}

// Generation counters and publication ordering exist only in this process.
#[derive(Debug, Default)]
struct Slot {
    state: std::sync::Mutex<SlotState>,
    loading: Arc<Mutex<()>>,
}
#[derive(Debug, Default)]
struct SlotState {
    generation: u64,
    record: Option<Arc<Record>>,
}
#[derive(Debug)]
struct Record {
    generation: u64,
    sequence: u64,
    reset_generation: u64,
    expires_at: Instant,
    fact: Arc<Fact>,
}
#[derive(Debug, Clone)]
struct Entry {
    slot: Arc<Slot>,
    record: Arc<Record>,
}

/// Capture before a database read/write. Never attach a new observation to an
/// old model: notifications received during that operation must fence publication.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Observation {
    epoch: u64,
    sequence: u64,
    started: Instant,
    reset_generation: u64,
    fence_epoch: bool,
}

#[derive(Debug)]
struct ListenerTask(tokio::task::JoinHandle<()>);
impl Drop for ListenerTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[derive(Debug)]
struct SharedInner {
    slots: Cache<Key, Arc<Slot>>,
    epoch: AtomicU64,
    sequence: AtomicU64,
    connected: AtomicBool,
    reset_generation: AtomicU64,
    mutations: std::sync::Mutex<()>,
    listener: tokio::sync::OnceCell<ListenerTask>,
}
#[derive(Debug, Clone)]
pub(crate) struct SharedFacts(Arc<SharedInner>);
impl Default for SharedFacts {
    fn default() -> Self {
        Self(Arc::new(SharedInner {
            slots: Cache::new(CACHE_CAPACITY),
            epoch: AtomicU64::new(0),
            sequence: AtomicU64::new(0),
            connected: AtomicBool::new(false),
            reset_generation: AtomicU64::new(0),
            mutations: std::sync::Mutex::new(()),
            listener: tokio::sync::OnceCell::new(),
        }))
    }
}

impl SharedFacts {
    fn observe(&self) -> Observation {
        Observation {
            epoch: self.0.epoch.load(Ordering::SeqCst),
            sequence: self.0.sequence.fetch_add(1, Ordering::SeqCst),
            started: Instant::now(),
            reset_generation: self.0.reset_generation.load(Ordering::SeqCst),
            fence_epoch: true,
        }
    }

    async fn slot(&self, key: Key) -> Arc<Slot> {
        self.0
            .slots
            .get_with(key, async { Arc::new(Slot::default()) })
            .await
    }

    async fn invalidate(&self, keys: &[Key]) {
        // A notification is an invalidation, never a publication. Duplicate or
        // reordered notifications can cause a miss but cannot restore old facts.
        self.0.epoch.fetch_add(1, Ordering::SeqCst);
        let mut slots = Vec::new();
        for key in keys {
            if let Some(slot) = self.0.slots.get(key).await {
                slots.push(slot);
            }
        }
        // Only synchronous memory work under this lock; never queries or awaits.
        let _mutation = self.0.mutations.lock().unwrap();
        for slot in slots {
            let mut state = slot.state.lock().unwrap();
            state.generation += 1;
            state.record = None;
        }
        self.0.epoch.fetch_add(1, Ordering::SeqCst);
    }

    fn reset(&self, connected: bool) {
        let _mutation = self.0.mutations.lock().unwrap();
        self.0.connected.store(false, Ordering::SeqCst);
        self.0.epoch.fetch_add(2, Ordering::SeqCst);
        self.0.reset_generation.fetch_add(1, Ordering::SeqCst);
        self.0.slots.invalidate_all();
        self.0.connected.store(connected, Ordering::SeqCst);
    }

    async fn ensure_listener(&self, db: &DatabaseConnection) -> Result<(), Report> {
        self.0.listener.get_or_try_init(|| async {
            let source_pool = db.get_postgres_connection_pool().clone();
            // LISTEN is long-lived and must not consume an ordinary query slot.
            let pool = sqlx::postgres::PgPoolOptions::new()
                .max_connections(1)
                .connect_lazy_with(source_pool.connect_options().as_ref().clone());
            let mut initial = sqlx::postgres::PgListener::connect_with(&pool).await?;
            initial.eager_reconnect(false);
            initial.listen(FACTS_CHANGED_CHANNEL).await?;
            let mut listener = Some(initial);
            self.reset(true);
            let weak = Arc::downgrade(&self.0);
            Ok::<_, Report>(ListenerTask(tokio::spawn(async move {
                loop {
                    match listener.as_mut().unwrap().try_recv().await {
                        Ok(Some(notification)) => {
                            let Some(inner) = weak.upgrade() else { break; };
                            let shared = SharedFacts(inner);
                            match serde_json::from_str::<Vec<Key>>(notification.payload()) {
                                Ok(keys) => shared.invalidate(&keys).await,
                                Err(error) => {
                                    tracing::warn!(%error, "Invalid policy fact notification; clearing cache");
                                    shared.reset(true);
                                }
                            }
                        }
                        Ok(None) | Err(_) => {
                            drop(listener.take());
                            if let Some(inner) = weak.upgrade() { SharedFacts(inner).reset(false); } else { break; }
                            // Recreate the connection explicitly: recv() alone
                            // hides disconnects and would keep stale cache entries.
                            loop {
                                if source_pool.is_closed() || weak.strong_count() == 0 { return; }
                                tokio::time::sleep(Duration::from_secs(1)).await;
                                if let Ok(mut next) = sqlx::postgres::PgListener::connect_with(&pool).await {
                                    next.eager_reconnect(false);
                                    if next.listen(FACTS_CHANGED_CHANNEL).await.is_ok() {
                                        listener = Some(next);
                                        if let Some(inner) = weak.upgrade() { SharedFacts(inner).reset(true); }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            })))
        }).await?;
        if !self.0.connected.load(Ordering::SeqCst) {
            return Err(eyre!("Policy invalidation listener is disconnected"));
        }
        Ok(())
    }

    async fn valid(&self, key: Key, entry: &Entry) -> bool {
        let generation_matches =
            entry.slot.state.lock().unwrap().generation == entry.record.generation;
        self.0.connected.load(Ordering::SeqCst)
            && entry.record.reset_generation == self.0.reset_generation.load(Ordering::SeqCst)
            && entry.record.expires_at > Instant::now()
            && generation_matches
            && self
                .0
                .slots
                .get(&key)
                .await
                .is_some_and(|slot| Arc::ptr_eq(&slot, &entry.slot))
    }

    fn publish(
        &self,
        slot: &Arc<Slot>,
        generation: u64,
        observation: Observation,
        fact: Fact,
    ) -> Option<Entry> {
        let _mutation = self.0.mutations.lock().unwrap();
        let mut state = slot.state.lock().unwrap();
        if !self.0.epoch.load(Ordering::SeqCst).is_multiple_of(2)
            || state.generation != generation
            || self.0.reset_generation.load(Ordering::SeqCst) != observation.reset_generation
            || (observation.fence_epoch && self.0.epoch.load(Ordering::SeqCst) != observation.epoch)
            || observation.started.elapsed() >= FACT_MAX_AGE
            || !self.0.connected.load(Ordering::SeqCst)
        {
            return None;
        }
        if let Some(record) = &state.record
            && record.sequence > observation.sequence
        {
            return Some(Entry {
                slot: slot.clone(),
                record: record.clone(),
            });
        }
        let record = Arc::new(Record {
            generation,
            sequence: observation.sequence,
            reset_generation: observation.reset_generation,
            expires_at: observation.started + FACT_MAX_AGE,
            fact: Arc::new(fact),
        });
        state.record = Some(record.clone());
        Some(Entry {
            slot: slot.clone(),
            record,
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PolicyFactsLoader {
    db: DatabaseConnection,
    shared: SharedFacts,
    local: Arc<Mutex<HashMap<Key, Entry>>>,
}
impl PolicyFactsLoader {
    pub(crate) fn new(db: DatabaseConnection, shared: SharedFacts) -> Self {
        Self {
            db,
            shared,
            local: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn observe(&self) -> Result<Observation, Report> {
        self.shared.ensure_listener(&self.db).await?;
        Ok(self.shared.observe())
    }

    pub(crate) async fn seed_chat(&self, chat: &chats::Model, observation: Observation) {
        self.seed_fact(
            Key(Kind::Chat, chat.id),
            observation,
            Fact::Chat(Some(chat.into())),
        )
        .await;
    }

    pub(crate) async fn seed_chat_projection(
        &self,
        id: Uuid,
        owner_user_id: String,
        archived_at: Option<sea_orm::prelude::DateTimeWithTimeZone>,
        observation: Observation,
    ) {
        self.seed_fact(
            Key(Kind::Chat, id),
            observation,
            Fact::Chat(Some(ChatFacts {
                id,
                owner_user_id,
                archived_at,
            })),
        )
        .await;
    }

    async fn seed_fact(&self, key: Key, observation: Observation, fact: Fact) {
        let slot = self.shared.slot(key).await;
        let generation = slot.state.lock().unwrap().generation;
        if let Some(entry) = self.shared.publish(&slot, generation, observation, fact) {
            self.local.lock().await.insert(key, entry);
        }
    }

    pub(crate) async fn load_chat_model(&self, id: Uuid) -> Result<Option<chats::Model>, Report> {
        let observation = self.observe().await?;
        let chat = chats::Entity::find_by_id(id).one(&self.db).await?;
        if let Some(chat) = &chat {
            self.seed_chat(chat, observation).await;
        }
        Ok(chat)
    }
    pub(crate) async fn load_assistant_model(
        &self,
        id: Uuid,
    ) -> Result<Option<assistants::Model>, Report> {
        let observation = self.observe().await?;
        let assistant = assistants::Entity::find_by_id(id).one(&self.db).await?;
        if let Some(assistant) = &assistant {
            self.seed_fact(
                Key(Kind::Assistant, id),
                observation,
                Fact::Assistant(Some(AssistantFacts {
                    id,
                    owner_user_id: assistant.owner_user_id,
                })),
            )
            .await;
        }
        Ok(assistant)
    }
    pub(crate) async fn load_file_model(
        &self,
        id: Uuid,
    ) -> Result<Option<file_uploads::Model>, Report> {
        let observation = self.observe().await?;
        let file = file_uploads::Entity::find_by_id(id).one(&self.db).await?;
        if let Some(file) = &file {
            self.seed_fact(
                Key(Kind::File, id),
                observation,
                Fact::File(Some(FileFacts {
                    id,
                    owner_user_id: file.owner_user_id.clone(),
                })),
            )
            .await;
        }
        Ok(file)
    }

    pub(crate) async fn load(
        &self,
        kind: ResourceKind,
        ids: &[Uuid],
        action: Action,
    ) -> Result<Value, Report> {
        let mut keys = BTreeSet::new();
        for id in ids {
            match kind {
                ResourceKind::Chat => {
                    keys.insert(Key(Kind::Chat, *id));
                    if action == Action::SharedRead {
                        keys.insert(Key(Kind::Links, *id));
                    }
                }
                ResourceKind::Assistant => assistant_keys(&mut keys, *id),
                ResourceKind::FileUpload => {
                    keys.insert(Key(Kind::File, *id));
                    if action == Action::Read {
                        keys.insert(Key(Kind::Associations, *id));
                    }
                }
                _ => {}
            }
        }
        if keys.is_empty() {
            return context_json(BTreeMap::new());
        }
        self.shared.ensure_listener(&self.db).await?;
        for _ in 0..3 {
            let mut entries = BTreeMap::new();
            self.load_keys(&keys, &mut entries).await?;
            let mut dependencies = BTreeSet::new();
            for entry in entries.values() {
                if let Fact::Associations(links) = entry.record.fact.as_ref() {
                    for id in &links.linked_chat_ids {
                        dependencies.insert(Key(Kind::Chat, *id));
                        dependencies.insert(Key(Kind::Links, *id));
                    }
                    for id in &links.linked_assistant_ids {
                        assistant_keys(&mut dependencies, *id);
                    }
                }
            }
            self.load_keys(&dependencies, &mut entries).await?;
            let mut valid = keys
                .iter()
                .chain(dependencies.iter())
                .all(|key| entries.contains_key(key));
            for (key, entry) in &entries {
                valid &= self.shared.valid(*key, entry).await;
            }
            // Validate the complete context atomically against observed changes.
            // Unrelated notifications do not restart this request.
            let _mutation = self.shared.0.mutations.lock().unwrap();
            valid &= self.shared.0.connected.load(Ordering::SeqCst);
            for entry in entries.values() {
                valid &= entry.record.expires_at > Instant::now()
                    && entry.record.reset_generation
                        == self.shared.0.reset_generation.load(Ordering::SeqCst)
                    && entry.record.generation == entry.slot.state.lock().unwrap().generation;
            }
            drop(_mutation);
            if valid {
                return context_json(
                    entries
                        .into_iter()
                        .map(|(key, entry)| (key, entry.record.fact.clone()))
                        .collect(),
                );
            }
        }
        Err(eyre!(
            "Policy facts changed while loading; retry the request"
        ))
    }

    async fn load_keys(
        &self,
        keys: &BTreeSet<Key>,
        out: &mut BTreeMap<Key, Entry>,
    ) -> Result<(), Report> {
        let keys: Vec<_> = keys.iter().copied().collect();
        for batch in keys.chunks(BATCH_SIZE) {
            let mut guards = Vec::new();
            for key in batch {
                let local = self.local.lock().await.get(key).cloned();
                if let Some(entry) = local
                    && self.shared.valid(*key, &entry).await
                {
                    out.insert(*key, entry);
                    continue;
                }
                let slot = self.shared.slot(*key).await;
                // Deterministic key order coalesces overlapping collection loads.
                let guard = slot.loading.clone().lock_owned().await;
                let record = slot.state.lock().unwrap().record.clone();
                if let Some(record) = record {
                    let entry = Entry {
                        slot: slot.clone(),
                        record,
                    };
                    if self.shared.valid(*key, &entry).await {
                        self.local.lock().await.insert(*key, entry.clone());
                        out.insert(*key, entry);
                        continue;
                    }
                }
                let generation = slot.state.lock().unwrap().generation;
                guards.push((*key, slot, generation, guard));
            }
            if guards.is_empty() {
                continue;
            }
            // No transaction, query or connection checkout on the warm path.
            let mut observation = self.shared.observe();
            // Per-key generations were captured before this query; unrelated
            // notifications must not discard an otherwise valid batch.
            observation.fence_epoch = false;
            let txn = self
                .db
                .begin_with_config(
                    Some(IsolationLevel::RepeatableRead),
                    Some(AccessMode::ReadOnly),
                )
                .await?;
            let missing: Vec<_> = guards.iter().map(|(key, ..)| *key).collect();
            let mut loaded = fetch_facts(&txn, &missing).await?;
            txn.commit().await?;
            for (key, slot, generation, _guard) in guards {
                let fact = loaded.remove(&key).unwrap_or_else(|| Fact::absent(key.0));
                if let Some(entry) = self.shared.publish(&slot, generation, observation, fact) {
                    self.local.lock().await.insert(key, entry.clone());
                    out.insert(key, entry);
                }
            }
        }
        Ok(())
    }
}

fn assistant_keys(keys: &mut BTreeSet<Key>, id: Uuid) {
    for kind in [Kind::Assistant, Kind::Grants, Kind::Hub] {
        keys.insert(Key(kind, id));
    }
}

async fn fetch_facts(
    db: &impl ConnectionTrait,
    keys: &[Key],
) -> Result<BTreeMap<Key, Fact>, Report> {
    let mut out = BTreeMap::new();
    for kind in [
        Kind::Chat,
        Kind::Assistant,
        Kind::File,
        Kind::Associations,
        Kind::Grants,
        Kind::Hub,
        Kind::Links,
    ] {
        let ids: Vec<_> = keys
            .iter()
            .filter(|key| key.0 == kind)
            .map(|key| key.1)
            .collect();
        if ids.is_empty() {
            continue;
        }
        match kind {
            Kind::Chat => {
                let rows = chats::Entity::find()
                    .select_only()
                    .columns([
                        chats::Column::Id,
                        chats::Column::OwnerUserId,
                        chats::Column::ArchivedAt,
                    ])
                    .filter(chats::Column::Id.is_in(ids))
                    .into_model::<ChatFacts>()
                    .all(db)
                    .await?;
                for row in rows {
                    out.insert(Key(kind, row.id), Fact::Chat(Some(row)));
                }
            }
            Kind::Assistant => {
                let rows = assistants::Entity::find()
                    .select_only()
                    .columns([assistants::Column::Id, assistants::Column::OwnerUserId])
                    .filter(assistants::Column::Id.is_in(ids))
                    .into_model::<AssistantFacts>()
                    .all(db)
                    .await?;
                for row in rows {
                    out.insert(Key(kind, row.id), Fact::Assistant(Some(row)));
                }
            }
            Kind::File => {
                let rows = file_uploads::Entity::find()
                    .select_only()
                    .columns([file_uploads::Column::Id, file_uploads::Column::OwnerUserId])
                    .filter(file_uploads::Column::Id.is_in(ids))
                    .into_model::<FileFacts>()
                    .all(db)
                    .await?;
                for row in rows {
                    out.insert(Key(kind, row.id), Fact::File(Some(row)));
                }
            }
            Kind::Associations => {
                let chats = chat_file_uploads::Entity::find()
                    .select_only()
                    .columns([
                        chat_file_uploads::Column::FileUploadId,
                        chat_file_uploads::Column::ChatId,
                    ])
                    .filter(chat_file_uploads::Column::FileUploadId.is_in(ids.clone()))
                    .into_tuple::<(Uuid, Uuid)>()
                    .all(db)
                    .await?;
                let assistants = assistant_file_uploads::Entity::find()
                    .select_only()
                    .columns([
                        assistant_file_uploads::Column::FileUploadId,
                        assistant_file_uploads::Column::AssistantId,
                    ])
                    .filter(assistant_file_uploads::Column::FileUploadId.is_in(ids))
                    .into_tuple::<(Uuid, Uuid)>()
                    .all(db)
                    .await?;
                for (file, chat) in chats {
                    if let Fact::Associations(links) = out
                        .entry(Key(kind, file))
                        .or_insert_with(|| Fact::absent(kind))
                    {
                        links.linked_chat_ids.push(chat);
                    }
                }
                for (file, assistant) in assistants {
                    if let Fact::Associations(links) = out
                        .entry(Key(kind, file))
                        .or_insert_with(|| Fact::absent(kind))
                    {
                        links.linked_assistant_ids.push(assistant);
                    }
                }
            }
            Kind::Grants => {
                let rows = share_grants::Entity::find()
                    .select_only()
                    .columns([
                        share_grants::Column::ResourceType,
                        share_grants::Column::ResourceId,
                        share_grants::Column::SubjectType,
                        share_grants::Column::SubjectIdType,
                        share_grants::Column::SubjectId,
                        share_grants::Column::Role,
                    ])
                    .filter(share_grants::Column::ResourceType.eq("assistant"))
                    .filter(
                        share_grants::Column::ResourceId.is_in(ids.iter().map(ToString::to_string)),
                    )
                    .into_model::<Grant>()
                    .all(db)
                    .await?;
                for row in rows {
                    if let Fact::Grants(grants) = out
                        .entry(Key(kind, row.resource_id.parse()?))
                        .or_insert_with(|| Fact::absent(kind))
                    {
                        grants.push(row);
                    }
                }
            }
            Kind::Hub => {
                let rows = assistant_hub_assistant_versions::Entity::find()
                    .select_only()
                    .columns([
                        assistant_hub_assistant_versions::Column::AssistantId,
                        assistant_hub_assistant_versions::Column::Status,
                        assistant_hub_assistant_versions::Column::IsPublished,
                        assistant_hub_assistant_versions::Column::IsCurrentPublishedVersion,
                    ])
                    .filter(assistant_hub_assistant_versions::Column::AssistantId.is_in(ids))
                    .into_model::<HubState>()
                    .all(db)
                    .await?;
                for row in rows {
                    if let Fact::Hub(versions) = out
                        .entry(Key(kind, row.assistant_id))
                        .or_insert_with(|| Fact::absent(kind))
                    {
                        versions.push(row);
                    }
                }
            }
            Kind::Links => {
                let rows = share_links::Entity::find()
                    .select_only()
                    .columns([
                        share_links::Column::ResourceType,
                        share_links::Column::ResourceId,
                        share_links::Column::Enabled,
                    ])
                    .filter(share_links::Column::ResourceType.eq("chat"))
                    .filter(
                        share_links::Column::ResourceId.is_in(ids.iter().map(ToString::to_string)),
                    )
                    .into_model::<ShareLink>()
                    .all(db)
                    .await?;
                for row in rows {
                    if let Fact::Links(links) = out
                        .entry(Key(kind, row.resource_id.parse()?))
                        .or_insert_with(|| Fact::absent(kind))
                    {
                        links.push(row);
                    }
                }
            }
        }
    }
    Ok(out)
}

fn context_json(facts: BTreeMap<Key, Arc<Fact>>) -> Result<Value, Report> {
    let mut result = json!({"resource_attributes": {"chat": {}, "assistant": {}, "file_upload": {}}, "share_grants": [], "assistant_hub_versions": [], "share_links": []});
    for (key, fact) in &facts {
        let id = key.1.to_string();
        match fact.as_ref() {
            Fact::Chat(Some(row)) => {
                result["resource_attributes"]["chat"][&id] = serde_json::to_value(row)?
            }
            Fact::Assistant(Some(row)) => {
                result["resource_attributes"]["assistant"][&id] = serde_json::to_value(row)?
            }
            Fact::File(Some(row)) => {
                let mut file = serde_json::to_value(row)?;
                let links = match facts
                    .get(&Key(Kind::Associations, key.1))
                    .map(AsRef::as_ref)
                {
                    Some(Fact::Associations(links)) => links.clone(),
                    _ => Associations::default(),
                };
                file["linked_chat_ids"] = json!(links.linked_chat_ids);
                file["linked_assistant_ids"] = json!(links.linked_assistant_ids);
                result["resource_attributes"]["file_upload"][&id] = file;
            }
            Fact::Grants(rows) => result["share_grants"].as_array_mut().unwrap().extend(
                serde_json::to_value(rows)?
                    .as_array()
                    .unwrap()
                    .iter()
                    .cloned(),
            ),
            Fact::Hub(rows) => result["assistant_hub_versions"]
                .as_array_mut()
                .unwrap()
                .extend(
                    serde_json::to_value(rows)?
                        .as_array()
                        .unwrap()
                        .iter()
                        .cloned(),
                ),
            Fact::Links(rows) => result["share_links"].as_array_mut().unwrap().extend(
                serde_json::to_value(rows)?
                    .as_array()
                    .unwrap()
                    .iter()
                    .cloned(),
            ),
            _ => {}
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::policy::engine::{AuthorizeShort, PolicyEngine};
    use crate::policy::types::{Resource, Subject};
    use sqlx::PgPool;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../sqitch/deploy");

    // SQLx needs the database URL before its test harness creates each test database.
    #[ctor::ctor]
    fn set_test_db_url() {
        unsafe {
            std::env::set_var(
                "DATABASE_URL",
                "postgres://eratouser:eratopw@127.0.0.1:5432/erato",
            )
        }
    }

    fn loader(pool: &PgPool, cache: SharedFacts) -> PolicyFactsLoader {
        PolicyFactsLoader::new(
            sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone()),
            cache,
        )
    }
    async fn insert_chat(pool: &PgPool, owner: &str) -> Uuid {
        sqlx::query_scalar("INSERT INTO chats (owner_user_id) VALUES ($1) RETURNING id")
            .bind(owner)
            .fetch_one(pool)
            .await
            .unwrap()
    }
    fn owner(context: &Value, id: Uuid) -> &Value {
        &context["resource_attributes"]["chat"][id.to_string()]["owner_id"]
    }

    #[tokio::test]
    async fn singleton_and_configuration_checks_do_not_need_a_database() {
        let engine = PolicyEngine::new()
            .for_request(&DatabaseConnection::default(), &AppConfig::default())
            .await
            .unwrap();
        for resource in [
            Resource::ChatSingleton,
            Resource::AssistantSingleton,
            Resource::PromptOptimizerSingleton,
        ] {
            assert!(
                engine
                    .authorize(
                        Subject::User("owner".into()),
                        resource.clone(),
                        Action::Create
                    )
                    .await
                    .is_ok()
            );
            assert!(
                engine
                    .authorize(
                        Subject::User("__not_logged_in__".into()),
                        resource,
                        Action::Create
                    )
                    .await
                    .is_err()
            );
        }
        assert!(
            engine
                .filter_authorized_facet_ids(
                    &Subject::User("owner".into()),
                    &[],
                    &["unknown".into()]
                )
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn batches_coalesce_and_warm_requests_reuse_facts(pool: PgPool) {
        let mut ids = Vec::new();
        for _ in 0..40 {
            ids.push(insert_chat(&pool, "owner").await);
        }
        let cache = SharedFacts::default();
        let mut db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
        let count = Arc::new(AtomicUsize::new(0));
        let counted = count.clone();
        let all_queries = Arc::new(AtomicUsize::new(0));
        let all_counted = all_queries.clone();
        db.set_metric_callback(move |info| {
            all_counted.fetch_add(1, Ordering::SeqCst);
            if info.statement.sql.contains("FROM \"chats\"") {
                counted.fetch_add(1, Ordering::SeqCst);
            }
        });
        let mut tasks = Vec::new();
        for _ in 0..12 {
            let loader = PolicyFactsLoader::new(db.clone(), cache.clone());
            let ids = ids.clone();
            tasks.push(tokio::spawn(async move {
                loader
                    .load(ResourceKind::Chat, &ids, Action::Read)
                    .await
                    .unwrap()
            }));
        }
        for task in tasks {
            assert_eq!(
                task.await.unwrap()["resource_attributes"]["chat"]
                    .as_object()
                    .unwrap()
                    .len(),
                40
            );
        }
        assert_eq!(
            count.load(Ordering::SeqCst),
            1,
            "one batched fact query across concurrent requests"
        );
        let before_warm = all_queries.load(Ordering::SeqCst);
        let warm = PolicyFactsLoader::new(db, cache);
        warm.load(ResourceKind::Chat, &ids, Action::Read)
            .await
            .unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1, "warm request reuses facts");
        assert_eq!(
            all_queries.load(Ordering::SeqCst),
            before_warm,
            "warm checks execute zero SQL statements"
        );
    }

    async fn wait_for_change(cache: &SharedFacts, epoch: u64) {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let current = cache.0.epoch.load(Ordering::SeqCst);
                if current > epoch && current.is_multiple_of(2) {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn generations_fence_late_publications_and_preserve_unrelated_entries() {
        let cache = SharedFacts::default();
        cache.reset(true);
        let key = Key(Kind::Chat, Uuid::new_v4());
        let other_key = Key(Kind::Chat, Uuid::new_v4());
        let slot = cache.slot(key).await;
        let other = cache.slot(other_key).await;
        let old = cache.observe();
        let unrelated = cache.publish(&other, 0, old, Fact::Chat(None)).unwrap();
        let mut pending_other = cache.observe();
        pending_other.fence_epoch = false;
        cache.invalidate(&[key]).await;
        assert!(
            cache
                .publish(&other, 0, pending_other, Fact::Chat(None))
                .is_some()
        );
        assert!(cache.publish(&slot, 0, old, Fact::Chat(None)).is_none());
        assert!(cache.valid(other_key, &unrelated).await);
        let earlier = cache.observe();
        let newer = cache.observe();
        let current = cache.publish(&slot, 1, newer, Fact::Chat(None)).unwrap();
        let delayed = cache.publish(&slot, 1, earlier, Fact::Chat(None)).unwrap();
        assert!(Arc::ptr_eq(&current.record, &delayed.record));
        cache.0.slots.invalidate(&key).await;
        assert!(!cache.valid(key, &current).await);
        assert!(!Arc::ptr_eq(&slot, &cache.slot(key).await));
    }

    #[tokio::test]
    async fn absolute_expiry_and_reconnection_reject_old_facts() {
        let cache = SharedFacts::default();
        cache.reset(true);
        let key = Key(Kind::File, Uuid::new_v4());
        let slot = cache.slot(key).await;
        let mut expired = cache.observe();
        expired.started -= FACT_MAX_AGE;
        assert!(cache.publish(&slot, 0, expired, Fact::File(None)).is_none());
        let observed = cache.observe();
        let entry = cache.publish(&slot, 0, observed, Fact::File(None)).unwrap();
        assert_eq!(entry.record.expires_at, observed.started + FACT_MAX_AGE);
        cache.reset(false);
        assert!(!cache.valid(key, &entry).await);
        assert!(
            cache
                .publish(&slot, 0, observed, Fact::File(None))
                .is_none()
        );
        cache.reset(true);
        assert!(!cache.valid(key, &entry).await);
        assert!(
            cache
                .publish(&slot, 0, observed, Fact::File(None))
                .is_none()
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn notifications_ignore_titles_and_rollback_but_track_delete_and_recreation(
        pool: PgPool,
    ) {
        let id = insert_chat(&pool, "owner").await;
        let cache = SharedFacts::default();
        let loader = loader(&pool, cache.clone());
        assert_eq!(
            owner(
                &loader
                    .load(ResourceKind::Chat, &[id], Action::Read)
                    .await
                    .unwrap(),
                id
            ),
            "owner"
        );
        let mut listener = sqlx::postgres::PgListener::connect_with(&pool)
            .await
            .unwrap();
        listener.listen(FACTS_CHANGED_CHANNEL).await.unwrap();
        sqlx::query("UPDATE chats SET title_by_user_provided = 'new title' WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let mut txn = pool.begin().await.unwrap();
        sqlx::query("UPDATE chats SET owner_user_id = 'other' WHERE id = $1")
            .bind(id)
            .execute(&mut *txn)
            .await
            .unwrap();
        txn.rollback().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.recv())
                .await
                .is_err()
        );
        let epoch = cache.observe().epoch;
        sqlx::query("DELETE FROM chats WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        wait_for_change(&cache, epoch).await;
        assert!(
            owner(
                &loader
                    .load(ResourceKind::Chat, &[id], Action::Read)
                    .await
                    .unwrap(),
                id
            )
            .is_null()
        );
        let epoch = cache.observe().epoch;
        sqlx::query("INSERT INTO chats (id, owner_user_id) VALUES ($1, 'new-owner')")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        wait_for_change(&cache, epoch).await;
        assert_eq!(
            owner(
                &loader
                    .load(ResourceKind::Chat, &[id], Action::Read)
                    .await
                    .unwrap(),
                id
            ),
            "new-owner"
        );
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn slow_key_does_not_block_unrelated_chat(pool: PgPool) {
        let a = insert_chat(&pool, "owner").await;
        let b = insert_chat(&pool, "owner").await;
        let loader = loader(&pool, SharedFacts::default());
        loader.observe().await.unwrap();
        let slot = loader.shared.slot(Key(Kind::Chat, a)).await;
        let hold = slot.loading.lock().await;
        let waiting = loader.clone();
        let task =
            tokio::spawn(async move { waiting.load(ResourceKind::Chat, &[a], Action::Read).await });
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            loader.load(ResourceKind::Chat, &[b], Action::Read),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(owner(&result, b), "owner");
        drop(hold);
        task.await.unwrap().unwrap();
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn committed_notifications_invalidate_both_replicas_and_only_changed_relationships(
        pool: PgPool,
    ) {
        let chat = insert_chat(&pool, "owner").await;
        let file: Uuid = sqlx::query_scalar("INSERT INTO file_uploads (owner_user_id, filename, file_storage_provider_id, file_storage_path) VALUES ('other', 'test', 'test', 'test') RETURNING id").fetch_one(&pool).await.unwrap();
        sqlx::query("INSERT INTO chat_file_uploads (chat_id, file_upload_id) VALUES ($1, $2)")
            .bind(chat)
            .bind(file)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO share_links (resource_type, resource_id, enabled) VALUES ('chat', $1, true)").bind(chat.to_string()).execute(&pool).await.unwrap();
        let caches = [SharedFacts::default(), SharedFacts::default()];
        let loaders = [
            loader(&pool, caches[0].clone()),
            loader(&pool, caches[1].clone()),
        ];
        for loader in &loaders {
            let facts = loader
                .load(ResourceKind::FileUpload, &[file], Action::Read)
                .await
                .unwrap();
            assert_eq!(facts["share_links"][0]["enabled"], true);
        }
        let associations = caches[0].slot(Key(Kind::Associations, file)).await;
        let original = associations.state.lock().unwrap().record.clone().unwrap();
        let epochs = [caches[0].observe().epoch, caches[1].observe().epoch];
        sqlx::query("UPDATE share_links SET enabled = false WHERE resource_id = $1")
            .bind(chat.to_string())
            .execute(&pool)
            .await
            .unwrap();
        for (index, loader) in loaders.iter().enumerate() {
            wait_for_change(&caches[index], epochs[index]).await;
            let facts = loader
                .load(ResourceKind::FileUpload, &[file], Action::Read)
                .await
                .unwrap();
            assert_eq!(facts["share_links"][0]["enabled"], false);
        }
        assert!(Arc::ptr_eq(
            &original,
            associations.state.lock().unwrap().record.as_ref().unwrap()
        ));
        let epochs = [caches[0].observe().epoch, caches[1].observe().epoch];
        sqlx::query("DELETE FROM chat_file_uploads WHERE file_upload_id = $1")
            .bind(file)
            .execute(&pool)
            .await
            .unwrap();
        for (index, loader) in loaders.iter().enumerate() {
            wait_for_change(&caches[index], epochs[index]).await;
            let facts = loader
                .load(ResourceKind::FileUpload, &[file], Action::Read)
                .await
                .unwrap();
            assert_eq!(
                facts["resource_attributes"]["file_upload"][file.to_string()]["linked_chat_ids"],
                json!([])
            );
        }
    }
    #[sqlx::test(migrator = "MIGRATOR")]
    async fn grant_revocation_updates_assistant_facts_without_evicting_file_relationships(
        pool: PgPool,
    ) {
        let user: Uuid = sqlx::query_scalar(
            "INSERT INTO users (issuer, subject) VALUES ('test', 'owner') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let assistant: Uuid = sqlx::query_scalar("INSERT INTO assistants (owner_user_id, name, prompt) VALUES ($1, 'test', 'test') RETURNING id").bind(user).fetch_one(&pool).await.unwrap();
        let file: Uuid = sqlx::query_scalar("INSERT INTO file_uploads (owner_user_id, filename, file_storage_provider_id, file_storage_path) VALUES ('other', 'test', 'test', 'test') RETURNING id").fetch_one(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO assistant_file_uploads (assistant_id, file_upload_id) VALUES ($1, $2)",
        )
        .bind(assistant)
        .bind(file)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO share_grants (resource_type, resource_id, subject_type, subject_id_type, subject_id, role) VALUES ('assistant', $1, 'user', 'id', 'viewer', 'viewer')").bind(assistant.to_string()).execute(&pool).await.unwrap();
        let cache = SharedFacts::default();
        let loader = loader(&pool, cache.clone());
        let before = loader
            .load(ResourceKind::FileUpload, &[file], Action::Read)
            .await
            .unwrap();
        assert_eq!(before["share_grants"].as_array().unwrap().len(), 1);
        let key = Key(Kind::Associations, file);
        let original_slot = cache.0.slots.get(&key).await.unwrap();
        let original_record = original_slot.state.lock().unwrap().record.clone().unwrap();
        let epoch = cache.observe().epoch;
        sqlx::query("DELETE FROM share_grants WHERE resource_id = $1")
            .bind(assistant.to_string())
            .execute(&pool)
            .await
            .unwrap();
        wait_for_change(&cache, epoch).await;
        let after = loader
            .load(ResourceKind::FileUpload, &[file], Action::Read)
            .await
            .unwrap();
        assert!(after["share_grants"].as_array().unwrap().is_empty());
        assert!(Arc::ptr_eq(
            &original_record,
            original_slot.state.lock().unwrap().record.as_ref().unwrap()
        ));
    }

    #[sqlx::test(migrator = "MIGRATOR")]
    async fn trusted_models_seed_requests_and_delayed_models_cannot_restore_old_ownership(
        pool: PgPool,
    ) {
        let id = insert_chat(&pool, "owner").await;
        let cache = SharedFacts::default();
        let loader = loader(&pool, cache.clone());
        let observation = loader.observe().await.unwrap();
        let model = chats::Entity::find_by_id(id)
            .one(&loader.db)
            .await
            .unwrap()
            .unwrap();
        loader.seed_chat(&model, observation).await;
        let key = Key(Kind::Chat, id);
        let seeded = loader.local.lock().await.get(&key).unwrap().clone();
        assert!(cache.valid(key, &seeded).await);
        let next = PolicyFactsLoader::new(loader.db.clone(), cache.clone());
        assert_eq!(
            owner(
                &next
                    .load(ResourceKind::Chat, &[id], Action::Read)
                    .await
                    .unwrap(),
                id
            ),
            "owner"
        );
        assert!(Arc::ptr_eq(
            &seeded.record,
            &next.local.lock().await.get(&key).unwrap().record
        ));
        let epoch = cache.observe().epoch;
        sqlx::query("UPDATE chats SET owner_user_id = 'new-owner' WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        wait_for_change(&cache, epoch).await;
        loader.seed_chat(&model, observation).await;
        assert_eq!(
            owner(
                &loader
                    .load(ResourceKind::Chat, &[id], Action::Read)
                    .await
                    .unwrap(),
                id
            ),
            "new-owner"
        );
    }
}
