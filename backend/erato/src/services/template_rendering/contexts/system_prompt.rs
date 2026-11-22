#[derive(Clone, Copy, Debug, Default)]
pub struct SystemPromptContext<'a> {
    /// Whether the chat is bound to an assistant.
    pub has_assistant: bool,
    pub preferred_language: Option<&'a str>,
    pub user_preference_nickname: Option<&'a str>,
    pub user_preference_job_title: Option<&'a str>,
    pub user_preference_assistant_custom_instructions: Option<&'a str>,
    pub user_preference_assistant_additional_information: Option<&'a str>,
    /// The user's stored zone; the "now" placeholders render in it, else in
    /// UTC.
    pub time_zone: Option<chrono_tz::Tz>,
}
