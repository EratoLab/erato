//! A field name written as one lower-case word, such as `estimatedclosedate`,
//! read as the words it is made of. Only a name the word list covers from end
//! to end is split; anything else stays as written, so nothing is guessed.

use std::collections::HashSet;
use std::sync::LazyLock;

/// Longer names are not field names; they stay as written.
const MAX_GLUED_CHARS: usize = 64;

/// Words field names are commonly built from, in no server's vocabulary.
const FIELD_WORDS: &[&str] = &[
    "accepted",
    "account",
    "action",
    "active",
    "activity",
    "actual",
    "address",
    "after",
    "agent",
    "all",
    "amount",
    "annual",
    "approved",
    "approver",
    "archived",
    "area",
    "as",
    "assigned",
    "assignee",
    "at",
    "attachment",
    "attribute",
    "author",
    "auto",
    "available",
    "average",
    "bank",
    "based",
    "before",
    "begin",
    "best",
    "billing",
    "birth",
    "birthday",
    "block",
    "blocked",
    "body",
    "book",
    "booking",
    "branch",
    "budget",
    "business",
    "buyer",
    "by",
    "calendar",
    "call",
    "campaign",
    "cancel",
    "cancelled",
    "capacity",
    "case",
    "category",
    "center",
    "channel",
    "city",
    "class",
    "client",
    "close",
    "closed",
    "closing",
    "code",
    "color",
    "column",
    "comment",
    "comments",
    "company",
    "compliance",
    "condition",
    "confirmed",
    "contact",
    "content",
    "contract",
    "cost",
    "count",
    "country",
    "created",
    "credit",
    "currency",
    "current",
    "customer",
    "data",
    "date",
    "day",
    "deadline",
    "default",
    "deleted",
    "delivery",
    "department",
    "description",
    "detail",
    "details",
    "device",
    "disabled",
    "discount",
    "display",
    "do",
    "document",
    "domain",
    "due",
    "duration",
    "effective",
    "email",
    "employee",
    "employees",
    "enabled",
    "end",
    "entity",
    "estimated",
    "event",
    "exchange",
    "expected",
    "expiration",
    "expiry",
    "extension",
    "external",
    "failure",
    "fax",
    "file",
    "filter",
    "final",
    "first",
    "flag",
    "folder",
    "forecast",
    "form",
    "format",
    "from",
    "full",
    "gender",
    "global",
    "goal",
    "grade",
    "gross",
    "group",
    "has",
    "head",
    "headline",
    "hold",
    "home",
    "hour",
    "id",
    "identifier",
    "if",
    "image",
    "import",
    "in",
    "inactive",
    "include",
    "industry",
    "information",
    "initial",
    "installed",
    "internal",
    "invalid",
    "invoice",
    "is",
    "issue",
    "issued",
    "item",
    "job",
    "join",
    "key",
    "kind",
    "label",
    "language",
    "last",
    "lead",
    "legal",
    "length",
    "level",
    "license",
    "limit",
    "line",
    "link",
    "list",
    "location",
    "locked",
    "logical",
    "login",
    "long",
    "lost",
    "mail",
    "main",
    "manager",
    "margin",
    "market",
    "marketing",
    "master",
    "match",
    "max",
    "maximum",
    "medium",
    "member",
    "message",
    "method",
    "middle",
    "min",
    "minimum",
    "minute",
    "mobile",
    "mode",
    "model",
    "modified",
    "month",
    "name",
    "net",
    "network",
    "new",
    "next",
    "no",
    "not",
    "note",
    "notes",
    "notification",
    "number",
    "object",
    "of",
    "offer",
    "office",
    "offline",
    "on",
    "online",
    "open",
    "opened",
    "operator",
    "opportunity",
    "option",
    "options",
    "order",
    "organization",
    "origin",
    "original",
    "other",
    "overall",
    "owner",
    "page",
    "paid",
    "parent",
    "partner",
    "password",
    "path",
    "payment",
    "pending",
    "percent",
    "period",
    "person",
    "phone",
    "photo",
    "picture",
    "plan",
    "planned",
    "points",
    "policy",
    "portal",
    "position",
    "postal",
    "preferred",
    "price",
    "primary",
    "principal",
    "priority",
    "private",
    "probability",
    "process",
    "processed",
    "product",
    "profile",
    "program",
    "project",
    "province",
    "public",
    "published",
    "purchase",
    "quality",
    "quantity",
    "quarter",
    "query",
    "quote",
    "rank",
    "rate",
    "rating",
    "read",
    "reason",
    "received",
    "reference",
    "region",
    "registered",
    "related",
    "release",
    "remaining",
    "reminder",
    "renewal",
    "rent",
    "repeat",
    "report",
    "reporting",
    "request",
    "required",
    "resolution",
    "resolved",
    "resource",
    "response",
    "responsible",
    "result",
    "return",
    "revenue",
    "review",
    "reviewed",
    "role",
    "sales",
    "salutation",
    "scheduled",
    "schema",
    "score",
    "sector",
    "segment",
    "sent",
    "sequence",
    "series",
    "service",
    "session",
    "shared",
    "shipping",
    "short",
    "signature",
    "site",
    "size",
    "skill",
    "source",
    "speed",
    "stage",
    "standard",
    "start",
    "state",
    "status",
    "step",
    "stock",
    "street",
    "strength",
    "sub",
    "subject",
    "submitted",
    "subscription",
    "subtotal",
    "summary",
    "supplier",
    "support",
    "system",
    "tag",
    "target",
    "task",
    "tax",
    "team",
    "telephone",
    "template",
    "term",
    "territory",
    "text",
    "thread",
    "ticket",
    "time",
    "timestamp",
    "timezone",
    "title",
    "to",
    "today",
    "token",
    "tone",
    "topic",
    "total",
    "town",
    "transaction",
    "transfer",
    "type",
    "unit",
    "until",
    "update",
    "updated",
    "upload",
    "url",
    "usage",
    "user",
    "valid",
    "validated",
    "value",
    "vendor",
    "verified",
    "version",
    "visibility",
    "visible",
    "warehouse",
    "web",
    "website",
    "week",
    "weight",
    "when",
    "work",
    "workflow",
    "written",
    "year",
    "years",
    "yes",
    "zip",
    "zone",
];

