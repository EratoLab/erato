//! Links to the records an MCP call reads, creates or changes, built from the
//! tool's `record_links` rules for servers whose results carry no links.

use crate::config::{McpRecordLinkConfig, McpRecordLinkValueConfig, record_link_placeholders};
use crate::services::tool_display::label::pointer;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;

/// Record links one call gets, so a long read costs a bounded prompt.
pub const MAX_RECORD_LINKS: usize = 25;
/// A longer value is no record's name or key.
const MAX_VALUE_BYTES: usize = 256;

/// Everything but RFC 3986's unreserved characters.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

#[derive(Debug, Clone, PartialEq)]
pub struct RecordLink {
    pub url: String,
    pub title: Option<String>,
}

/// What the model reads after a result whose records have links.
pub fn links_for_model<'a>(links: impl IntoIterator<Item = (&'a str, Option<&'a str>)>) -> String {
    let lines: Vec<_> = links
        .into_iter()
        .map(|(url, title)| match title {
            Some(title) => format!("- {title}: {url}"),
            None => format!("- {url}"),
        })
        .collect();
    if lines.is_empty() {
        return String::new();
    }
    format!("\n\nLinks to open these records:\n{}", lines.join("\n"))
}

/// The links of a result marked for the model, as it reads them after the
/// result's output.
pub fn model_read_links(links: &[crate::models::message::ToolResultLink]) -> String {
    links_for_model(
        links
            .iter()
            .filter(|link| link.for_model)
            .map(|link| (link.uri.as_str(), link.title.as_deref())),
    )
}

struct Source<'a> {
    config: &'a McpRecordLinkValueConfig,
    result_text: Option<Regex>,
    pattern: Option<Regex>,
}

struct Rule<'a> {
    config: &'a McpRecordLinkConfig,
    values: Vec<(&'a str, Source<'a>)>,
    when: Vec<(&'a str, Regex)>,
}

impl<'a> Rule<'a> {
    /// `None` for a rule the config check would have refused.
    fn compile(config: &'a McpRecordLinkConfig) -> Option<Self> {
        let regex = |pattern: &Option<String>| match pattern {
            Some(pattern) => Regex::new(pattern).ok().map(Some),
            None => Some(None),
        };
        let values = config
            .values
            .iter()
            .map(|(name, source)| {
                Some((
                    name.as_str(),
                    Source {
                        config: source,
                        result_text: regex(&source.result_text)?,
                        pattern: regex(&source.pattern)?,
                    },
                ))
            })
            .collect::<Option<Vec<_>>>()?;
        let when = config
            .when
            .iter()
            .map(|(name, pattern)| Some((name.as_str(), Regex::new(pattern).ok()?)))
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            config,
            values,
            when,
        })
    }

    fn has_rows(&self) -> bool {
        self.config.rows.is_some()
    }

    /// The values found without a row.
    fn call_values(&self, arguments: Option<&Value>, text: &str) -> HashMap<&'a str, String> {
        let first_reached = |pointer: &str| {
            arguments
                .and_then(|arguments| pointer::resolve(arguments, pointer).into_iter().next())
                .map(|reached| reached.value)
        };
        self.values
            .iter()
            .filter(|(_, source)| !source.config.is_row())
            .filter_map(|(name, source)| {
                let found = match (&source.config.sql_table, &source.result_text) {
                    (Some(pointer), _) => first_reached(pointer)
                        .and_then(Value::as_str)
                        .and_then(crate::services::tool_display::label::single_read_table),
                    (None, Some(regex)) => first_group(regex, text),
                    (None, None) => source
                        .config
                        .argument
                        .iter()
                        .find_map(|pointer| scalar(first_reached(pointer)?)),
                };
                Some((*name, refined(source, found?)?))
            })
            .collect()
    }

    fn link(
        &self,
        call_values: &HashMap<&'a str, String>,
        row: Option<&Value>,
    ) -> Option<RecordLink> {
        let mut values = call_values.clone();
        if let Some(row) = row {
            for (name, source) in self.values.iter().filter(|(_, s)| s.config.is_row()) {
                let found = source.config.row.iter().find_map(|member| {
                    let member = fill(member, &values, str::to_owned)?;
                    scalar(row.get(member)?)
                });
                if let Some(value) = found.and_then(|found| refined(source, found)) {
                    values.insert(name, value);
                }
            }
        }
        let when_met = self
            .when
            .iter()
            .all(|(name, regex)| values.get(name).is_some_and(|value| regex.is_match(value)));
        if !when_met {
            return None;
        }
        let url = fill(&self.config.url, &values, |value| {
            utf8_percent_encode(value, COMPONENT).to_string()
        })?;
        let title = self
            .config
            .title
            .as_deref()
            .and_then(|title| fill(title, &values, str::to_owned));
        Some(RecordLink { url, title })
    }
}

