//! Which Office host, platform and build add-in panes run, from the
//! `X-Erato-Office-Host` header the pane sends with each message submit.
//! Every label is reduced to a closed or short-shaped value, so a client
//! cannot grow the label set.

use axum::http::HeaderMap;
use metrics::counter;

pub(crate) const OFFICE_ADDIN_MESSAGES_METRIC: &str = "erato_office_addin_messages_total";
const OFFICE_HOST_HEADER: &str = "X-Erato-Office-Host";
const OTHER: &str = "other";
const MAX_HEADER_BYTES: usize = 256;

const HOSTS: &[&str] = &[
    "Word",
    "Excel",
    "PowerPoint",
    "Outlook",
    "OneNote",
    "Project",
    "Access",
];
const PLATFORMS: &[&str] = &["PC", "OfficeOnline", "Mac", "iOS", "Android", "Universal"];
const TIERS: &[&str] = &["full", "basic", "none"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OfficeHostLabels {
    pub host: String,
    pub platform: String,
    pub office_build: String,
    pub api_set: String,
    pub tier: String,
}

pub(crate) fn office_host_labels(headers: &HeaderMap) -> Option<OfficeHostLabels> {
    let raw = headers.get(OFFICE_HOST_HEADER)?.to_str().ok()?;
    if raw.len() > MAX_HEADER_BYTES {
        return None;
    }
    let field = |name: &str| {
        raw.split(';').find_map(|part| {
            let (key, value) = part.split_once('=')?;
            (key.trim() == name).then(|| value.trim())
        })
    };
    let host = field("host")?;
    let one_of = |value: Option<&str>, known: &[&str]| match value {
        None | Some("") => String::new(),
        Some(value) => known
            .iter()
            .find(|known| **known == value)
            .map_or(OTHER, |known| known)
            .to_string(),
    };
    Some(OfficeHostLabels {
        host: one_of(Some(host), HOSTS),
        platform: one_of(field("platform"), PLATFORMS),
        office_build: field("version").map(office_build).unwrap_or_default(),
        api_set: field("api").map(api_set).unwrap_or_default(),
        tier: one_of(field("tier"), TIERS),
    })
}

/// `16.0.20527.20000` → `16.0.20527`: the revision only adds label values.
fn office_build(version: &str) -> String {
    let parts: Vec<&str> = version.split('.').collect();
    let numeric = |part: &&str| {
        !part.is_empty() && part.len() <= 8 && part.bytes().all(|b| b.is_ascii_digit())
    };
    if parts.len() >= 3 && parts[..3].iter().all(numeric) {
        parts[..3].join(".")
    } else {
        OTHER.to_string()
    }
}

fn api_set(value: &str) -> String {
    let short =
        |part: &str| (1..=2).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit());
    match value.split_once('.') {
        Some((major, minor)) if short(major) && short(minor) => value.to_string(),
        _ if value == "none" => value.to_string(),
        _ => OTHER.to_string(),
    }
}

/// Counts one message submit from an add-in pane; requests without the header are not counted.
pub(crate) fn report_office_addin_message(headers: &HeaderMap) {
    let Some(labels) = office_host_labels(headers) else {
        return;
    };
    counter!(
        OFFICE_ADDIN_MESSAGES_METRIC,
        "host" => labels.host,
        "platform" => labels.platform,
        "office_build" => labels.office_build,
        "api_set" => labels.api_set,
        "tier" => labels.tier
    )
    .increment(1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn labels(value: &str) -> Option<OfficeHostLabels> {
        let mut headers = HeaderMap::new();
        headers.insert(OFFICE_HOST_HEADER, HeaderValue::from_str(value).unwrap());
        office_host_labels(&headers)
    }

    #[test]
    fn reads_a_powerpoint_pane() {
        assert_eq!(
            labels("host=PowerPoint; platform=PC; version=16.0.20527.20000; api=1.10; tier=full"),
            Some(OfficeHostLabels {
                host: "PowerPoint".into(),
                platform: "PC".into(),
                office_build: "16.0.20527".into(),
                api_set: "1.10".into(),
                tier: "full".into(),
            })
        );
    }

    #[test]
    fn hosts_without_read_tiers_leave_those_labels_empty() {
        let word = labels("host=Word; platform=Mac; version=16.103.25110918").unwrap();
        assert_eq!(word.office_build, "16.103.25110918");
        assert_eq!(word.api_set, "");
        assert_eq!(word.tier, "");
    }

    #[test]
    fn unknown_or_odd_values_become_other() {
        let odd =
            labels("host=Evil; platform=Linux; version=../../etc; api=1.1000; tier=ultra").unwrap();
        assert_eq!(
            odd,
            OfficeHostLabels {
                host: OTHER.into(),
                platform: OTHER.into(),
                office_build: OTHER.into(),
                api_set: OTHER.into(),
                tier: OTHER.into(),
            }
        );
        assert_eq!(labels("host=PowerPoint; api=none").unwrap().api_set, "none");
    }

    #[test]
    fn needs_a_host_and_a_short_header() {
        assert_eq!(labels("platform=PC"), None);
        assert_eq!(
            labels(&format!("host=Word; version={}", "1".repeat(300))),
            None
        );
        assert_eq!(office_host_labels(&HeaderMap::new()), None);
    }
}
