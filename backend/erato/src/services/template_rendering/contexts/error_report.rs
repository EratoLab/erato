#[derive(Clone, Debug)]
pub struct ErrorReportContext {
    pub environment: String,
    pub timestamp: String,
    pub chat_id: String,
    pub assistant_id: String,
    pub platform: String,
    pub facets_active: String,
    pub error: String,
}

impl ErrorReportContext {
    pub fn none_placeholder() -> &'static str {
        "<none>"
    }

    pub fn optional(value: Option<impl Into<String>>) -> String {
        value
            .map(Into::into)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Self::none_placeholder().to_string())
    }
}
