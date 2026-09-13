# Backend authorization facts

Rego remains the decision engine. Requests reuse a prepared Regorus template
keyed by effective authorization configuration. Dynamic facts use `input.facts`;
changing input preserves preparation. Authentication/configuration checks perform
no resource queries. CPU evaluation permits are acquired after fact loading.

## Cache and invalidation

The shared process cache holds up to 20,000 fact slots; templates have a separate
16-entry cache. Requests retain reusable typed facts. Neither cache stores final
subject-specific decisions. Chat ownership/archive state, file ownership, file
associations, assistant ownership, assistant grants, Hub state and chat share links
have separate keys. Concurrent misses coalesce per key; collection and relationship
queries use batches of up to 256 keys. Missing records and empty relationships are
cached explicitly. Database errors are never cached as absence.

Generations and publication sequence numbers exist **only in application memory**.
There is no database revision table, revision write or revision query. Once the
listener is established, a warm authorization check executes zero SQL statements
and does not check out a database connection. Cache hits do not extend expiry.
Facts expire five seconds after the start of their database operation, including
trusted model loads; excessively delayed results cannot be published.

Migration `0041_notify_policy_fact_changes` installs row triggers on the eight
fact source tables. They send affected keys through PostgreSQL `LISTEN/NOTIFY`
only for policy-relevant changes. Notifications are delivered after commit and
are discarded on rollback. Inserts, deletes, cascades and moved associations
identify the affected old/new keys. A title update produces no notification; a
grant revocation invalidates assistant grants without evicting file associations.
The database does work to emit notifications on writes, but stores no revision
records and performs no cache validation queries on reads.

Each process cache maintains one dedicated listening connection, started lazily
for resource access. It uses the application database connection options but does
not reserve a slot in the ordinary query pool. Database connection capacity must
allow this additional connection per replica. On detected disconnection, the cache is cleared and
resource checks fail closed until listening resumes; reconnect clears it again.
Authentication/configuration-only checks do not need the listener. Unexpected
notification payloads also clear the cache. Absolute expiry limits stale reuse if
a notification is missed or a disconnect has not yet been detected.

## Consistency contract

Invalidation is asynchronous across replicas, including the writing replica.
A check can use pre-write facts until its notification is processed or those facts
expire. Thus a committed permission revocation is **not immediately consistent**;
stale reuse is bounded by the five-second absolute fact lifetime. This bound is
measured at context assembly, not completion of the protected operation. Already
assembled evaluations can finish. This tradeoff removes database validation from
the read path; no production latency/load measurements are claimed.

The loader checks slot identity, then validates the assembled context's
generations and expiry in one short memory-only critical section. A
changed dependency causes a retry; unrelated changes do not discard loaded facts.
An in-memory notification epoch additionally fences trusted-model seeding.
Invalidations cannot publish older data even if duplicated or reordered. Publication sequence numbers prevent delayed results replacing newer
published results in the same slot. Evicted slots cannot resurrect their entries.

Cold batches use read-only repeatable-read transactions. Cached records and
separate dependency batches do **not** share a single database snapshot. The
contract is bounded freshness with coherence against locally observed
invalidations, not a globally atomic snapshot of all facts. Authorization and the
protected operation are not one atomic transaction. Workflows requiring immediate
revocation or an atomic permission/write boundary need a stronger mechanism.

Trusted model observations are captured before the database operation; returned
write models are seeded only after commit. Never capture a new observation for an
old model or seed from HTTP payloads. A notification racing a seed can discard it,
causing a targeted reload. It cannot trigger a full policy rebuild.

## Deployment and validation

Deploy migration 0041 before this backend. Existing writers also emit notifications
through the triggers. Revert only after rolling back all backends relying on them.
Administrative `TRUNCATE`, disabled triggers and writes bypassing these tables are
outside notification coverage; restart application replicas after maintenance.
Expiry still prevents indefinite cached reuse.

Run `just test_policy` for OPA and
`DATABASE_URL=... RUST_MIN_STACK=8388608 cargo test -p erato --lib policy::` for
policy/cache tests. SQLx creates isolated databases and applies the Sqitch files.
Tests cover warm zero-query access, batched concurrent misses, authentication
without a database, generation/publication races, expiry, reconnect fencing,
rollback, deletion/recreation, independent-key progress, and replica invalidation.