/// `template` with each placeholder replaced by its value in one pass, so a
/// value never fills a placeholder itself; `None` when one has no value.
fn fill(
    template: &str,
    values: &HashMap<&str, String>,
    encode: impl Fn(&str) -> String,
) -> Option<String> {
    let mut filled = String::with_capacity(template.len());
    let mut rest = template;
    for name in record_link_placeholders(template) {
        let placeholder = format!("{{{name}}}");
        let at = rest.find(&placeholder)?;
        filled.push_str(&rest[..at]);
        filled.push_str(&encode(values.get(name)?));
        rest = &rest[at + placeholder.len()..];
    }
    filled.push_str(rest);
    Some(filled)
}

fn first_group(regex: &Regex, text: &str) -> Option<String> {
    Some(regex.captures(text)?.get(1)?.as_str().to_owned())
}

fn refined(source: &Source<'_>, found: String) -> Option<String> {
    let value = match &source.pattern {
        Some(pattern) => first_group(pattern, &found)?,
        None => found,
    };
    let value = value.trim();
    (!value.is_empty() && value.len() <= MAX_VALUE_BYTES).then(|| value.to_owned())
}

/// A text or a number, as a link value.
fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// The result as JSON: its structured content, its text when that is JSON,
/// or else the JSON after the text's first line, as in `Returned 2
/// records.\n{"value":[…]}`.
fn result_json(text: &str, structured: Option<&Value>) -> Option<Value> {
    if let Some(structured) = structured {
        return Some(structured.clone());
    }
    serde_json::from_str(text).ok().or_else(|| {
        let (_, rest) = text.split_once('\n')?;
        serde_json::Deserializer::from_str(rest.trim_start())
            .into_iter::<Value>()
            .next()?
            .ok()
    })
}

