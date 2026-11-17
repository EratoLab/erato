use super::*;
use crate::models::message::{ToolCallObjectKind, ToolCallRead};
use ToolCallReadOperator as Op;
use rmcp::model::{Tool, ToolAnnotations};
use serde_json::{Value, json};

fn condition(column: &str, operator: Op, values: &[&str]) -> PlainCondition {
    PlainCondition {
        column: column.to_string(),
        operator,
        values: values.iter().map(|value| value.to_string()).collect(),
        values_omitted: 0,
    }
}

fn read(
    tables: &[&str],
    conditions: Vec<PlainCondition>,
    undescribed: u32,
    limit: Option<u64>,
) -> PlainRead {
    PlainRead {
        tables: tables.iter().map(|table| table.to_string()).collect(),
        tables_omitted: 0,
        conditions,
        undescribed,
        limit,
    }
}

/// Plain reads and what each says.
fn reads() -> Vec<(&'static str, &'static str, PlainRead)> {
    vec![
        (
            "plain",
            "SELECT name FROM account",
            read(&["account"], vec![], 0, None),
        ),
        (
            "star",
            "select * from account;",
            read(&["account"], vec![], 0, None),
        ),
        (
            "where",
            "SELECT name FROM account WHERE name = 'Müller GmbH'",
            read(
                &["account"],
                vec![condition("name", Op::Equals, &["Müller GmbH"])],
                0,
                None,
            ),
        ),
        (
            "where, order by, top",
            "SELECT TOP 10 name, estimatedclosedate FROM opportunity WHERE statecode = 0 ORDER BY estimatedclosedate DESC",
            read(
                &["opportunity"],
                vec![condition("statecode", Op::Equals, &["0"])],
                0,
                Some(10),
            ),
        ),
        (
            "top in brackets",
            "SELECT TOP (5) subject FROM task",
            read(&["task"], vec![], 0, Some(5)),
        ),
        (
            "limit",
            "SELECT name FROM account WHERE revenue >= 1000000 LIMIT 20",
            read(
                &["account"],
                vec![condition("revenue", Op::AtLeast, &["1000000"])],
                0,
                Some(20),
            ),
        ),
        (
            "offset fetch",
            "SELECT name FROM account ORDER BY name OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY",
            read(&["account"], vec![], 0, Some(25)),
        ),
        (
            "several conditions",
            "SELECT subject FROM task WHERE statecode = 0 AND prioritycode > 1 AND subject LIKE '%Angebot%' AND description IS NULL",
            read(
                &["task"],
                vec![
                    condition("statecode", Op::Equals, &["0"]),
                    condition("prioritycode", Op::Greater, &["1"]),
                    condition("subject", Op::Contains, &["Angebot"]),
                    condition("description", Op::IsEmpty, &[]),
                ],
                0,
                None,
            ),
        ),
        (
            "literal on the left, starts with, in, between",
            "SELECT name FROM contact WHERE 10 < age AND lastname LIKE 'Mü%' AND city IN ('Berlin', 'Köln') AND createdon BETWEEN '2026-01-01' AND '2026-03-31'",
            read(
                &["contact"],
                vec![
                    condition("age", Op::Greater, &["10"]),
                    condition("lastname", Op::StartsWith, &["Mü"]),
                    condition("city", Op::In, &["Berlin", "Köln"]),
                    condition("createdon", Op::Between, &["2026-01-01", "2026-03-31"]),
                ],
                0,
                None,
            ),
        ),
        (
            "an OR is not said",
            "SELECT name FROM account WHERE statecode = 0 AND (name = 'A' OR name = 'B')",
            read(
                &["account"],
                vec![condition("statecode", Op::Equals, &["0"])],
                1,
                None,
            ),
        ),
        (
            "a join",
            "SELECT o.name, a.name FROM opportunity o INNER JOIN account a ON o.parentaccountid = a.accountid WHERE a.name = N'Müller GmbH'",
            read(
                &["opportunity", "account"],
                vec![condition("name", Op::Equals, &["Müller GmbH"])],
                0,
                None,
            ),
        ),
        (
            "a left join, the same table twice",
            "SELECT * FROM account a LEFT JOIN account p ON a.parentaccountid = p.accountid",
            read(&["account"], vec![], 0, None),
        ),
        (
            "a subquery in the condition",
            "SELECT name FROM account WHERE accountid IN (SELECT parentaccountid FROM opportunity WHERE statecode = 0)",
            read(&["account"], vec![], 1, None),
        ),
        (
            "a derived table",
            "SELECT x.name FROM (SELECT name FROM account WHERE statecode = 0) x",
            read(&["account"], vec![], 1, None),
        ),
        (
            "exists",
            "SELECT name FROM account a WHERE EXISTS (SELECT 1 FROM task t WHERE t.regardingobjectid = a.accountid)",
            read(&["account"], vec![], 1, None),
        ),
        (
            "a read CTE",
            "WITH open_tasks AS (SELECT subject FROM task WHERE statecode = 0) SELECT subject FROM open_tasks",
            read(&["task"], vec![], 1, None),
        ),
        (
            "union",
            "SELECT name FROM account UNION SELECT fullname FROM contact",
            read(&["account", "contact"], vec![], 0, None),
        ),
        (
            "aggregates",
            "SELECT COUNT(*), MAX(estimatedvalue) FROM opportunity WHERE statecode = 0 GROUP BY ownerid HAVING COUNT(*) > 2",
            read(
                &["opportunity"],
                vec![condition("statecode", Op::Equals, &["0"])],
                1,
                None,
            ),
        ),
        (
            "T-SQL brackets, schema, table hint",
            "SELECT [name], a.[accountid] FROM [dbo].[account] a WITH (NOLOCK) WHERE a.[statecode] = 0",
            read(
                &["account"],
                vec![condition("statecode", Op::Equals, &["0"])],
                0,
                None,
            ),
        ),
        (
            "T-SQL functions and a cast",
            "SELECT TOP 3 name, CONVERT(varchar(10), createdon, 104), ISNULL(revenue, 0) FROM account WHERE YEAR(createdon) = 2026 AND name LIKE N'%GmbH'",
            read(
                &["account"],
                vec![condition("name", Op::EndsWith, &["GmbH"])],
                1,
                Some(3),
            ),
        ),
        (
            "a record by its key",
            "SELECT * FROM opportunity WHERE opportunityid = '7d2c1f00-1111-4c4c-8a8a-000000000001'",
            read(
                &["opportunity"],
                vec![condition(
                    "opportunityid",
                    Op::Equals,
                    &["7d2c1f00-1111-4c4c-8a8a-000000000001"],
                )],
                0,
                None,
            ),
        ),
        (
            "a comment beside a read",
            "-- open deals\nSELECT name FROM opportunity /* only open */ WHERE statecode = 0",
            read(
                &["opportunity"],
                vec![condition("statecode", Op::Equals, &["0"])],
                0,
                None,
            ),
        ),
        (
            "a write word inside a string",
            "SELECT subject FROM task WHERE subject = 'Update the offer; then delete the draft'",
            read(
                &["task"],
                vec![condition(
                    "subject",
                    Op::Equals,
                    &["Update the offer; then delete the draft"],
                )],
                0,
                None,
            ),
        ),
        (
            "a backslash in a value",
            r"SELECT name FROM account WHERE name = 'a\b'",
            read(&["account"], vec![], 1, None),
        ),
        (
            "a window function",
            "SELECT name, ROW_NUMBER() OVER (PARTITION BY ownerid ORDER BY name) FROM account",
            read(&["account"], vec![], 0, None),
        ),
    ]
}

