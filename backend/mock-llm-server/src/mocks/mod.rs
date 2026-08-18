use crate::image_data;
use crate::matcher::{
    CiteFilesResponseConfig, DelegateToAssistantResponseConfig, ErrorResponseConfig, ImageMock,
    LongRunningResponseConfig, MatchRule, MatchRuleAnyMessageContainsAudioContent,
    MatchRuleAnySystemMessageWithPattern, MatchRuleAnyUserMessageInCurrentTurnWithPattern,
    MatchRuleLastMessageIsUserWithPattern, MatchRuleUserMessagePattern, Mock,
    RandomOneLinerResponseConfig, ResponseConfig, StaticResponseConfig, ToolCallDef,
    ToolCallResponseConfig, ToolCallsResponseConfig,
};
use rand::Rng;
use serde_json::json;

fn build_lorem_word_chunks(total_words: usize) -> Vec<String> {
    const LOREM_WORDS: [&str; 19] = [
        "lorem",
        "ipsum",
        "dolor",
        "sit",
        "amet",
        "consectetur",
        "adipiscing",
        "elit",
        "sed",
        "do",
        "eiusmod",
        "tempor",
        "incididunt",
        "ut",
        "labore",
        "et",
        "dolore",
        "magna",
        "aliqua",
    ];

    (0..total_words)
        .map(|i| {
            let word = LOREM_WORDS[i % LOREM_WORDS.len()];
            if i == 0 {
                word.to_string()
            } else {
                format!(" {}", word)
            }
        })
        .collect()
}

fn build_scroll_long_chunks(total_lines: usize) -> Vec<String> {
    let mut rng = rand::thread_rng();
    let mut chunks = Vec::new();

    for line_number in 1..=total_lines {
        let line = format!(
            "Streaming scroll line {line_number:03}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\n"
        );
        chunks.extend(split_into_random_chunks(&line, &mut rng));
    }

    chunks
}

fn split_into_random_chunks(line: &str, rng: &mut impl Rng) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < line.len() {
        let chunk_len = rng.gen_range(12..=48);
        let end = (start + chunk_len).min(line.len());
        chunks.push(line[start..end].to_string());
        start = end;
    }

    chunks
}

fn build_whitespace_hallucination_chunks() -> Vec<String> {
    let mut chunks = Vec::with_capacity(201);
    chunks.push("Starting hallucination loop simulation.".to_string());
    chunks.extend((0..200).map(|_| " ".to_string()));
    chunks
}