static WORDS: LazyLock<HashSet<&'static str>> =
    LazyLock::new(|| FIELD_WORDS.iter().copied().collect());

/// `word`'s pieces when it is one lower-case word the list covers, with a
/// trailing number (`telephone1`) as its own piece; otherwise `word` itself.
pub(super) fn split_glued(word: &str) -> Vec<String> {
    let letters = word.trim_end_matches(|c: char| c.is_ascii_digit());
    let digits = &word[letters.len()..];
    let plain_letters =
        !letters.is_empty() && letters.bytes().all(|byte| byte.is_ascii_lowercase());
    if !plain_letters || word.len() > MAX_GLUED_CHARS {
        return vec![word.to_string()];
    }
    let Some(mut pieces) = covered_by_the_list(letters) else {
        return vec![word.to_string()];
    };
    if !digits.is_empty() {
        pieces.push(digits.to_string());
    }
    pieces
}

/// The pieces of `letters` if the list covers it end to end, preferring a
/// whole word and otherwise the fewest, longest pieces.
fn covered_by_the_list(letters: &str) -> Option<Vec<String>> {
    if WORDS.contains(letters) {
        return Some(vec![letters.to_string()]);
    }
    let n = letters.len();
    let mut best: Vec<Option<(usize, Vec<&str>)>> = vec![None; n + 1];
    best[0] = Some((0, Vec::new()));
    for end in 1..=n {
        for start in end.saturating_sub(16)..end {
            let (Some((score, pieces)), Some(word)) =
                (best[start].as_ref(), letters.get(start..end))
            else {
                continue;
            };
            if !WORDS.contains(word) {
                continue;
            }
            let score = score + word.len() * word.len();
            if best[end]
                .as_ref()
                .is_none_or(|(current, _)| score > *current)
            {
                let mut pieces = pieces.clone();
                pieces.push(word);
                best[end] = Some((score, pieces));
            }
        }
    }
    let (_, pieces) = best[n].take()?;
    (pieces.len() >= 2).then(|| pieces.into_iter().map(str::to_string).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pieces(word: &str) -> Vec<String> {
        split_glued(word)
    }

    #[test]
    fn glued_names_read_as_their_words() {
        for (glued, expected) in [
            ("estimatedclosedate", vec!["estimated", "close", "date"]),
            ("customertypecode", vec!["customer", "type", "code"]),
            ("numberofemployees", vec!["number", "of", "employees"]),
            ("parentaccountid", vec!["parent", "account", "id"]),
            ("websiteurl", vec!["website", "url"]),
            ("creditonhold", vec!["credit", "on", "hold"]),
            ("firstname", vec!["first", "name"]),
            ("ownerid", vec!["owner", "id"]),
        ] {
            assert_eq!(pieces(glued), expected, "{glued}");
        }
    }

    #[test]
    fn a_number_at_the_end_is_its_own_word_only_after_known_words() {
        assert_eq!(pieces("telephone1"), ["telephone", "1"]);
        assert_eq!(pieces("emailaddress2"), ["email", "address", "2"]);
        assert_eq!(pieces("sha256"), ["sha256"]);
    }

    #[test]
    fn words_the_list_does_not_cover_stay_as_written() {
        for word in [
            "address",
            "reason",
            "version",
            "donation",
            "invoices",
            "xyzzy",
            "",
            "phonenumbers2x",
        ] {
            assert_eq!(pieces(word), [word], "{word}");
        }
    }

    #[test]
    fn a_whole_word_is_never_split_into_smaller_ones() {
        assert_eq!(pieces("network"), ["network"]);
        assert_eq!(pieces("online"), ["online"]);
        assert_eq!(pieces("today"), ["today"]);
    }
}