/// The links `rules` build for a call from its arguments and its result's
/// text and structured content: one per result row and one for the call.
pub fn record_links(
    rules: &[McpRecordLinkConfig],
    arguments: Option<&Value>,
    text: &str,
    structured: Option<&Value>,
) -> Vec<RecordLink> {
    let rules: Vec<_> = rules.iter().filter_map(Rule::compile).collect();
    if rules.is_empty() {
        return Vec::new();
    }
    let call_values: Vec<_> = rules
        .iter()
        .map(|rule| rule.call_values(arguments, text))
        .collect();
    let mut links = Vec::new();

    if rules.iter().any(Rule::has_rows)
        && let Some(result) = result_json(text, structured)
    {
        // Rows in result order, each with the first rule that links it.
        let mut rows: Vec<(String, &Value, Option<RecordLink>)> = Vec::new();
        for (rule, values) in rules.iter().zip(&call_values) {
            let Some(rows_pointer) = &rule.config.rows else {
                continue;
            };
            for reached in pointer::resolve(&result, rows_pointer) {
                let index = match rows.iter().position(|(path, ..)| *path == reached.path) {
                    Some(index) => index,
                    None => {
                        rows.push((reached.path, reached.value, None));
                        rows.len() - 1
                    }
                };
                let (_, row, link) = &mut rows[index];
                if link.is_none() {
                    *link = rule.link(values, Some(row));
                }
            }
        }
        links.extend(rows.into_iter().filter_map(|(_, _, link)| link));
    }

    let call_link = rules
        .iter()
        .zip(&call_values)
        .filter(|(rule, _)| !rule.has_rows())
        .find_map(|(rule, values)| rule.link(values, None));
    links.extend(call_link);

    let mut seen = std::collections::HashSet::new();
    links.retain(|link| seen.insert(link.url.clone()));
    links.truncate(MAX_RECORD_LINKS);
    links
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const RECORD: &str = "https://records.example.test/main?kind={table}&id={id}";
    const NUMBERED: &str =
        "https://ledger.example.test/t?page={page}&filter=%27No.%27%20IS%20%27{number}%27";

    fn rules(rules: Value) -> Vec<McpRecordLinkConfig> {
        serde_json::from_value(rules).unwrap()
    }

    fn table_rules() -> Vec<McpRecordLinkConfig> {
        rules(json!([
            {
                "url": RECORD,
                "title": "{name}",
                "rows": "/*",
                "values": {
                    "table": {"sql_table": "/querytext"},
                    "id": {"row": ["{table}id", "activityid"]},
                    "name": {"row": ["name", "subject"]},
                },
            },
            {
                "url": RECORD,
                "values": {"table": {"argument": ["/tablename"]}, "id": {"argument": ["/recordId"]}},
            },
            {
                "url": RECORD,
                "values": {
                    "table": {"argument": ["/tablename"]},
                    "id": {"result_text": "ID ([0-9a-fA-F-]{36})"},
                },
            },
        ]))
    }

    fn links_of(rules: &[McpRecordLinkConfig], arguments: Value, text: &str) -> Vec<RecordLink> {
        record_links(rules, Some(&arguments), text, None)
    }

    #[test]
    fn each_read_row_gets_its_link_and_name() {
        let text = json!([
            {"name": "Retrofit", "opportunityid": "ae6c577c-e845-5994-a169-6713bbd1296a"},
            {"name": "No key"}
        ])
        .to_string();
        let arguments = json!({"querytext": "SELECT name, opportunityid FROM opportunity WHERE name LIKE '%R%'"});
        assert_eq!(
            links_of(&table_rules(), arguments, &text),
            vec![RecordLink {
                url: "https://records.example.test/main?kind=opportunity&id=ae6c577c-e845-5994-a169-6713bbd1296a".into(),
                title: Some("Retrofit".into()),
            }]
        );
    }

    #[test]
    fn a_row_member_name_falls_back_to_the_next() {
        let text =
            json!([{"subject": "Call", "activityid": "6a1d6a9e-0000-0000-0000-000000000001"}])
                .to_string();
        let arguments = json!({"querytext": "SELECT subject, activityid FROM task"});
        let links = links_of(&table_rules(), arguments, &text);
        assert!(
            links[0]
                .url
                .ends_with("kind=task&id=6a1d6a9e-0000-0000-0000-000000000001")
        );
        assert_eq!(links[0].title.as_deref(), Some("Call"));
    }

    #[test]
    fn a_read_of_several_tables_gets_no_links() {
        let text = json!([{"opportunityid": "1"}]).to_string();
        let arguments = json!({"querytext": "SELECT o.opportunityid FROM opportunity o JOIN account a ON a.accountid = o.customerid"});
        assert!(links_of(&table_rules(), arguments, &text).is_empty());
    }

    #[test]
    fn an_update_and_a_create_get_one_link_each() {
        let updated = links_of(
            &table_rules(),
            json!({"tablename": "opportunity", "recordId": "ae6c577c-e845-5994-a169-6713bbd1296a"}),
            "Record updated successfully.",
        );
        assert_eq!(updated.len(), 1);
        assert!(
            updated[0]
                .url
                .ends_with("kind=opportunity&id=ae6c577c-e845-5994-a169-6713bbd1296a")
        );

        let created = links_of(
            &table_rules(),
            json!({"tablename": "task"}),
            "Created record with ID af7fd0d7-65e6-f111-84ea-70a8a505d60b",
        );
        assert!(
            created[0]
                .url
                .ends_with("kind=task&id=af7fd0d7-65e6-f111-84ea-70a8a505d60b")
        );
    }

    #[test]
    fn a_value_is_encoded_and_never_fills_another_placeholder() {
        let rules = rules(json!([{
            "url": "https://records.example.test/{id}?q={name}",
            "title": "{name} ({id})",
            "values": {"id": {"argument": ["/id"]}, "name": {"argument": ["/name"]}},
        }]));
        let links = links_of(&rules, json!({"id": "a/../b?x#y", "name": "Q3 {id}"}), "");
        assert_eq!(
            links[0].url,
            "https://records.example.test/a%2F..%2Fb%3Fx%23y?q=Q3%20%7Bid%7D"
        );
        assert_eq!(links[0].title.as_deref(), Some("Q3 {id} (a/../b?x#y)"));
    }

    fn numbered_rules() -> Vec<McpRecordLinkConfig> {
        let entity =
            json!({"argument": ["/ActionName"], "pattern": "^[A-Za-z]+_([A-Za-z]+?)_PAG[0-9]+$"});
        let page = |page: u32| NUMBERED.replace("{page}", &page.to_string());
        rules(json!([
            {
                "url": page(42),
                "title": "{number}",
                "rows": "/value/*",
                "values": {"entity": entity, "number": {"row": ["number"]}},
                "when": {"entity": "^SalesOrders?$"},
            },
            {
                "url": page(43),
                "rows": "/value/*",
                "values": {"entity": entity, "number": {"row": ["number"]}, "status": {"row": ["status"]}},
                "when": {"entity": "^SalesInvoices?$", "status": "^(Draft|In Review)$"},
            },
            {
                "url": page(132),
                "rows": "/value/*",
                "values": {"entity": entity, "number": {"row": ["number"]}, "status": {"row": ["status"]}},
                "when": {"entity": "^SalesInvoices?$", "status": "^(Open|Paid)$"},
            },
        ]))
    }

    #[test]
    fn rows_after_a_line_of_text_get_links() {
        let text = "Returned all 2 records.\n{\"@odata.count\":2,\"value\":[{\"number\":\"101021\",\"status\":\"Draft\"},{\"number\":\"S 1\"}]}";
        let links = links_of(
            &numbered_rules(),
            json!({"ActionName": "List_SalesOrders_PAG30028"}),
            text,
        );
        assert_eq!(
            links[0].url,
            "https://ledger.example.test/t?page=42&filter=%27No.%27%20IS%20%27101021%27"
        );
        assert!(links[1].url.ends_with("%27S%201%27"));
    }

    #[test]
    fn when_picks_the_rule_per_row_in_result_order() {
        let text = r#"{"value":[{"number":"1","status":"Paid"},{"number":"2","status":"Draft"},{"number":"3","status":"Canceled"}]}"#;
        let links = links_of(
            &numbered_rules(),
            json!({"ActionName": "List_SalesInvoices_PAG30012"}),
            text,
        );
        let pages: Vec<_> = links
            .iter()
            .map(|link| link.url.split('&').next().unwrap())
            .collect();
        assert_eq!(
            pages,
            [
                "https://ledger.example.test/t?page=132",
                "https://ledger.example.test/t?page=43"
            ]
        );
    }

    #[test]
    fn lines_of_an_entity_are_not_the_entity() {
        let text = r#"{"value":[{"number":"1"}]}"#;
        assert!(
            links_of(
                &numbered_rules(),
                json!({"ActionName": "List_SalesOrderLines_PAG30044"}),
                text
            )
            .is_empty()
        );
    }

    #[test]
    fn structured_content_is_read_before_the_text() {
        let structured = json!({"value": [{"number": "7"}]});
        let links = record_links(
            &numbered_rules(),
            Some(&json!({"ActionName": "List_SalesOrders_PAG30028"})),
            "7 orders",
            Some(&structured),
        );
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn a_long_read_gets_a_bounded_number_of_links() {
        let rows: Vec<_> = (0..100)
            .map(|n| json!({"opportunityid": n.to_string()}))
            .collect();
        let arguments = json!({"querytext": "SELECT opportunityid FROM opportunity"});
        assert_eq!(
            links_of(&table_rules(), arguments, &Value::Array(rows).to_string()).len(),
            MAX_RECORD_LINKS
        );
    }

    #[test]
    fn the_model_reads_titled_and_untitled_links() {
        assert_eq!(links_for_model([]), "");
        assert_eq!(
            links_for_model([
                ("https://a.example.test/1", Some("One")),
                ("https://a.example.test/2", None)
            ]),
            "\n\nLinks to open these records:\n- One: https://a.example.test/1\n- https://a.example.test/2"
        );
    }
}