fn build_submitstream_replay_chunks() -> Vec<String> {
    [
        "Certainly",
        " —",
        " here",
        " are",
        " ",
        "10",
        " more",
        " paragraphs",
        ",",
        " each",
        " with",
        " two",
        " sentences",
        ":\n\n",
        "The",
        " station",
        " was",
        " nearly",
        " empty",
        ",",
        " and",
        " every",
        " foot",
        "step",
        " echoed",
        " for",
        " a",
        " moment",
        " before",
        " disappearing",
        ".",
        " A",
        " single",
        " display",
        " board",
        " flick",
        "ered",
        " above",
        " the",
        " platform",
        ",",
        " listing",
        " departures",
        " in",
        " glowing",
        " lines",
        ".\n\n",
        "Morning",
        " dew",
        " cl",
        "ung",
        " to",
        " the",
        " grass",
        " like",
        " tiny",
        " pieces",
        " of",
        " glass",
        ".",
        " The",
        " field",
        " spark",
        "led",
        " softly",
        " until",
        " the",
        " sun",
        " rose",
        " high",
        " enough",
        " to",
        " warm",
        " it",
        ".\n\n",
        "An",
        " open",
        " notebook",
        " lay",
        " on",
        " the",
        " table",
        " beside",
        " a",
        " half",
        "-f",
        "inished",
        " sketch",
        ".",
        " The",
        " page",
        " seemed",
        " to",
        " wait",
        " patiently",
        " for",
        " the",
        " next",
        " line",
        ",",
        " the",
        " next",
        " idea",
        ",",
        " the",
        " next",
        " mark",
        ".\n\n",
        "The",
        " wind",
        " moved",
        " through",
        " the",
        " alley",
        " with",
        " a",
        " low",
        ",",
        " hollow",
        " sound",
        ".",
        " It",
        " carried",
        " the",
        " smell",
        " of",
        " wet",
        " stone",
        " and",
        " distant",
        " smoke",
        ".\n\n",
        "A",
        " red",
        " umbrella",
        " moved",
        " through",
        " the",
        " crowd",
        " like",
        " a",
        " bright",
        " signal",
        ".",
        " People",
        " turned",
        " slightly",
        " as",
        " it",
        " passed",
        ",",
        " then",
        " returned",
        " to",
        " their",
        " own",
        " paths",
        ".\n\n",
        "The",
        " bakery",
        " window",
        " was",
        " lined",
        " with",
        " pastries",
        " arranged",
        " in",
        " careful",
        " rows",
        ".",
        " Their",
        " glossy",
        " tops",
        " caught",
        " the",
        " light",
        " and",
        " made",
        " the",
        " whole",
        " display",
        " look",
        " almost",
        " ceremonial",
        ".\n\n",
        "Far",
        " above",
        " the",
        " street",
        ",",
        " a",
        " plane",
        " crossed",
        " the",
        " sky",
        " in",
        " a",
        " straight",
        " white",
        " line",
        ".",
        " It",
        " disappeared",
        " so",
        " quickly",
        " that",
        " only",
        " the",
        " shape",
        " of",
        " its",
        " path",
        " remained",
        ".\n\n",
        "The",
        " garden",
        " gate",
        " cre",
        "aked",
        " when",
        " it",
        " opened",
        ",",
        " as",
        " if",
        " it",
        " had",
        " been",
        " asleep",
        ".",
        " Beyond",
        " it",
        ",",
        " the",
        " flowers",
        " leaned",
        " toward",
        " the",
        " sun",
        " in",
        " quiet",
        " abundance",
        ".\n\n",
        "A",
        " clock",
        " tick",
        "ed",
        " on",
        " the",
        " wall",
        ",",
        " measuring",
        " time",
        " in",
        " small",
        " precise",
        " beats",
        ".",
        " The",
        " room",
        " felt",
        " calmer",
        " simply",
        " because",
        " the",
        " sound",
        " was",
        " there",
        ".\n\n",
        "At",
        " the",
        " end",
        " of",
        " the",
        " day",
        ",",
        " the",
        " horizon",
        " softened",
        " into",
        " bands",
        " of",
        " gold",
        " and",
        " gray",
        ".",
        " The",
        " fading",
        " light",
        " gave",
        " everything",
        " a",
        " gentle",
        ",",
        " unfinished",
        " beauty",
        ".",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

/// Typed into the origin chat next to an `@` mention by the delegation e2e.
const DELEGATION_PARENT_PROMPT: &str = "delegate to the probe assistant";

/// Handed to the delegate as the task brief, which makes it the one thing
/// present in every delegated turn and absent from every origin turn.
const DELEGATION_CHILD_BRIEF: &str =
    "Delegation probe child brief: list the available mock files and report how many there are.";

fn build_delegation_child_answer_chunks() -> Vec<String> {
    [
        "CHILD-ANSWER",
        ":",
        " the",
        " delegate",
        " listed",
        " the",
        " mock",
        " files",
        " and",
        " reported",
        " the",
        " count",
        " back",
        ".",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

/// Get the default set of configured mocks
pub fn get_default_mocks() -> Vec<Mock> {
    vec![
        // Must stay first: a summary request carries the raw first user
        // message last, so any user-pattern mock (e.g. LongRunning) would
        // match it and pace or fail the title generation.
        Mock {
            name: "SummaryTitle".to_string(),
            description:
                "Returns a static title for chat summary requests, keyed on the summary system prompt"
                    .to_string(),
            match_rules: vec![MatchRule::AnySystemMessageWithPattern(
                MatchRuleAnySystemMessageWithPattern {
                    pattern: "generate a summary for the topic".to_string(),
                },
            )],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec!["Mock Summary Title".to_string()],
                delay_ms: 10,
                ..Default::default()
            }),
        },
        // The four delegation mocks must all precede ToolResultResponse: the
        // delegate's post-tool turn ends in a tool result too, and the
        // catch-all would answer it instead of the delegate. Among
        // themselves, order decides the turn: the brief is the last user
        // message only on the delegate's first turn, so the tool-call mocks
        // have to come before the answer mocks that match the same brief
        // anywhere in the conversation.
        Mock {
            name: "DelegationParentToolCall".to_string(),
            description: "Delegates to the assistant the request offers as a mention target"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: DELEGATION_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::DelegateToAssistant(DelegateToAssistantResponseConfig {
                task: DELEGATION_CHILD_BRIEF.to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "DelegationChildToolCall".to_string(),
            description: "Returns the delegate's tool call on the turn that carries the brief"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: DELEGATION_CHILD_BRIEF.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "list_files".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 200,
            }),
        },
        Mock {
            name: "DelegationChildAnswer".to_string(),
            description: "Returns the delegate's final answer once its tool call resolved"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: DELEGATION_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: build_delegation_child_answer_chunks(),
                delay_ms: 300,
                ..Default::default()
            }),
        },
        Mock {
            name: "DelegationParentAnswer".to_string(),
            description: "Returns the origin chat's answer once the delegation result is in"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: DELEGATION_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "The".to_string(),
                    " delegate".to_string(),
                    " finished".to_string(),
                    " the".to_string(),
                    " probe".to_string(),
                    " task".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "SubmitStreamReplay".to_string(),
            description:
                "Replays the captured chunk sequence that produced the submitstream paragraph stream"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "and one more time".to_string(),
                },
            )],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: build_submitstream_replay_chunks(),
                delay_ms: 100,
                ..Default::default()
            }),
        },
        Mock {
            name: "MarkdownFootnotes".to_string(),
            description:
                "Returns markdown footnotes to exercise in-message anchor navigation"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "markdown footnotes".to_string(),
                },
            )],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "Footnote links should stay inside the current message[^1].\n\n[^1]: This footnote belongs to the current response."
                        .to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "CiteFiles".to_string(),
            description:
                "Lists erato-file links from all request messages when any user message in the current turn asks to cite files"
                    .to_string(),
            match_rules: vec![MatchRule::AnyUserMessageInCurrentTurnWithPattern(
                MatchRuleAnyUserMessageInCurrentTurnWithPattern {
                    pattern: "cite files".to_string(),
                },
            )],
            response: ResponseConfig::CiteFiles(CiteFilesResponseConfig { delay_ms: 50 }),
        },
        Mock {
            name: "Greeting".to_string(),
            description: "Responds to hello messages with a friendly greeting".to_string(),
            match_rules: vec![
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hello".to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hi".to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: "hey".to_string(),
                }),
            ],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "Hello".to_string(),
                    "!".to_string(),
                    " How".to_string(),
                    " can".to_string(),
                    " I".to_string(),
                    " help".to_string(),
                    " you".to_string(),
                    " today".to_string(),
                    "?".to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "WhitespaceHallucination".to_string(),
            description:
                "Streams successive whitespace-only chunks to simulate a hallucination loop"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "hallucination loop".to_string(),
                },
            )],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: build_whitespace_hallucination_chunks(),
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "Weather".to_string(),
            description: "Provides weather information when asked".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "weather".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "The".to_string(),
                    " weather".to_string(),
                    " is".to_string(),
                    " sunny".to_string(),
                    " and".to_string(),
                    " warm".to_string(),
                    " today".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 75,
                ..Default::default()
            }),
        },
        Mock {
            name: "Test".to_string(),
            description: "Test response for development and debugging".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "test".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "This".to_string(),
                    " is".to_string(),
                    " a".to_string(),
                    " test".to_string(),
                    " response".to_string(),
                    " from".to_string(),
                    " the".to_string(),
                    " mock".to_string(),
                    " server".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 100,
                ..Default::default()
            }),
        },
        Mock {
            name: "Slow".to_string(),
            description: "Demonstrates slow streaming with high delay".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "slow".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "This".to_string(),
                    " response".to_string(),
                    " will".to_string(),
                    " be".to_string(),
                    " delivered".to_string(),
                    " very".to_string(),
                    " slowly".to_string(),
                    "...".to_string(),
                ],
                delay_ms: 500,
                ..Default::default()
            }),
        },
        Mock {
            name: "Fast".to_string(),
            description: "Demonstrates fast streaming with minimal delay".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "fast".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "Quick".to_string(),
                    " response".to_string(),
                    "!".to_string(),
                ],
                delay_ms: 10,
                ..Default::default()
            }),
        },
        // Must precede the "Delay" mock: its "delay" pattern also matches "delayed error"
        Mock {
            // Ordered before every "delay"-substring mock (its trigger
            // contains "delay") AND before McpApprovalPolicyToolCall (it
            // contains "mcp approval probe") — matching is first-match
            // substring over this list.
            name: "DelayedMcpApprovalPolicyToolCall".to_string(),
            description:
                "Approval-required MCP call after 10s of visible generation, to observe the running -> action-required transition"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "delayed mcp approval probe".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "publish_approval_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 10_000,
            }),
        },
        Mock {
            name: "DelayedContentFilterError".to_string(),
            description: "Returns the content filter error after a 5 second wait".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "delayed error".to_string(),
                },
            )],
            response: ResponseConfig::Error(ErrorResponseConfig {
                status_code: 400,
                body: json!({
                    "error": {
                        "code": "content_filter",
                        "message": "The response was filtered due to the prompt triggering content management policy.",
                        "innererror": {
                            "content_filter_result": {
                                "sexual": { "filtered": true, "severity": "medium" },
                                "violence": { "filtered": false, "severity": "low" },
                                "hate": { "filtered": false, "severity": "safe" },
                                "self_harm": { "filtered": false, "severity": "safe" }
                            }
                        }
                    }
                }),
                initial_delay_ms: Some(5000),
            }),
        },
        Mock {
            name: "Delay".to_string(),
            description: "Demonstrates delayed response with 5 second wait before first chunk"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "delay".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "After".to_string(),
                    " waiting".to_string(),
                    " for".to_string(),
                    " 5".to_string(),
                    " seconds".to_string(),
                    ",".to_string(),
                    " here".to_string(),
                    " is".to_string(),
                    " your".to_string(),
                    " response".to_string(),
                    ".".to_string(),
                    " This".to_string(),
                    " demonstrates".to_string(),
                    " how".to_string(),
                    " the".to_string(),
                    " system".to_string(),
                    " handles".to_string(),
                    " delayed".to_string(),
                    " streaming".to_string(),
                    " responses".to_string(),
                    " with".to_string(),
                    " medium".to_string(),
                    "-sized".to_string(),
                    " text".to_string(),
                    " content".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 20,
                initial_delay_ms: Some(5000),
            }),
        },
        Mock {
            name: "RandomOneLiner".to_string(),
            description:
                "Returns one of 100 short responses and avoids reusing a prior assistant variant when possible"
                    .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "random".to_string(),
            })],
            response: ResponseConfig::RandomOneLiner(RandomOneLinerResponseConfig {
                variant_count: 100,
                delay_ms: 20,
            }),
        },
        Mock {
            name: "LongRunning".to_string(),
            description:
                "Demonstrates very long streaming response (default 90s, supports: 'long running <seconds>')"
                    .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "long running".to_string(),
            })],
            response: ResponseConfig::LongRunning(LongRunningResponseConfig {
                default_seconds: 90,
                delay_ms: 1000,
                max_seconds: 3600,
            }),
        },
        Mock {
            name: "SmoothLong".to_string(),
            description:
                "Streams one lorem ipsum word every 50ms for 10 seconds (trigger: 'smooth_long')"
                    .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "smooth_long".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: build_lorem_word_chunks(200),
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "ScrollLong".to_string(),
            description:
                "Streams long line-based text to exercise manual scrolling during completion (trigger: 'scroll_long')"
                    .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: "scroll_long".to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: build_scroll_long_chunks(45),
                delay_ms: 100,
                ..Default::default()
            }),
        },
        Mock {
            name: "AudioSummary".to_string(),
            description:
                "Returns a stable summary for audio-transcription scenarios (trigger: 'summarize this audio')"
                    .to_string(),
            match_rules: vec![
                MatchRule::AnyMessageContainsAudioContent(MatchRuleAnyMessageContainsAudioContent {
                    content_type: Some("audio".to_string()),
                }),
                MatchRule::LastMessageIsUserWithPattern(MatchRuleLastMessageIsUserWithPattern {
                    pattern: "summarize this audio".to_string(),
                }),
                MatchRule::LastMessageIsUserWithPattern(MatchRuleLastMessageIsUserWithPattern {
                    pattern: "summarize audio".to_string(),
                }),
                MatchRule::LastMessageIsUserWithPattern(MatchRuleLastMessageIsUserWithPattern {
                    pattern: "summarize recording".to_string(),
                }),
                MatchRule::AnyUserMessageInCurrentTurnWithPattern(
                    MatchRuleAnyUserMessageInCurrentTurnWithPattern {
                        pattern: "audio transcription".to_string(),
                    },
                ),
            ],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "I".to_string(),
                    " can".to_string(),
                    " summarize".to_string(),
                    " the".to_string(),
                    " provided".to_string(),
                    " audio".to_string(),
                    " recording".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 80,
                ..Default::default()
            }),
        },
        Mock {
            name: "ContentFilterError".to_string(),
            description: "Returns an OpenAI-style content filter error response".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "erotic".to_string(),
                },
            )],
            response: ResponseConfig::Error(ErrorResponseConfig {
                status_code: 400,
                body: json!({
                    "error": {
                        "code": "content_filter",
                        "message": "The response was filtered due to the prompt triggering content management policy.",
                        "innererror": {
                            "content_filter_result": {
                                "sexual": { "filtered": true, "severity": "medium" },
                                "violence": { "filtered": false, "severity": "low" },
                                "hate": { "filtered": false, "severity": "safe" },
                                "self_harm": { "filtered": false, "severity": "safe" }
                            }
                        }
                    }
                }),
                initial_delay_ms: None,
            }),
        },
        Mock {
            name: "RateLimitError".to_string(),
            description: "Returns an OpenAI-style rate limit error response".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "rate limit".to_string(),
                },
            )],
            response: ResponseConfig::Error(ErrorResponseConfig {
                status_code: 429,
                body: json!({
                    "error": {
                        "code": "429",
                        "message": "Requests to the ChatCompletions_Create Operation under Azure OpenAI API version 2024-06-01 have exceeded call rate limit of your current OpenAI S0 pricing tier. Please retry after 8 seconds. Please go here: https://aka.ms/oai/quotaincrease if you would like to further increase the default rate limit. For Free Account customers, upgrade to Pay as you Go here: https://aka.ms/429TrialUpgrade."
                    }
                }),
                initial_delay_ms: None,
            }),
        },
        Mock {
            name: "ReadSecretToolCall".to_string(),
            description: "Returns a tool call to read_text_file when last message is user asking to read secret"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "read secret".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "read_text_file".to_string(),
                arguments: r#"{"path":"./secret.txt"}"#.to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "ReadMockFileToolCall".to_string(),
            description:
                "Returns a tool call to read_file when last message asks to read mock file"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "read mock file".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "read_file".to_string(),
                arguments: r#"{"path":"docs/readme.txt"}"#.to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "GenerateCatMcpToolCall".to_string(),
            description:
                "Returns a tool call to generate_image when last message asks for generate cat mcp"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "generate cat mcp".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "generate_image".to_string(),
                arguments: r#"{"prompt":"A cute cat, studio lighting","num_images":1,"width":1024,"height":1024}"#
                    .to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "TriggerMcpContentFilterToolCall".to_string(),
            description:
                "Returns a tool call to trigger_content_filter when last message asks for mcp content filter"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp content filter".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "trigger_content_filter".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "McpAuthNoneToolCall".to_string(),
            description: "Returns a tool call to auth_none_probe for MCP none-auth coverage"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp auth none".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "auth_none_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "McpAuthFixedToolCall".to_string(),
            description:
                "Returns a tool call to auth_fixed_api_key_probe for MCP fixed-auth coverage"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp auth fixed".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "auth_fixed_api_key_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "McpAuthForwardedAccessToolCall".to_string(),
            description:
                "Returns a tool call to auth_forwarded_access_probe for MCP forwarded access coverage"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp auth forwarded access".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "auth_forwarded_access_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "McpAuthForwardedOidcToolCall".to_string(),
            description:
                "Returns a tool call to auth_forwarded_oidc_probe for MCP forwarded OIDC coverage"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp auth forwarded oidc".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "auth_forwarded_oidc_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "McpApprovalPolicyToolCall".to_string(),
            description:
                "Returns an open-world MCP call that must be approved under the restrictive preset"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp approval probe".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "publish_approval_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "ToolResultResponse".to_string(),
            description: "Returns a text response when the last message is a tool result"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsToolResult],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "The".to_string(),
                    " secret".to_string(),
                    " content".to_string(),
                    " has".to_string(),
                    " been".to_string(),
                    " read".to_string(),
                    " successfully".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "ReadMultipleSecretsToolCalls".to_string(),
            description:
                "Returns multiple parallel tool calls to read secret.txt and secret2.txt"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "read multiple secrets".to_string(),
                },
            )],
            response: ResponseConfig::ToolCalls(ToolCallsResponseConfig {
                tool_calls: vec![
                    ToolCallDef {
                        tool_name: "read_text_file".to_string(),
                        arguments: r#"{"path":"/Users/hobofan/hobofan/erato/erato/backend/erato/tests/mcp-files/secret.txt"}"#
                            .to_string(),
                    },
                    ToolCallDef {
                        tool_name: "read_text_file".to_string(),
                        arguments: r#"{"path":"/Users/hobofan/hobofan/erato/erato/backend/erato/tests/mcp-files/secret2.txt"}"#
                            .to_string(),
                    },
                ],
                delay_ms: 100,
            }),
        },
    ]
}