/// Statements that are not certainly one plain read, by why.
const NOT_READS: [(&str, &str); 44] = [
    ("empty", ""),
    ("blank", "  \n "),
    ("malformed", "SELEC name FROM account"),
    ("cut off", "SELECT name FROM"),
    ("not SQL", "Müller GmbH"),
    ("insert", "INSERT INTO account (name) VALUES ('x')"),
    (
        "update",
        "UPDATE account SET name = 'x' WHERE accountid = 1",
    ),
    ("delete", "DELETE FROM account WHERE accountid = 1"),
    (
        "merge",
        "MERGE INTO account t USING staging s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = s.name",
    ),
    ("truncate", "TRUNCATE TABLE account"),
    ("drop", "DROP TABLE account"),
    ("create", "CREATE TABLE x (id int)"),
    ("alter", "ALTER TABLE account ADD x int"),
    ("grant", "GRANT SELECT ON account TO public"),
    ("select into", "SELECT name INTO #copy FROM account"),
    (
        "select into a table",
        "SELECT * INTO backup_account FROM account",
    ),
    (
        "select into outfile",
        "SELECT * FROM account INTO OUTFILE '/tmp/x'",
    ),
    ("for update", "SELECT * FROM account FOR UPDATE"),
    (
        "two statements",
        "SELECT name FROM account; DELETE FROM account",
    ),
    (
        "two reads",
        "SELECT name FROM account; SELECT name FROM contact",
    ),
    (
        "no separator, T-SQL",
        "SELECT name FROM account DELETE FROM account",
    ),
    (
        "no separator after a where",
        "SELECT name FROM account WHERE 1 = 1 UPDATE account SET name = 'x'",
    ),
    (
        "a comment hides a second statement in T-SQL",
        "SELECT name FROM account # ; DELETE FROM account",
    ),
    (
        "a block comment before a second statement",
        "SELECT name FROM account /* x */ ; DELETE FROM account",
    ),
    (
        "a nested comment some dialects close early",
        "SELECT 1 /* /* */ DELETE FROM account */",
    ),
    (
        "a backslash quote T-SQL ends early",
        r"SELECT name FROM account WHERE name = 'x\' ; DELETE FROM account; --'",
    ),
    ("exec", "EXEC sp_who"),
    (
        "execute a procedure",
        "EXECUTE dbo.purge_accounts @days = 30",
    ),
    ("call", "CALL purge_accounts(30)"),
    (
        "a CTE that deletes",
        "WITH gone AS (DELETE FROM account RETURNING *) SELECT * FROM gone",
    ),
    (
        "a CTE that inserts",
        "WITH x AS (INSERT INTO log VALUES (1) RETURNING id) SELECT id FROM x",
    ),
    (
        "a function that may write",
        "SELECT dbo.archive_account(accountid) FROM account",
    ),
    ("a sequence", "SELECT nextval('order_seq')"),
    ("a backend call", "SELECT pg_terminate_backend(42)"),
    (
        "a table function",
        "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'SELECT 1')",
    ),
    (
        "openquery",
        "SELECT * FROM OPENQUERY(remote, 'DELETE FROM account')",
    ),
    ("declare", "DECLARE @x int; SELECT @x"),
    ("set then select", "SET NOCOUNT ON SELECT name FROM account"),
    ("waitfor", "WAITFOR DELAY '00:01:00' SELECT 1"),
    ("values", "VALUES (1), (2)"),
    ("explain analyze", "EXPLAIN ANALYZE SELECT * FROM account"),
    ("show", "SHOW TABLES"),
    (
        "a transaction",
        "BEGIN TRANSACTION SELECT name FROM account COMMIT",
    ),
    (
        "an output clause",
        "DELETE FROM account OUTPUT deleted.* WHERE accountid = 1",
    ),
];

