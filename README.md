# CHAT & Message-Monitoring
A simple to deploy chat UI for the interaction with LLM's paired with a monitoring for the incoming messages to understand what people are asking.

### todos
- [ ] deployment auth teil
    - [ ] forward auth
    - [ ] postgres
    - [ ] chat server
    - [ ] routing server
    - [ ] container frontend
- [ ] chat UI nextJS + v0
    - [ ] basic chat
    - [ ] header forwarding for mocked server
    - [ ] React/ TS core -> exposed itself as WebComponent/ Custom HTML element --> for embedding
    - [ ] Auth handover if Typo3 is the auth system // API proxy server?
    - [ ] Recat Components for unified UX


### potential building blocks
- kubernetes base
- chat ui
- chat-message store
- MCP based/ support
- user auth
- Status/ response streaming via SSE? GET/ POST limitation


### LLM Features
- Tool Calling
- ReACT Tool Calling
- RAG connect
- image interpretation


### Supported chat features/ UX
- File Handling/ control
- Code Interpreter
- Markdown and LaTeX Support
- language/ localization support
- shared/ multi-user conversations
- conversation shift between channels, like email

### Sample flow
- I write a message
- message from client to chat-ui-server (model, key)
- load MCP tools
- enrich message with tools
- pass to genaiclient
- loop over llm response for further tool calling or finished message
- feedback to client for status
- 


### Monitoring related
Questions we would like to address:
- Which user or which group/ department is asking what question
    - intend of the questions as very short indicator
    - abstract questions of many users matching the same question to understand the "common" question


### Notes on messages
- Messages probably come with multiple intends or change the "main" intention during the conversation, or conitnue on with another intend after the first is answered
- difference between main question and follow-up questions


### Extended discussion
- we experienced the "flow" modeling in Flowise that a user can add some "context" to a tool "resolution" in a way that we can guide what tool to use when
- tool execution then happens externally via different API methods
