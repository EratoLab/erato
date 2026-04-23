#[derive(Clone, Copy, Debug, Default)]
pub struct McpForwardedIdTokenContext<'a> {
    pub id_token: Option<&'a str>,
    pub prefix: Option<&'a str>,
}
