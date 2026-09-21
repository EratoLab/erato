use crate::image_data;
use crate::matcher::{
    CiteFilesResponseConfig, DelegateToAssistantResponseConfig, ErrorResponseConfig, ImageMock,
    LongRunningResponseConfig, MatchRule, MatchRuleAnyMessageContainsAudioContent,
    MatchRuleAnySystemMessageWithPattern, MatchRuleAnyUserMessageInCurrentTurnWithPattern,
    MatchRuleLastMessageIsUserWithPattern, MatchRuleUserMessagePattern, Mock,
    RandomOneLinerResponseConfig, ResponseConfig, StaticResponseConfig, ToolCallDef,
    ToolCallResponseConfig, ToolCallsResponseConfig, ToolTraceResponseConfig,
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

/// Typed into the origin chat by the dynamic-tasks e2e. Distinct from the
/// mention prompt above so the two delegation routes never answer each
/// other's turns.
const TASK_PARENT_PROMPT: &str = "run the probe as a task";

/// The brief the origin model writes into its own `delegate_task` call. Like
/// the mention brief, it is the one thing present in every task turn and
/// absent from every origin turn.
const TASK_CHILD_BRIEF: &str =
    "Task probe child brief: count the available mock files and report the number.";

/// Typed into the origin chat by the approvals e2e. Deliberately not a
/// superstring of `TASK_PARENT_PROMPT` in either direction: matching is
/// first-match substring over the mock list, so an overlap would let one task
/// probe answer the other's turns.
const GATED_TASK_PARENT_PROMPT: &str = "run the gated probe as a task";

/// The brief the origin model writes into the gated probe's `delegate_task`
/// call. Like the other briefs it is the one thing present in every turn of the
/// child and absent from every turn of the origin.
const GATED_TASK_CHILD_BRIEF: &str =
    "Gated task child brief: publish the approval probe and report what it said.";

/// Typed into a chat of the `approvals` scenario by the batch-continuation e2e.
/// The turn it answers makes three calls in one batch, of which only the middle
/// one needs a decision — which is what parks the turn with a processed call
/// behind it and an unprocessed one in front of it.
const BATCH_PARK_PROMPT: &str = "batch approval probe";

/// Marker the resumed turn's answer opens with. The answer is the request's own
/// tool trace, so it is the test's only window on the context the continuation
/// rebuilt.
const BATCH_PARK_TRACE_PREFIX: &str = "BATCH-RESUMED-CONTEXT";

/// Typed into the origin chat by the multi-decision e2e: two tasks that each
/// stop on the same gated call, so one stop on the origin turn covers two
/// decisions.
const PAIRED_TASKS_PARENT_PROMPT: &str = "run both gated probes as tasks";

/// What both paired briefs share and no other prompt contains: one pair of
/// rules drives both children, while each brief is the last user message of its
/// own child's turns only.
const PAIRED_TASK_CHILD_BRIEF_PREFIX: &str = "Paired gated child brief";

const PAIRED_TASK_CHILD_BRIEF_A: &str =
    "Paired gated child brief A: publish the paired approval probe.";

const PAIRED_TASK_CHILD_BRIEF_B: &str =
    "Paired gated child brief B: publish the paired approval probe.";

/// The paired children answer with their own tool trace, so the decision a
/// child's call was settled with is visible in the answer that reaches the
/// origin chat — an approval by its result, a denial by its refusal.
const PAIRED_TASK_CHILD_TRACE_PREFIX: &str = "PAIRED-CHILD-CONTEXT";

/// Typed into the origin chat by the deny half of the child-park e2e: one task,
/// one gated call, one refusal. Kept to a single child on purpose — denial is
/// the half of the flow with the most ways to go wrong (a killed child, a turn
/// that never closes), so the test that asserts it carries no second run.
const REFUSED_TASK_PARENT_PROMPT: &str = "refuse the gated probe task";

/// The brief of the child that gets denied. Its answer is a tool trace rather
/// than prose, because the whole claim of the test is that the refusal reached
/// the child and the child spoke on top of it — a scripted sentence would say
/// the call succeeded no matter what was decided.
const REFUSED_TASK_CHILD_BRIEF: &str =
    "Refused task child brief: attempt the approval probe and say what came back.";

const REFUSED_TASK_CHILD_TRACE_PREFIX: &str = "REFUSED-CHILD-CONTEXT";

/// Typed into the origin chat by the park-after-settle e2e: two tasks of which
/// only the first needs a decision, so the turn has to finish the second one and
/// commit its result before it asks about the first.
const MIXED_TASKS_PARENT_PROMPT: &str = "run one gated and one plain probe as tasks";

/// Dispatched FIRST, so its placeholder holds slot 0 while the sibling behind it
/// settles: a park that vacated its slot would leave the two results in the
/// wrong order, which is the defect this brief exists to expose.
const MIXED_GATED_TASK_CHILD_BRIEF: &str =
    "Mixed gated child brief: publish the approval probe for the mixed pair.";

/// Dispatched second and gated by nothing, so it settles while its sibling is
/// still waiting on the user.
const MIXED_PLAIN_TASK_CHILD_BRIEF: &str =
    "Mixed plain child brief: list the mock files for the mixed pair.";

const MIXED_GATED_TASK_CHILD_TRACE_PREFIX: &str = "MIXED-GATED-CHILD-CONTEXT";

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
            name: "DynamicTaskParentToolCall".to_string(),
            description: "Plans a sub-task with the reserved erato/delegate_task tool"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: TASK_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "delegate_task".to_string(),
                arguments: format!(
                    "{{\"task\": \"{TASK_CHILD_BRIEF}\", \"expected_output\": \"A single number.\"}}"
                ),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "DynamicTaskChildAnswer".to_string(),
            description: "Answers the sub-task on the turn that carries its brief".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: TASK_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "TASK-CHILD-ANSWER".to_string(),
                    ": there".to_string(),
                    " are".to_string(),
                    " three".to_string(),
                    " files".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 300,
                ..Default::default()
            }),
        },
        Mock {
            name: "DynamicTaskParentAnswer".to_string(),
            description: "Answers the origin chat once the sub-task's result is in".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: TASK_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "TASK-PARENT-ANSWER".to_string(),
                    ": the".to_string(),
                    " task".to_string(),
                    " counted".to_string(),
                    " three".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        // The gated task probe of the `approvals` scenario: four turns across two
        // chats, with an approval in the middle. It sits with the other
        // delegation mocks for their ordering reason — every one of them ends on
        // a tool result, so all of them must precede ToolResultResponse — and
        // within itself the tool-call mocks precede the answer mocks, because
        // the brief is the child's last user message on BOTH of its turns and
        // only the first of them may call the tool. A second call would park the
        // origin turn again and never answer it.
        Mock {
            name: "GatedTaskParentToolCall".to_string(),
            description: "Plans a sub-task whose only tool needs the user's approval".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: GATED_TASK_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "delegate_task".to_string(),
                arguments: format!(
                    "{{\"task\": \"{GATED_TASK_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\"}}"
                ),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "GatedTaskChildToolCall".to_string(),
            description:
                "Returns the approval-gated MCP call on the child turn that carries the brief"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: GATED_TASK_CHILD_BRIEF.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "publish_approval_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "GatedTaskChildAnswer".to_string(),
            description: "Answers the gated sub-task once its approved call resolved".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: GATED_TASK_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "GATED-TASK-CHILD-ANSWER".to_string(),
                    ": the".to_string(),
                    " approval".to_string(),
                    " probe".to_string(),
                    " was".to_string(),
                    " published".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        Mock {
            name: "GatedTaskParentAnswer".to_string(),
            description: "Answers the origin chat once the gated sub-task's result is in"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: GATED_TASK_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "GATED-TASK-PARENT-ANSWER".to_string(),
                    ": the".to_string(),
                    " task".to_string(),
                    " published".to_string(),
                    " the".to_string(),
                    " probe".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        // The batch park of the `approvals` scenario: one turn, three calls, a
        // decision in the middle of them. The gated call sits between two
        // ungated ones on purpose — the first is already processed when the turn
        // parks and must come back in the resumed request, the third is
        // abandoned by the park and must run after the decision.
        //
        // The answer is the request's own tool trace rather than prose: the
        // context a continuation rebuilds is invisible from a browser, and a
        // trace is the one thing the model can say that carries it.
        Mock {
            name: "BatchApprovalParkToolCalls".to_string(),
            description: "Returns three calls of which only the middle one needs approval"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: BATCH_PARK_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCalls(ToolCallsResponseConfig {
                tool_calls: vec![
                    ToolCallDef {
                        tool_name: "read_approval_fixture".to_string(),
                        arguments: "{}".to_string(),
                    },
                    ToolCallDef {
                        tool_name: "publish_approval_probe".to_string(),
                        arguments: "{}".to_string(),
                    },
                    ToolCallDef {
                        tool_name: "list_files".to_string(),
                        arguments: "{}".to_string(),
                    },
                ],
                delay_ms: 100,
            }),
        },
        Mock {
            name: "BatchApprovalParkAnswer".to_string(),
            description: "Answers the resumed batch with the calls its request carries".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: BATCH_PARK_PROMPT.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: BATCH_PARK_TRACE_PREFIX.to_string(),
                delay_ms: 200,
            }),
        },
        // Two tasks that both stop to ask, so the origin turn raises one stop
        // covering two decisions. One pair of child rules serves both: the
        // briefs share a prefix, and a child's own brief is the last user
        // message of its first turn only — which is what keeps the turn after
        // the decision from calling the gated tool again.
        Mock {
            name: "PairedGatedTasksToolCalls".to_string(),
            description: "Plans two sub-tasks whose only tool needs the user's approval".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: PAIRED_TASKS_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCalls(ToolCallsResponseConfig {
                tool_calls: vec![
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{PAIRED_TASK_CHILD_BRIEF_A}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{PAIRED_TASK_CHILD_BRIEF_B}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                ],
                delay_ms: 100,
            }),
        },
        Mock {
            name: "PairedGatedTaskChildToolCall".to_string(),
            description: "Returns the gated call on either paired child's first turn".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: PAIRED_TASK_CHILD_BRIEF_PREFIX.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "publish_approval_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "PairedGatedTaskChildAnswer".to_string(),
            description: "Answers a paired child with the call it was allowed or refused"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: PAIRED_TASK_CHILD_BRIEF_PREFIX.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: PAIRED_TASK_CHILD_TRACE_PREFIX.to_string(),
                delay_ms: 200,
            }),
        },
        Mock {
            name: "PairedGatedTasksAnswer".to_string(),
            description: "Answers the origin chat once both paired sub-tasks are settled"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: PAIRED_TASKS_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "PAIRED-TASKS-PARENT-ANSWER".to_string(),
                    ": both".to_string(),
                    " tasks".to_string(),
                    " are".to_string(),
                    " settled".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        // One task that is denied. It duplicates the gated probe's shape rather
        // than reusing it because the two want different answers from the child:
        // the gated probe is approved and says so in prose, while a denied child
        // has to repeat what the refusal put in its context, which only a trace
        // can do.
        Mock {
            name: "RefusedTaskParentToolCall".to_string(),
            description: "Plans a sub-task whose gated call the user is going to deny".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: REFUSED_TASK_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "delegate_task".to_string(),
                arguments: format!(
                    "{{\"task\": \"{REFUSED_TASK_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\"}}"
                ),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "RefusedTaskChildToolCall".to_string(),
            description: "Returns the gated call on the refused child's first turn".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: REFUSED_TASK_CHILD_BRIEF.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "publish_approval_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "RefusedTaskChildAnswer".to_string(),
            description: "Answers the refused child with the refusal its call came back with"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: REFUSED_TASK_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: REFUSED_TASK_CHILD_TRACE_PREFIX.to_string(),
                delay_ms: 200,
            }),
        },
        Mock {
            name: "RefusedTaskParentAnswer".to_string(),
            description: "Answers the origin chat on top of a sub-task that was refused"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: REFUSED_TASK_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "REFUSED-TASK-PARENT-ANSWER".to_string(),
                    ": the".to_string(),
                    " task".to_string(),
                    " reported".to_string(),
                    " back".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        // Two tasks of which only the first stops to ask. The gated brief is the
        // FIRST call on purpose: its placeholder has to hold slot 0 while the
        // ungated sibling behind it settles, and the origin turn may only ask
        // once that sibling's result is committed.
        Mock {
            name: "MixedGatedTasksToolCalls".to_string(),
            description: "Plans one sub-task that needs approval and one that does not".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: MIXED_TASKS_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCalls(ToolCallsResponseConfig {
                tool_calls: vec![
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{MIXED_GATED_TASK_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{MIXED_PLAIN_TASK_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                ],
                delay_ms: 100,
            }),
        },
        Mock {
            name: "MixedGatedTaskChildToolCall".to_string(),
            description: "Returns the gated call on the mixed pair's first child".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: MIXED_GATED_TASK_CHILD_BRIEF.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "publish_approval_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "MixedPlainTaskChildToolCall".to_string(),
            description: "Returns an ungated call on the mixed pair's second child".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: MIXED_PLAIN_TASK_CHILD_BRIEF.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "list_files".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "MixedGatedTaskChildAnswer".to_string(),
            description: "Answers the mixed pair's gated child with the decision it got"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: MIXED_GATED_TASK_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: MIXED_GATED_TASK_CHILD_TRACE_PREFIX.to_string(),
                delay_ms: 200,
            }),
        },
        Mock {
            name: "MixedPlainTaskChildAnswer".to_string(),
            description: "Answers the mixed pair's ungated child, which never stopped".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: MIXED_PLAIN_TASK_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "MIXED-PLAIN-CHILD-ANSWER".to_string(),
                    ": the".to_string(),
                    " mock".to_string(),
                    " files".to_string(),
                    " are".to_string(),
                    " listed".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        Mock {
            name: "MixedGatedTasksAnswer".to_string(),
            description: "Answers the origin chat once both mixed sub-tasks are settled"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: MIXED_TASKS_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    "MIXED-TASKS-PARENT-ANSWER".to_string(),
                    ": both".to_string(),
                    " tasks".to_string(),
                    " reported".to_string(),
                    " back".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
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
            name: "TriggerMcpMalformedOutputToolCall".to_string(),
            description:
                "Returns a tool call to generate_image with intentionally malformed output from MCP"
                    .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: "mcp malformed output".to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "generate_image".to_string(),
                arguments: r#"{"prompt":"malformed","num_images":1,"width":1024,"height":1024}"#
                    .to_string(),
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

    /// Erato composes the configured delegation preamble into a user message of
    /// its own, ahead of the brief — which stays the delegate's last user
    /// message, and so the one the turn mocks key on.
    fn delegate_preamble_message() -> String {
        "<system-reminder>\nYou are working on a task that another conversation delegated to you. Your final message is returned to the delegating conversation as the result of this task; it is not shown to a person directly.\n</system-reminder>".to_string()
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
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": DELEGATION_CHILD_BRIEF},
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
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": DELEGATION_CHILD_BRIEF},
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

    /// The approvals scenario's four turns, in the order the cluster asks for
    /// them. The child's brief is its last user message on BOTH child turns, so
    /// only the mock order keeps the turn after the approval from calling the
    /// gated tool a second time — which would park the origin turn again and
    /// never answer it.
    #[test]
    fn gated_task_turns_match_their_own_mocks_on_both_sides_of_the_approval() {
        use serde_json::json;

        let origin_system = "You are a helpful assistant";
        let child_system = "Answer the delegated probe task.";

        let origin_turn = match_default_mocks(
            json!([
                {"role": "system", "content": origin_system},
                {"role": "user", "content": GATED_TASK_PARENT_PROMPT},
            ]),
            None,
        );
        match origin_turn {
            ResponseConfig::ToolCall(config) => {
                assert_eq!(config.tool_name, "delegate_task");
                assert!(config.arguments.contains(GATED_TASK_CHILD_BRIEF));
            }
            other => panic!("origin turn matched {other:?}"),
        }

        let child_turn = match_default_mocks(
            json!([
                {"role": "system", "content": child_system},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": GATED_TASK_CHILD_BRIEF},
            ]),
            None,
        );
        match child_turn {
            ResponseConfig::ToolCall(config) => {
                assert_eq!(config.tool_name, "publish_approval_probe")
            }
            other => panic!("child turn matched {other:?}"),
        }

        let child_after_approval = match_default_mocks(
            json!([
                {"role": "system", "content": child_system},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": GATED_TASK_CHILD_BRIEF},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": "approval probe published"},
            ]),
            None,
        );
        match child_after_approval {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                "GATED-TASK-CHILD-ANSWER: the approval probe was published."
            ),
            other => panic!("child answer turn matched {other:?}"),
        }

        let origin_after_task = match_default_mocks(
            json!([
                {"role": "system", "content": origin_system},
                {"role": "user", "content": GATED_TASK_PARENT_PROMPT},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": json!({
                    "status": "completed",
                    "result": "GATED-TASK-CHILD-ANSWER: the approval probe was published.",
                    "truncated": false,
                }).to_string()},
            ]),
            None,
        );
        match origin_after_task {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                "GATED-TASK-PARENT-ANSWER: the task published the probe."
            ),
            other => panic!("origin answer turn matched {other:?}"),
        }
    }

    /// The two task probes share the `assistants` mock quartet's shape and the
    /// `approvals` scenario runs the mock list the `assistants` one does, so an
    /// overlap between their prompts would make one probe answer the other's
    /// turns without either spec failing on anything but the prose.
    #[test]
    fn the_two_task_probes_never_answer_each_others_turns() {
        assert!(!GATED_TASK_PARENT_PROMPT.contains(TASK_PARENT_PROMPT));
        assert!(!TASK_PARENT_PROMPT.contains(GATED_TASK_PARENT_PROMPT));
        assert!(!GATED_TASK_CHILD_BRIEF.contains(TASK_CHILD_BRIEF));
        assert!(!TASK_CHILD_BRIEF.contains(GATED_TASK_CHILD_BRIEF));
    }

    /// The batch park's two halves: the three calls it asks for, and the trace
    /// the resumed turn answers with. The trace is what the e2e reads, so a
    /// request that had lost the call processed before the park would answer
    /// without it here too.
    #[test]
    fn the_batch_park_asks_for_three_calls_and_traces_all_of_them_on_resume() {
        use serde_json::json;

        let park_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": BATCH_PARK_PROMPT},
            ]),
            None,
        );
        match park_turn {
            ResponseConfig::ToolCalls(config) => assert_eq!(
                config
                    .tool_calls
                    .iter()
                    .map(|call| call.tool_name.as_str())
                    .collect::<Vec<_>>(),
                vec![
                    "read_approval_fixture",
                    "publish_approval_probe",
                    "list_files"
                ]
            ),
            other => panic!("park turn matched {other:?}"),
        }

        let resumed_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": BATCH_PARK_PROMPT},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {"name": "read_approval_fixture", "arguments": "{}"}},
                    {"id": "call_2", "type": "function", "function": {"name": "publish_approval_probe", "arguments": "{}"}},
                    {"id": "call_3", "type": "function", "function": {"name": "list_files", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "call_1", "content": "closed-world approval fixture read"},
                {"role": "tool", "tool_call_id": "call_2", "content": "approval probe published"},
                {"role": "tool", "tool_call_id": "call_3", "content": "{\"files\":[\"a.txt\"]}"},
            ]),
            None,
        );
        match resumed_turn {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                format!(
                    "{BATCH_PARK_TRACE_PREFIX}: \
                     read_approval_fixture[closed-world approval fixture read] | \
                     publish_approval_probe[approval probe published] | \
                     list_files[{{\"files\":[\"a.txt\"]}}]"
                )
            ),
            other => panic!("resumed turn matched {other:?}"),
        }
    }

    /// Both paired children run off one pair of rules, and their answer carries
    /// the decision their call was settled with — which is the only thing that
    /// tells an allowed run from a refused one once the answer has reached the
    /// origin chat.
    #[test]
    fn the_paired_tasks_drive_two_children_whose_answers_carry_their_decision() {
        use serde_json::json;

        let origin_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": PAIRED_TASKS_PARENT_PROMPT},
            ]),
            None,
        );
        match origin_turn {
            ResponseConfig::ToolCalls(config) => {
                assert_eq!(config.tool_calls.len(), 2);
                assert!(config
                    .tool_calls
                    .iter()
                    .all(|call| call.tool_name == "delegate_task"));
                assert!(config.tool_calls[0]
                    .arguments
                    .contains(PAIRED_TASK_CHILD_BRIEF_A));
                assert!(config.tool_calls[1]
                    .arguments
                    .contains(PAIRED_TASK_CHILD_BRIEF_B));
            }
            other => panic!("origin turn matched {other:?}"),
        }

        for brief in [PAIRED_TASK_CHILD_BRIEF_A, PAIRED_TASK_CHILD_BRIEF_B] {
            let child_turn = match_default_mocks(
                json!([
                    {"role": "system", "content": "Answer the delegated probe task."},
                    {"role": "user", "content": delegate_preamble_message()},
                    {"role": "user", "content": brief},
                ]),
                None,
            );
            match child_turn {
                ResponseConfig::ToolCall(config) => {
                    assert_eq!(config.tool_name, "publish_approval_probe")
                }
                other => panic!("child turn for {brief} matched {other:?}"),
            }
        }

        let denied_child_answer = match_default_mocks(
            json!([
                {"role": "system", "content": "Answer the delegated probe task."},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": PAIRED_TASK_CHILD_BRIEF_B},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_9", "type": "function", "function": {"name": "publish_approval_probe", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "call_9", "content": "{\"status\":\"rejected\",\"error\":\"The user denied this tool call.\"}"},
            ]),
            None,
        );
        match denied_child_answer {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                format!(
                    "{PAIRED_TASK_CHILD_TRACE_PREFIX}: publish_approval_probe\
                     [{{\"status\":\"rejected\",\"error\":\"The user denied this tool call.\"}}]"
                )
            ),
            other => panic!("denied child answer matched {other:?}"),
        }

        let origin_answer = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": PAIRED_TASKS_PARENT_PROMPT},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": json!({
                    "status": "completed",
                    "result": format!("{PAIRED_TASK_CHILD_TRACE_PREFIX}: publish_approval_probe[approval probe published]"),
                    "truncated": false,
                }).to_string()},
            ]),
            None,
        );
        match origin_answer {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                "PAIRED-TASKS-PARENT-ANSWER: both tasks are settled."
            ),
            other => panic!("origin answer matched {other:?}"),
        }
    }

    /// The refused child's two turns. The second one is what the e2e reads: the
    /// refusal is the only thing in the child's context by then, so a child that
    /// was killed by the denial rather than told about it could not answer this.
    #[test]
    fn the_refused_child_answers_with_the_refusal_its_call_came_back_with() {
        use serde_json::json;

        let child_system = "Answer the delegated probe task.";

        let child_turn = match_default_mocks(
            json!([
                {"role": "system", "content": child_system},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": REFUSED_TASK_CHILD_BRIEF},
            ]),
            None,
        );
        match child_turn {
            ResponseConfig::ToolCall(config) => {
                assert_eq!(config.tool_name, "publish_approval_probe")
            }
            other => panic!("refused child's first turn matched {other:?}"),
        }

        let child_after_denial = match_default_mocks(
            json!([
                {"role": "system", "content": child_system},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": REFUSED_TASK_CHILD_BRIEF},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_4", "type": "function", "function": {"name": "publish_approval_probe", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "call_4", "content": "{\"status\":\"rejected\",\"error\":\"The user denied this tool call.\"}"},
            ]),
            None,
        );
        match child_after_denial {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                format!(
                    "{REFUSED_TASK_CHILD_TRACE_PREFIX}: publish_approval_probe\
                     [{{\"status\":\"rejected\",\"error\":\"The user denied this tool call.\"}}]"
                )
            ),
            other => panic!("refused child's answer turn matched {other:?}"),
        }

        let origin_after_refusal = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": REFUSED_TASK_PARENT_PROMPT},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": json!({
                    "status": "completed",
                    "result": format!("{REFUSED_TASK_CHILD_TRACE_PREFIX}: publish_approval_probe[rejected]"),
                    "truncated": false,
                }).to_string()},
            ]),
            None,
        );
        match origin_after_refusal {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                "REFUSED-TASK-PARENT-ANSWER: the task reported back."
            ),
            other => panic!("origin answer turn matched {other:?}"),
        }
    }

    /// The mixed pair: the gated brief has to be the FIRST call, because the
    /// e2e reads the parked placeholder off slot 0 and the settled sibling off
    /// slot 1 — the assertion that a park does not vacate its slot.
    #[test]
    fn the_mixed_pair_dispatches_the_gated_task_first_and_only_it_stops() {
        use serde_json::json;

        let child_system = "Answer the delegated probe task.";

        let origin_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": MIXED_TASKS_PARENT_PROMPT},
            ]),
            None,
        );
        match origin_turn {
            ResponseConfig::ToolCalls(config) => {
                assert_eq!(config.tool_calls.len(), 2);
                assert!(config
                    .tool_calls
                    .iter()
                    .all(|call| call.tool_name == "delegate_task"));
                assert!(config.tool_calls[0]
                    .arguments
                    .contains(MIXED_GATED_TASK_CHILD_BRIEF));
                assert!(config.tool_calls[1]
                    .arguments
                    .contains(MIXED_PLAIN_TASK_CHILD_BRIEF));
            }
            other => panic!("origin turn matched {other:?}"),
        }

        for (brief, expected_tool) in [
            (MIXED_GATED_TASK_CHILD_BRIEF, "publish_approval_probe"),
            (MIXED_PLAIN_TASK_CHILD_BRIEF, "list_files"),
        ] {
            let child_turn = match_default_mocks(
                json!([
                    {"role": "system", "content": child_system},
                    {"role": "user", "content": delegate_preamble_message()},
                    {"role": "user", "content": brief},
                ]),
                None,
            );
            match child_turn {
                ResponseConfig::ToolCall(config) => {
                    assert_eq!(config.tool_name, expected_tool)
                }
                other => panic!("child turn for {brief} matched {other:?}"),
            }
        }

        // The ungated sibling never stops, so its answer is the one the origin
        // turn has to have committed before it asks about the other.
        let plain_child_answer = match_default_mocks(
            json!([
                {"role": "system", "content": child_system},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": MIXED_PLAIN_TASK_CHILD_BRIEF},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_5", "type": "function", "function": {"name": "list_files", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "call_5", "content": "{\"files\":[\"a.txt\"]}"},
            ]),
            None,
        );
        match plain_child_answer {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                "MIXED-PLAIN-CHILD-ANSWER: the mock files are listed."
            ),
            other => panic!("plain child answer matched {other:?}"),
        }

        let gated_child_answer = match_default_mocks(
            json!([
                {"role": "system", "content": child_system},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": MIXED_GATED_TASK_CHILD_BRIEF},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_6", "type": "function", "function": {"name": "publish_approval_probe", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "call_6", "content": "approval probe published"},
            ]),
            None,
        );
        match gated_child_answer {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                format!(
                    "{MIXED_GATED_TASK_CHILD_TRACE_PREFIX}: \
                     publish_approval_probe[approval probe published]"
                )
            ),
            other => panic!("gated child answer matched {other:?}"),
        }

        let origin_answer = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": MIXED_TASKS_PARENT_PROMPT},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": json!({
                    "status": "completed",
                    "result": "MIXED-PLAIN-CHILD-ANSWER: the mock files are listed.",
                    "truncated": false,
                }).to_string()},
            ]),
            None,
        );
        match origin_answer {
            ResponseConfig::Static(config) => assert_eq!(
                config.chunks.join(""),
                "MIXED-TASKS-PARENT-ANSWER: both tasks reported back."
            ),
            other => panic!("origin answer matched {other:?}"),
        }
    }

    /// Every prompt of the `approvals` scenario's probes, against every other:
    /// matching is first-match substring over one shared mock list, so an
    /// overlap would silently let one probe answer another's turns.
    #[test]
    fn no_approvals_probe_prompt_contains_another() {
        let prompts = [
            TASK_PARENT_PROMPT,
            TASK_CHILD_BRIEF,
            GATED_TASK_PARENT_PROMPT,
            GATED_TASK_CHILD_BRIEF,
            BATCH_PARK_PROMPT,
            PAIRED_TASKS_PARENT_PROMPT,
            PAIRED_TASK_CHILD_BRIEF_PREFIX,
            REFUSED_TASK_PARENT_PROMPT,
            REFUSED_TASK_CHILD_BRIEF,
            MIXED_TASKS_PARENT_PROMPT,
            MIXED_GATED_TASK_CHILD_BRIEF,
            MIXED_PLAIN_TASK_CHILD_BRIEF,
        ];
        for (index, prompt) in prompts.iter().enumerate() {
            for (other_index, other) in prompts.iter().enumerate() {
                assert!(
                    index == other_index || !prompt.contains(other),
                    "'{prompt}' contains '{other}'"
                );
            }
        }
        // The prefix stands in for both paired briefs, so it has to be shared by
        // them and by nothing else.
        assert!(PAIRED_TASK_CHILD_BRIEF_A.contains(PAIRED_TASK_CHILD_BRIEF_PREFIX));
        assert!(PAIRED_TASK_CHILD_BRIEF_B.contains(PAIRED_TASK_CHILD_BRIEF_PREFIX));
        assert_ne!(PAIRED_TASK_CHILD_BRIEF_A, PAIRED_TASK_CHILD_BRIEF_B);
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