#[test]
fn plain_reads_are_described_by_their_tables_conditions_and_limit() {
    for (name, sql, expected) in reads() {
        assert_eq!(plain_read(sql), Some(expected), "{name}: {sql}");
    }
}

#[test]
fn anything_beyond_one_plain_read_gets_no_description() {
    for (name, sql) in NOT_READS {
        assert_eq!(plain_read(sql), None, "{name}: {sql}");
    }
}

#[test]
fn a_statement_is_recognised_behind_leading_comments() {
    assert!(may_be_sql("/* note */ DELETE FROM account"));
    assert!(may_be_sql("-- note\n  delete from account"));
    assert!(may_be_sql("(SELECT name FROM account)"));
    assert!(!may_be_sql("-- just a note"));
    assert!(!may_be_sql("Müller GmbH"));
    assert!(!may_be_sql("delete pages about Q4"));
}

#[test]
fn a_huge_or_deeply_nested_statement_gets_no_description() {
    let long = format!(
        "SELECT name FROM account WHERE name = '{}'",
        "x".repeat(MAX_SQL_BYTES)
    );
    assert_eq!(plain_read(&long), None);
    let deep = format!(
        "SELECT name FROM account WHERE {}1 = 1{}",
        "(".repeat(200),
        ")".repeat(200)
    );
    assert_eq!(plain_read(&deep), None);
}

#[test]
fn many_tables_conditions_and_values_are_counted() {
    let sql = "SELECT * FROM a JOIN b ON a.x = b.x JOIN c ON a.x = c.x JOIN d ON a.x = d.x JOIN e ON a.x = e.x \
               WHERE a.k1 = 1 AND a.k2 = 2 AND a.k3 = 3 AND a.k4 = 4 AND a.k5 = 5 AND a.k6 = 6 AND a.k7 = 7 \
               AND a.s IN (1, 2, 3, 4, 5, 6, 7)";
    let read = plain_read(sql).expect("a read");
    assert_eq!(read.tables, ["a", "b", "c", "d"]);
    assert_eq!(read.tables_omitted, 1);
    assert_eq!(read.conditions.len(), MAX_CONDITIONS);
    assert_eq!(read.undescribed, 2);
}

