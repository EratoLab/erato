#[derive(Clone, Copy, Debug, Default)]
pub struct McpForwardedAccessTokenContext<'a> {
    pub access_token: Option<&'a str>,
    pub prefix: Option<&'a str>,
}
