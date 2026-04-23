#[derive(Clone, Copy, Debug, Default)]
pub struct SystemPromptContext<'a> {
    pub preferred_language: Option<&'a str>,
    pub user_preference_nickname: Option<&'a str>,
    pub user_preference_job_title: Option<&'a str>,
    pub user_preference_assistant_custom_instructions: Option<&'a str>,
    pub user_preference_assistant_additional_information: Option<&'a str>,
}
