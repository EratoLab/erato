//! Which Office hosts, platforms and PowerPoint read tiers add-in panes start on, counted once
//! per pane start from `POST /me/office-host-report`. Every label is one of a closed set of
//! values, `other` or empty, so no client can create new series.

use metrics::counter;

pub(crate) const OFFICE_ADDIN_PANE_STARTS_METRIC: &str = "erato_office_addin_pane_starts_total";
const OTHER: &str = "other";

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
const POWERPOINT_API_SETS: &[&str] = &[
    "none", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10",
];
const TIERS: &[&str] = &["full", "basic", "none"];

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct OfficeHostLabels {
    pub host: &'static str,
    pub platform: &'static str,
    pub api_set: &'static str,
    pub tier: &'static str,
}

fn one_of(value: Option<&str>, known: &[&'static str]) -> &'static str {
    match value.map(str::trim) {
        None | Some("") => "",
        Some(value) => known
            .iter()
            .copied()
            .find(|known| *known == value)
            .unwrap_or(OTHER),
    }
}

pub(crate) fn office_host_labels(
    host: &str,
    platform: Option<&str>,
    api_set: Option<&str>,
    tier: Option<&str>,
) -> OfficeHostLabels {
    OfficeHostLabels {
        host: match one_of(Some(host), HOSTS) {
            "" => OTHER,
            host => host,
        },
        platform: one_of(platform, PLATFORMS),
        api_set: one_of(api_set, POWERPOINT_API_SETS),
        tier: one_of(tier, TIERS),
    }
}

pub(crate) fn record_office_addin_pane_start(labels: &OfficeHostLabels) {
    counter!(
        OFFICE_ADDIN_PANE_STARTS_METRIC,
        "host" => labels.host,
        "platform" => labels.platform,
        "api_set" => labels.api_set,
        "tier" => labels.tier
    )
    .increment(1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn reads_a_powerpoint_pane_with_its_tier() {
        assert_eq!(
            office_host_labels("PowerPoint", Some("PC"), Some("1.5"), Some("basic")),
            OfficeHostLabels {
                host: "PowerPoint",
                platform: "PC",
                api_set: "1.5",
                tier: "basic",
            }
        );
    }

    #[test]
    fn hosts_without_read_tiers_leave_those_labels_empty() {
        assert_eq!(
            office_host_labels("Outlook", Some("OfficeOnline"), None, None),
            OfficeHostLabels {
                host: "Outlook",
                platform: "OfficeOnline",
                api_set: "",
                tier: "",
            }
        );
        let no_platform = office_host_labels("Word", None, Some(""), None);
        assert_eq!((no_platform.platform, no_platform.api_set), ("", ""));
    }

    #[test]
    fn hostile_values_cannot_create_new_label_sets() {
        let mut seen = BTreeSet::new();
        for i in 0..5_000 {
            let odd = format!("{i}.{i}.x");
            seen.insert(office_host_labels(
                &format!("Host{i}"),
                Some(&odd),
                Some(&odd),
                Some(&odd),
            ));
        }
        for api in ["01.5", "1.11", "1.10.0", "1.5\u{0}", "16.0.20527"] {
            seen.insert(office_host_labels(
                "PowerPoint",
                Some("PC"),
                Some(api),
                Some("full"),
            ));
        }
        assert_eq!(seen.len(), 2, "{seen:?}");
        assert!(seen.iter().all(|labels| labels.api_set == OTHER));
    }
}