#[test]
fn the_key_of_the_only_table_names_the_record_read() {
    let mut read =
        plain_read("SELECT name FROM opportunity WHERE opportunityid = 'abc' AND statecode = 0")
            .expect("a read");
    assert_eq!(take_key_lookup(&mut read).as_deref(), Some("abc"));
    assert_eq!(
        read.conditions,
        [condition("statecode", Op::Equals, &["0"])]
    );
    for sql in [
        "SELECT name FROM account WHERE id = 7",
        "SELECT name FROM account WHERE account_id = 7",
    ] {
        let mut read = plain_read(sql).expect("a read");
        assert_eq!(take_key_lookup(&mut read).as_deref(), Some("7"), "{sql}");
    }
    // Another table's key, a join, or a range is no lookup.
    for sql in [
        "SELECT name FROM opportunity WHERE parentaccountid = 'abc'",
        "SELECT o.name FROM opportunity o JOIN account a ON o.parentaccountid = a.accountid WHERE a.accountid = 'abc'",
        "SELECT name FROM account WHERE accountid > 5",
    ] {
        let mut read = plain_read(sql).expect("a read");
        assert_eq!(take_key_lookup(&mut read), None, "{sql}");
    }
}

// ---------------------------------------------------------------------------
// Through the whole display, as a chat labels the call.

fn tool(name: &str, annotations: Option<ToolAnnotations>) -> Tool {
    let mut tool = Tool::new(
        name.to_string(),
        "",
        std::sync::Arc::new(Default::default()),
    );
    tool.annotations = annotations;
    tool
}

fn hints(read_only: Option<bool>, destructive: Option<bool>) -> ToolAnnotations {
    let mut hints = ToolAnnotations::default();
    hints.read_only_hint = read_only;
    hints.destructive_hint = destructive;
    hints
}

fn read_only() -> Option<ToolAnnotations> {
    Some(hints(Some(true), Some(false)))
}

fn display_read(tool: &Tool, arguments: &Value) -> Option<ToolCallRead> {
    crate::services::tool_display::mcp_tool_call_display(
        &crate::config::McpRuntimeConfig::default(),
        "server",
        tool,
        arguments,
        None,
        &Default::default(),
    )
    .label?
    .read
}

#[test]
fn every_statement_that_is_not_a_plain_read_leaves_the_call_without_a_read() {
    for (name, sql) in NOT_READS {
        for (tool_name, member) in [
            ("read_query", "querytext"),
            ("query", "sql"),
            ("search", "query"),
        ] {
            let read = display_read(&tool(tool_name, read_only()), &json!({ member: sql }));
            assert!(
                read.as_ref().is_none_or(|read| read.query.is_none()),
                "{name} via {tool_name}: {read:?}"
            );
            // A text without the shape of a statement may still be what a
            // search looks for; a statement never is.
            if may_be_sql(sql) {
                assert_eq!(read, None, "{name} via {tool_name}");
            }
        }
    }
}

#[test]
fn a_plain_read_is_described_through_any_member_that_holds_it() {
    let sql = "SELECT TOP 10 name FROM opportunity WHERE statecode = 0";
    for (tool_name, arguments) in [
        ("read_query", json!({"querytext": sql, "top": 10})),
        ("read_query", json!({"sql": sql})),
        ("query", json!({"query": sql})),
        ("execute_sql", json!({"statement": sql})),
        ("run_query", json!({"params": {"sql": sql}})),
    ] {
        let read = display_read(&tool(tool_name, None), &arguments).unwrap_or_else(|| {
            let display = crate::services::tool_display::mcp_tool_call_display(
                &crate::config::McpRuntimeConfig::default(),
                "server",
                &tool(tool_name, None),
                &arguments,
                None,
                &Default::default(),
            );
            panic!("{tool_name} {arguments}: {:#?}", display.label)
        });
        assert_eq!(read.object_kind, ToolCallObjectKind::Row);
        assert!(read.filtered);
        let query = read.query.expect("a query");
        assert_eq!(query.tables, ["opportunity"]);
        assert_eq!(query.limit, Some(10));
        assert_eq!(query.conditions.len(), 1);
        assert_eq!(query.conditions[0].column, "statecode");
        assert_eq!(query.conditions[0].values[0].text, "0");
    }
}

