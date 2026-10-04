//! Translate backend phases into short Teams progress, retaining concurrent
//! tools until each finishes. Never put tool inputs/outputs in the status.

use crate::services::background_tasks::ToolCallStatus;
use std::collections::BTreeMap;

#[derive(Default)]
pub(super) struct Progress {
    active: BTreeMap<String, String>,
}

impl Progress {
    pub fn current(&self) -> Option<String> {
        (!self.active.is_empty())
            .then(|| self.active.values().cloned().collect::<Vec<_>>().join("\n"))
    }

    pub fn tool(
        &mut self,
        id: String,
        name: &str,
        status: ToolCallStatus,
        message: Option<&str>,
        progress: Option<f64>,
        total: Option<f64>,
    ) -> String {
        let name = name.replace('_', " ");
        let label = match status {
            ToolCallStatus::Preparing => format!("Preparing {name}…"),
            ToolCallStatus::InProgress => format!("Using {name}…"),
            ToolCallStatus::Success => format!("Finished {name}. Preparing the response…"),
            ToolCallStatus::Error => format!("{name} failed. Preparing the response…"),
        };
        if matches!(status, ToolCallStatus::Success | ToolCallStatus::Error) {
            self.active.remove(&id);
            return self.current().unwrap_or(label);
        }
        let mut label = match message.map(str::trim).filter(|message| !message.is_empty()) {
            Some(message) => format!("{label} {message}"),
            None => label,
        };
        if let Some(progress) = progress.filter(|p| p.is_finite() && *p >= 0.0) {
            if let Some(total) = total.filter(|t| t.is_finite() && *t > 0.0 && progress <= *t) {
                label.push_str(&format!(" ({progress}/{total})"));
            } else {
                label.push_str(&format!(" ({progress})"));
            }
        }
        self.active.insert(id, label);
        self.current().expect("the active tool was inserted")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_parallel_tools_and_real_progress_until_they_finish() {
        let mut progress = Progress::default();
        progress.tool(
            "a".into(),
            "search_docs",
            ToolCallStatus::Preparing,
            None,
            None,
            None,
        );
        let status = progress.tool(
            "b".into(),
            "read_files",
            ToolCallStatus::InProgress,
            Some("Reading files"),
            Some(2.0),
            Some(5.0),
        );
        assert!(status.contains("Preparing search docs"));
        assert!(status.contains("Reading files (2/5)"));
        let status = progress.tool(
            "a".into(),
            "search_docs",
            ToolCallStatus::Success,
            None,
            None,
            None,
        );
        assert!(!status.contains("search docs"));
        assert!(status.contains("read files"));
        let status = progress.tool(
            "b".into(),
            "read_files",
            ToolCallStatus::Error,
            None,
            None,
            None,
        );
        assert!(status.contains("failed"));
        assert!(progress.current().is_none());
    }
}
