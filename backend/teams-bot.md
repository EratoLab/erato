# Teams bot

Erato answers in Microsoft Teams personal chats, group chats and channels. Chats started in Teams are ordinary Erato chats: they appear in the web app and the Teams tab, keep their history, and use the same assistants, models, policies, MCP tools and SharePoint integration as the web app.

The code lives in `erato/src/teams_bot/`. The protocol files (`activity`, `inbound_auth`, `connector`, `user_token`, `graph`, `cards`, `render`, `streaming`) do not depend on Erato. `handler` decides what to do with each activity, and `host` is the only file that calls Erato internals, which keeps the folder ready to become its own crate.

## Request flow

1. Teams sends an activity to `POST /api/integrations/teams/messages`. The ingress routes this exact path to the backend directly, bypassing oauth2-proxy (which strips `Authorization` on every route, `skip_auth_regex` included), and the route sits outside the user middleware. It checks the Bot Connector's RS256 token itself (Bot Framework key set endorsed for `msteams`, issuer `https://api.botframework.com`, audience = bot app ID, `serviceurl` claim = activity service URL) and rejects activities from other tenants.
2. Messages are acknowledged immediately and handled in the background. Invokes (`signin/tokenExchange`, `signin/verifyState`) are answered synchronously.
3. The user is looked up by the Entra object ID on the activity (`users.entra_object_id`). Web and Teams tab logins record it from the `oid` claim. Users who never opened Erato are asked to do so once.
4. The bot fetches the user's delegated Graph token from the Azure Bot OAuth connection. Without one, it sends a sign-in card: in personal chats directly, and for group chats and channels in a private chat with the user. With `sso_app_id`/`sso_resource`, Teams completes sign-in silently. `teams_token_exchanges` makes sure only one replica processes each SSO exchange.
5. Graph `/me` and `getMemberGroups` produce the same profile a web login yields (identity, email, group IDs for the policy engine; cached for ten minutes). The Graph token takes the place of oauth2-proxy's forwarded access token, so SharePoint and other Graph features work unchanged.
6. `teams_conversations` maps (Teams conversation, user) to the current Erato chat. Channel conversation IDs include the thread, so each thread gets its own chat per user. `/new` starts a fresh chat.
7. Attachments become chat files:
   - Files uploaded in personal chats are downloaded from their pre-authenticated URL.
   - Pasted images are downloaded with the bot token (only from Teams content hosts).
   - SharePoint/OneDrive links, which is how files arrive in group chats and channels, are linked like the SharePoint picker does. When the SharePoint integration is off, they are downloaded instead.
8. In group chats and channels, the preceding messages (default 20) are fetched through Graph and attached as `teams-conversation-context.md`.
9. The message is submitted through the same code path as `submitstream` (`start_message_submit`), with platform `teams` and the chat's active-thread tip as `previous_message_id`.
10. Personal chats stream the answer with Teams streaming messages. Group chats and channels show typing, then reply in the thread with an @mention of the requester.
11. A turn that stops on tool approvals posts one Adaptive Card listing every open decision (several for delegated task plans or batches, shown with the child's actual tool). "Submit decisions", "Approve all" or "Deny all" send the complete set, which resumes the turn through `start_continuation`, the same path as `continuestream`, and replaces the card. The continuation's completion reaches the bot through the task broadcast, so chained approvals get a new card. A decision is authorized exactly like `continuestream`, against the clicking user's access to the chat, so other people in a group chat cannot answer someone else's card.
12. When a background task result is answered (`task_delivery`), the answer is pushed proactively to every Teams conversation whose current chat it belongs to.

## Setup

In the customer's tenant, per environment:

1. **Bot app registration** (single tenant) with a client secret.
2. **Azure Bot resource** using that app. Set the messaging endpoint to `https://<erato>/api/integrations/teams/messages` and enable the Microsoft Teams channel.
3. **OAuth connection** on the Azure Bot ("Azure Active Directory v2", or with federated credentials). It requests the Graph scopes the web login uses, plus `User.Read`, `GroupMember.Read.All`, `Files.Read.All`, `Sites.Read.All`, `Chat.Read` and `ChannelMessage.Read.All`. Grant admin consent.
4. **Silent SSO (optional).** Expose `api://botid-<bot app id>` with an `access_as_user` scope on the bot app, pre-authorize the Teams clients, and set the connection's token exchange URL to it. Then configure `sso_app_id`/`sso_resource`.
5. **Erato configuration.** Set `[integrations.ms_office.teams.bot]` (see `erato.template.toml`). With the Helm chart, enable `teamsBot.directRoute` and list the ingress controller or Gateway pods in `teamsBot.directRoute.ingressFrom`; other setups must route the exact path to the backend without oauth2-proxy.
6. **Install the app.** With `integrations.ms_office.teams.enabled`, `/office-addin/teams/app-package.zip` contains the tab and the bot; upload it to the Teams admin center.

## Limits

- MCP servers that forward the OIDC ID token receive none on Teams requests; access-token forwarding gets the Graph token.
- Client tools (desktop sidecar) cannot run in Teams. The answer links to the chat in Erato instead.
- In group chats and channels, answers built from the requester's data are visible to everyone in the conversation.