/// Get the default set of configured image mocks
pub fn get_default_image_mocks() -> Vec<ImageMock> {
    vec![ImageMock {
        name: "Cat Image".to_string(),
        description: "Returns a cat image when prompt contains 'cat'".to_string(),
        pattern: "cat".to_string(),
        image_base64: image_data::CAT_IMAGE_BASE64.to_string(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_default_image_mocks_count() {
        let image_mocks = get_default_image_mocks();

        // Verify we have the expected number of image mocks
        assert_eq!(image_mocks.len(), 1);

        // Verify all image mocks have names
        for mock in &image_mocks {
            assert!(!mock.name.is_empty());
            assert!(!mock.description.is_empty());
            assert!(!mock.pattern.is_empty());
            assert!(!mock.image_base64.is_empty());
        }
    }

    #[test]
    fn test_default_mocks_include_random_one_liner() {
        let mocks = get_default_mocks();
        assert!(mocks.iter().any(|mock| mock.name == "RandomOneLiner"));
    }

    #[test]
    fn test_delayed_error_matches_before_delay_mock() {
        use crate::matcher::{ChatCompletionRequest, Matcher};

        let matcher = Matcher::new(get_default_mocks());
        let request: ChatCompletionRequest = serde_json::from_value(serde_json::json!({
            "messages": [{"role": "user", "content": "please delayed error"}]
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0001");
        match response {
            ResponseConfig::Error(config) => {
                assert_eq!(config.status_code, 400);
                assert_eq!(config.initial_delay_ms, Some(5000));
                assert_eq!(config.body["error"]["code"], "content_filter");
            }
            _ => panic!("Expected Error response"),
        }
    }

    const DELEGATE_ASSISTANT_ID: &str = "0192f4ad-8f37-7bd6-9d47-3b0a4c2f1e55";

    /// The delegation tool offer erato builds for the mentioned assistants;
    /// the `assistant_id` enum is the only place a runtime id reaches a mock.
    fn delegation_tool_offer() -> serde_json::Value {
        serde_json::json!([{
            "type": "function",
            "function": {
                "name": "delegate_to_assistant",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "assistant_id": {"type": "string", "enum": [DELEGATE_ASSISTANT_ID]},
                        "task": {"type": "string"},
                    },
                },
            },
        }])
    }

    /// Erato wraps the brief in the configured delegation preamble before it
    /// becomes the delegate's first user message.
    fn delegate_first_user_message() -> String {
        format!(
            "{DELEGATION_CHILD_BRIEF}\n\n<system-reminder>\nYou are working on a task that another conversation delegated to you. Your final message is returned to the delegating conversation as the result of this task; it is not shown to a person directly.\n</system-reminder>"
        )
    }

    fn match_default_mocks(
        messages: serde_json::Value,
        tools: Option<serde_json::Value>,
    ) -> ResponseConfig {
        use crate::matcher::{ChatCompletionRequest, Matcher};

        let mut body = serde_json::json!({ "messages": messages });
        if let Some(tools) = tools {
            body["tools"] = tools;
        }
        let request: ChatCompletionRequest = serde_json::from_value(body).unwrap();
        Matcher::new(get_default_mocks()).match_request(&request, "delegation")
    }

    #[test]
    fn delegation_turns_match_their_own_mocks_before_the_tool_result_catch_all() {
        use serde_json::json;

        let origin_prompt = format!("@DelegationProbe-a1b2c3 {DELEGATION_PARENT_PROMPT}");
        let origin_system = "You are a helpful assistant";
        let delegate_system = "Answer the delegated probe task.";
        let delegation_result = json!({
            "status": "completed",
            "assistant_id": DELEGATE_ASSISTANT_ID,
            "delegate_chat_id": "0192f4ad-9002-7c11-8f6e-4d1b7a55c081",
            "result": "CHILD-ANSWER: the delegate listed the mock files and reported the count back.",
            "truncated": false,
        })
        .to_string();

        let origin_turn = match_default_mocks(
            json!([
                {"role": "system", "content": origin_system},
                {"role": "user", "content": origin_prompt},
            ]),
            Some(delegation_tool_offer()),
        );
        match origin_turn {
            ResponseConfig::ToolCall(config) => {
                assert_eq!(config.tool_name, "delegate_to_assistant");
                assert!(config.arguments.contains(DELEGATE_ASSISTANT_ID));
                assert!(config.arguments.contains(DELEGATION_CHILD_BRIEF));
            }
            other => panic!("origin turn matched {other:?}"),
        }

        let delegate_turn = match_default_mocks(
            json!([
                {"role": "system", "content": delegate_system},
                {"role": "user", "content": delegate_first_user_message()},
            ]),
            None,
        );
        match delegate_turn {
            ResponseConfig::ToolCall(config) => assert_eq!(config.tool_name, "list_files"),
            other => panic!("delegate turn matched {other:?}"),
        }

        let delegate_after_tool = match_default_mocks(
            json!([
                {"role": "system", "content": delegate_system},
                {"role": "user", "content": delegate_first_user_message()},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": "{\"files\":[\"secret.txt\",\"secret2.txt\"]}"},
            ]),
            None,
        );
        match delegate_after_tool {
            ResponseConfig::Static(config) => {
                assert!(config.chunks.join("").starts_with("CHILD-ANSWER"))
            }
            other => panic!("delegate answer turn matched {other:?}"),
        }

        let origin_after_delegation = match_default_mocks(
            json!([
                {"role": "system", "content": origin_system},
                {"role": "user", "content": origin_prompt},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": delegation_result},
            ]),
            Some(delegation_tool_offer()),
        );
        match origin_after_delegation {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                "The delegate finished the probe task."
            ),
            other => panic!("origin answer turn matched {other:?}"),
        }
    }

    #[test]
    fn delegation_falls_back_to_text_when_no_assistant_is_offered() {
        use serde_json::json;

        let response = match_default_mocks(
            json!([{"role": "user", "content": DELEGATION_PARENT_PROMPT}]),
            None,
        );
        match response {
            ResponseConfig::Static(config) => {
                assert!(config.chunks.join("").contains("delegate_to_assistant"))
            }
            other => panic!("unoffered delegation matched {other:?}"),
        }
    }

    #[test]
    fn test_summary_title_matches_before_user_pattern_mocks() {
        use crate::matcher::{ChatCompletionRequest, Matcher};

        let matcher = Matcher::new(get_default_mocks());
        // Shaped like an erato summary request: the summary system prompt plus
        // the raw first user message, which would otherwise match LongRunning.
        let request: ChatCompletionRequest = serde_json::from_value(serde_json::json!({
            "messages": [
                {"role": "system", "content": "Generate a summary for the topic of the following chat, based on the first message to the chat."},
                {"role": "user", "content": "long running 12"}
            ]
        }))
        .unwrap();

        let response = matcher.match_request(&request, "test0002");
        match response {
            ResponseConfig::Static(config) => {
                assert_eq!(config.chunks, vec!["Mock Summary Title"]);
            }
            _ => panic!("Expected Static response"),
        }
    }
}
