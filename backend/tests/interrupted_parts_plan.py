"""Run against a disposable, empty PostgreSQL database (creates public tables).

Usage: python3 tests/interrupted_parts_plan.py postgresql://.../disposable_db
Uses psql only; reads the production SQL and actual migration, not a query copy.

PostgreSQL 17.2, local Docker with tmpfs, 100k ~1 KiB historical messages:
  empty baseline generic: 45.230 ms, 16,741 shared buffers (544 reads)
  indexed generic: empty 0.025 ms / 1 buffer; 3 candidates 0.069 ms / 3 buffers;
                   405 candidates 0.191 ms / 43 buffers (200 returned)
  indexed custom: empty 0.020 ms; 3 candidates 0.036 ms; 405 candidates 0.177 ms
  index with 405 candidates: 16 KiB.
These are single-run synthetic measurements, not production latency predictions.

A partial B-tree avoids a GIN entry for all historical message content and serves
ORDER BY directly. It still evaluates the JSON predicate on writes, and updates
to raw_message/updated_at can prevent HOT updates; unresolved messages churn the
index. A stored candidate marker would add schema/write-path complexity. The
broad predicate deliberately retains existing candidate and recovery semantics.

Rollout: the transactional migration scans history once and blocks writes while
building; schedule a maintenance window on large installations. Existing Sqitch
and SQLx migration runners expect transactional migrations, so this does not use
CREATE INDEX CONCURRENTLY. Roll back with the revert migration if necessary;
the query remains correct without the index, but becomes slow again.
After rollout compare pod-labeled erato_postgres_query_duration_seconds_sum/count
for query_id=interrupted_parts_scan, slow warnings, buffer usage, index size and
write latency. Production rollout/monitoring must be done in the target environment.
Duplicated workers and the existing scan-to-settle concurrency window are unchanged.
"""
import json
from pathlib import Path
import re
import subprocess
import sys

BACKEND = Path(__file__).resolve().parents[1]
URI = sys.argv[1]


def sql(query):
    return subprocess.check_output(
        ["psql", "-XAt", "-v", "ON_ERROR_STOP=1", URI, "-c", query], text=True
    ).strip()


source = (BACKEND / "erato/src/services/interrupted_parts.rs").read_text()
query = re.search(r'r#"\s*(SELECT "messages".*?)"#', source, re.S)[1]
chat_source = (BACKEND / "erato/src/models/chat.rs").read_text()
unfinished = re.search(
    r'fn generation_unfinished_condition.*?r#"(.*?)"#', chat_source, re.S
)[1].replace("{alias}", '"chats"').replace("{param_index}", "1")
query = query.replace("{unfinished}", unfinished).replace("{{", "{").replace("}}", "}")
# Equivalent old parameterized query for the baseline and generic-plan control.
probe = "'[{\"content_type\":\"tool_use\",\"status\":\"in_progress\"}]'::jsonb"
old_query = query.replace("$2", "$3").replace("$1", "$2").replace(probe, "$1::jsonb")

sql("""
CREATE TABLE chats (id uuid PRIMARY KEY, generation_state text, generation_heartbeat_at timestamptz);
CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid REFERENCES chats,
    raw_message jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO chats VALUES ('00000000-0000-0000-0000-000000000001', NULL, NULL);
INSERT INTO messages (chat_id, raw_message)
SELECT '00000000-0000-0000-0000-000000000001',
    jsonb_build_object('role','assistant','content',jsonb_build_array(
        jsonb_build_object('content_type','text','text',repeat(md5(i::text), 32))))
FROM generate_series(1, 100000) i;
ANALYZE messages; ANALYZE chats;
""")


def plan(mode, old=False):
    prepare = ("PREPARE scan(text, double precision, bigint) AS " + old_query
               if old else "PREPARE scan(double precision, bigint) AS " + query)
    args = (probe.removesuffix("::jsonb") + ",90,200") if old else "90,200"
    result = sql(f"SET plan_cache_mode={mode}; {prepare}; "
                 f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE scan({args})")
    return json.loads(result[result.index("["):])[0]


def nodes(node):
    yield node
    for child in node.get("Plans", []):
        yield from nodes(child)


def report(label, result):
    root = result["Plan"]
    print(label, json.dumps({
        "ms": result["Execution Time"], "rows": root["Actual Rows"],
        "hit_blocks": root.get("Shared Hit Blocks", 0),
        "read_blocks": root.get("Shared Read Blocks", 0),
        "nodes": [n["Node Type"] for n in nodes(root)],
    }))


report("before/empty/generic", plan("force_generic_plan", old=True))
name = "0059_add_interrupted_parts_index.sql"
sql((BACKEND / "sqitch/deploy" / name).read_text())
sql((BACKEND / "sqitch/verify" / name).read_text())
# A bound JSON predicate alone cannot imply the partial index in a generic plan.
control = plan("force_generic_plan", old=True)
assert any(n.get("Relation Name") == "messages" and n["Node Type"] == "Seq Scan"
           for n in nodes(control["Plan"]))
for count in (0, 3, 405):
    if count:
        sql(f"""INSERT INTO messages (chat_id, raw_message)
            SELECT '00000000-0000-0000-0000-000000000001',
            '{{"content":[{{"content_type":"tool_use","status":"in_progress","output":{{"status":"queued"}}}}]}}'::jsonb
            FROM generate_series(1,{count - (3 if count == 405 else 0)});
            ANALYZE messages;""")
    for mode in ("force_generic_plan", "force_custom_plan"):
        result = plan(mode)
        report(f"after/{count}/{mode}", result)
        assert result["Plan"]["Actual Rows"] == min(count, 200)
        assert any(n.get("Index Name") == "idx_messages_interrupted_parts"
                   for n in nodes(result["Plan"]))
        assert not any(n.get("Relation Name") == "messages" and n["Node Type"] == "Seq Scan"
                       for n in nodes(result["Plan"]))
print("index_bytes", sql("SELECT pg_relation_size('idx_messages_interrupted_parts')"))
sql((BACKEND / "sqitch/revert" / name).read_text())
sql((BACKEND / "sqitch/deploy" / name).read_text())
sql((BACKEND / "sqitch/verify" / name).read_text())
print("deploy/verify/revert/redeploy passed")