#[test]
fn a_kind_table_gives_the_kind_and_a_key_gives_the_item() {
    let read = display_read(
        &tool("read_query", read_only()),
        &json!({"querytext": "SELECT subject FROM task WHERE taskid = '7d2c1f00-1111-4c4c-8a8a-000000000001'"}),
    )
    .expect("a read");
    assert_eq!(read.object_kind, ToolCallObjectKind::Task);
    let id = read.item.and_then(|item| item.id).expect("an id");
    assert_eq!(id.pointer, "/querytext");
    assert!(id.values[0].machine_id);
    assert!(!read.filtered);
}

#[test]
fn the_call_around_the_statement_must_only_read_too() {
    let sql = "SELECT name FROM account";
    let cases = [
        (
            "the tool says it may change things",
            tool("read_query", Some(hints(Some(false), None))),
            json!({"querytext": sql}),
        ),
        (
            "the tool says it destroys",
            tool("read_query", Some(hints(None, Some(true)))),
            json!({"querytext": sql}),
        ),
        (
            "the name writes",
            tool("update_query", None),
            json!({"querytext": sql}),
        ),
        (
            "the name loses",
            tool("purge_query", None),
            json!({"querytext": sql}),
        ),
        (
            "the name marks",
            tool("read_and_mark_query", None),
            json!({"querytext": sql}),
        ),
        (
            "a flag that does more",
            tool("read_query", None),
            json!({"querytext": sql, "notify": true}),
        ),
        (
            "a verb field",
            tool("read_query", None),
            json!({"querytext": sql, "action": "delete"}),
        ),
        (
            "an argument the rules do not know",
            tool("read_query", None),
            json!({"querytext": sql, "callback": "x"}),
        ),
        (
            "two statements in two members",
            tool("read_query", None),
            json!({"querytext": sql, "second": sql}),
        ),
        (
            "an OData batch beside it",
            tool("read_query", None),
            json!({"querytext": sql, "body": "POST $batch"}),
        ),
    ];
    for (name, tool, arguments) in cases {
        assert_eq!(display_read(&tool, &arguments), None, "{name}");
    }
}

#[test]
fn values_are_cleaned_and_named_by_earlier_results() {
    let read = display_read(
        &tool("read_query", read_only()),
        &json!({"querytext": "SELECT name FROM account WHERE name = N'M\u{200B}üller'"}),
    )
    .expect("a read");
    let query = read.query.expect("a query");
    assert_eq!(query.conditions[0].values[0].text, "Müller");
    assert_eq!(
        read.warnings,
        [crate::models::message::ToolCallLabelWarning::HiddenCharacters]
    );
}

#[test]
fn columns_and_coded_values_go_by_the_operators_glossary() {
    let config: crate::config::McpRuntimeConfig = serde_json::from_value(json!({
        "mcp_servers": {
            "crm": {
                "transport_type": "streamable_http",
                "url": "http://localhost/mcp",
                "glossary": {
                    "field_names": {"risklevel": "Risk level"},
                    "choice_labels": {"risklevel": {"3": "High"}},
                },
            },
        }
    }))
    .unwrap();
    let read = crate::services::tool_display::mcp_tool_call_display(
        &config,
        "crm",
        &tool("read_query", read_only()),
        &json!({"querytext": "SELECT name FROM opportunity WHERE risklevel = 3 AND statecode = 0"}),
        None,
        &Default::default(),
    )
    .label
    .and_then(|label| label.read)
    .expect("a read");
    let conditions = read.query.expect("a query").conditions;
    assert_eq!(conditions[0].column, "Risk level");
    assert_eq!(conditions[0].values[0].text, "High");
    assert_eq!(conditions[1].column, "statecode");
    assert_eq!(conditions[1].values[0].text, "0");
}

#[test]
fn a_long_statement_the_card_shows_as_text_is_still_the_statement() {
    let long = format!(
        "SELECT subject FROM task WHERE description = '{}'",
        "wort ".repeat(60).trim_end()
    );
    let read = display_read(
        &tool("read_query", read_only()),
        &json!({"querytext": long}),
    )
    .expect("a read");
    assert_eq!(read.query.expect("a query").conditions.len(), 1);
    // A long text in another member is something the call writes or sends.
    assert_eq!(
        display_read(
            &tool("read_query", read_only()),
            &json!({"querytext": "SELECT name FROM account", "note": "wort ".repeat(60)}),
        ),
        None
    );
}
