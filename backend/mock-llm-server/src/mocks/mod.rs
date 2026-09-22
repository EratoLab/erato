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
///
/// One marker per child rather than one for the pair: the two children run the
/// same brief against the same tool, so a shared marker would make their answers
/// identical and a result delivered into the wrong parent call would read as the
/// right one.
const PAIRED_TASK_CHILD_A_TRACE_PREFIX: &str = "PAIRED-CHILD-A-CONTEXT";

const PAIRED_TASK_CHILD_B_TRACE_PREFIX: &str = "PAIRED-CHILD-B-CONTEXT";

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

/// Typed into the origin chat by the plan-gate e2e: two awaited tasks in one
/// batch, which is exactly `plan_min_tasks` and so the smallest plan the `plan`
/// mode asks about.
///
/// ONE prompt drives every test of that file. The batch is identical in all of
/// them and only the selected facet differs, so what the dispatch-approval
/// policy changes is the only thing that can explain a different outcome — a
/// second prompt per policy would have made the comparison about the prompt.
const PLANNED_TASKS_PARENT_PROMPT: &str = "plan two probe tasks";

/// The briefs the origin model writes into the two `delegate_task` calls, in
/// this order. They are what the plan card's rows are told apart by, so a test
/// can approve one task and decline the other without asking which row is
/// which.
const PLANNED_TASK_CHILD_BRIEF_A: &str = "Planned child brief A: report on the first planned step.";

const PLANNED_TASK_CHILD_BRIEF_B: &str =
    "Planned child brief B: report on the second planned step.";

/// Neither planned child calls a tool: the file is about what happens before a
/// child exists, and a child that answers in one turn is one fewer turn that
/// can be slow.
const PLANNED_TASK_CHILD_ANSWER_A: &str = "PLANNED-CHILD-A-ANSWER";
const PLANNED_TASK_CHILD_ANSWER_B: &str = "PLANNED-CHILD-B-ANSWER";

/// The origin answers a settled plan with its own tool trace rather than with
/// prose, because the decision is only readable from the results the turn was
/// resumed with: an approved task by its child's answer, a declined one by the
/// refusal that took its place. A scripted sentence would say the same thing
/// whatever the user decided.
const PLANNED_TASKS_TRACE_PREFIX: &str = "PLANNED-TASKS-CONTEXT";

/// Typed into the origin chat by the async-park e2e: one `async` task whose
/// child stops on a gated call. Not a superstring of any other task prompt in
/// either direction — matching is first-match substring over this list, so an
/// overlap would let one probe answer another's turns.
const ASYNC_PARK_PARENT_PROMPT: &str = "detach the gated probe as a background task";

/// The brief of the parked `async` child. It is the one thing present in every
/// turn of the child and absent from every turn of the origin, which is what
/// lets one pair of rules drive a child whose first turn calls the gated tool
/// and whose second answers on top of whatever the decision was.
const ASYNC_PARK_TASK_CHILD_BRIEF: &str =
    "Async gated child brief: publish the approval probe and report what came back.";

/// The parked child answers with its own tool trace, so the SAME rules serve
/// the allow and the deny test: an allowed call is visible by the probe's own
/// result and a denied one by the refusal that took its place, while a scripted
/// sentence would claim the call succeeded whatever was decided. It is also the
/// text the second delivery carries into the origin chat, so the decision is
/// readable from the delivered row rather than only from the child's chat.
const ASYNC_PARK_CHILD_TRACE_PREFIX: &str = "ASYNC-PARK-CHILD-CONTEXT";

/// Typed into the origin chat by the plain half of the async e2e: one `async`
/// task that never stops, which is the one-row round trip the two-row parked
/// one has to be told apart from.
const ASYNC_PLAIN_PARENT_PROMPT: &str = "detach the plain probe as a background task";

/// Its child calls nothing: that test is about the delivery, and a tool call
/// would only add a turn that can be slow.
const ASYNC_PLAIN_TASK_CHILD_BRIEF: &str =
    "Async plain child brief: report the probe status without using any tool.";

const ASYNC_PLAIN_CHILD_ANSWER: &str = "ASYNC-PLAIN-CHILD-ANSWER";

/// What the origin says on the turn that dispatched an `async` task. It has to
/// be its own marker: an `async` call returns a launch envelope and NOT the
/// child's answer, so a test can only tell the dispatch apart from an awaited
/// run by what is absent from this turn.
const ASYNC_DISPATCH_PARENT_ANSWER: &str = "ASYNC-DISPATCH-PARENT-ANSWER";

/// The status lines a delivered `task_result` row opens with, which is what the
/// origin's reaction is keyed on. The delivered row is the last user message of
/// the reaction turn, so the prompt-keyed rules cannot see that turn at all —
/// and a reaction scripted off the prompt would read the same whether the
/// delivery had arrived or not. The status is also the one field the contract
/// fixes for this, so keying on it is what keeps the two reactions from
/// standing in for each other: only a parked run delivers `input_required`, and
/// only a run with an answer delivers `completed`.
const ASYNC_PARK_NOTIFIED_STATUS: &str = "status: input_required";
const ASYNC_DELIVERED_STATUS: &str = "status: completed";

/// What the origin says to each of them. Two markers rather than one because a
/// parked `async` run delivers twice, and a test that could not tell the
/// reactions apart could not tell one delivery from two.
const ASYNC_PARK_NOTIFIED_ANSWER: &str = "ASYNC-DELIVERY-NOTIFIED";
const ASYNC_PARK_ANSWERED_ANSWER: &str = "ASYNC-DELIVERY-ANSWERED";

/// Typed into the origin chat by the queue e2e: THREE awaited tasks, which is
/// more than one slot and so more than a `max_parallel` of 1 can start.
///
/// Three rather than two so the queue is a queue and not just a deferred call:
/// two slots have to wait, and they have to come back in the order they were
/// planned in.
const QUEUED_TASKS_PARENT_PROMPT: &str = "plan a slow probe and two quick ones";

/// Dispatched FIRST, and the only one that can start under a one-slot cap.
///
/// Its answer is held back long enough for a test to stand in the queued state
/// rather than having to catch it between two fast turns. A parked child cannot
/// serve here: parking frees the run's slot, so the queue would drain while the
/// approval card was still on screen.
const QUEUED_SLOW_CHILD_BRIEF: &str =
    "Queued batch slow brief: hold the only slot while the others wait.";

/// How long the slow child holds the slot. Comfortably inside the scenario's
/// `run_timeout_seconds`, and far longer than the poll and render budget the
/// queued assertions need.
const QUEUED_SLOW_CHILD_DELAY_MS: u64 = 15_000;

/// The two calls behind it, which the cap has nowhere to put. One brief each,
/// because a shared brief could not tell which slot came back with which answer.
const QUEUED_QUICK_CHILD_BRIEF_A: &str = "Queued batch quick brief A: answer at once.";
const QUEUED_QUICK_CHILD_BRIEF_B: &str = "Queued batch quick brief B: answer at once.";

const QUEUED_SLOW_CHILD_ANSWER: &str = "QUEUED-SLOW-CHILD-ANSWER";
const QUEUED_QUICK_CHILD_ANSWER_A: &str = "QUEUED-QUICK-CHILD-A-ANSWER";
const QUEUED_QUICK_CHILD_ANSWER_B: &str = "QUEUED-QUICK-CHILD-B-ANSWER";

/// What the origin says once every slot of the batch is settled.
const QUEUED_TASKS_PARENT_ANSWER: &str = "QUEUED-TASKS-PARENT-ANSWER";

/// Typed into the origin chat by the retry e2e: one `async` task whose child
/// cannot answer at all. Not a superstring of any other task prompt in either
/// direction, for the reason every prompt here restates.
const FAILING_TASK_PARENT_PROMPT: &str = "detach the doomed probe as a background task";

/// The brief of the child that never answers.
///
/// It gets an error rule of its own rather than borrowing the generic
/// `RateLimitError` further down the list. Borrowing looked cheaper — a child's
/// brief IS the last user message of its first turn, so a brief containing
/// "rate limit" would reach that rule — but matching is first-match substring
/// over the whole list, and the generic error rules sit behind `Greeting`, whose
/// "hi" pattern is inside any brief containing the word "this". A rule here, in
/// the delegation group, is decided before any of that can interfere.
const FAILING_TASK_CHILD_BRIEF: &str =
    "Doomed child brief: the provider breaks on every turn of this run.";

/// How long the doomed child takes to break.
///
/// A run that failed instantly would be indistinguishable from one that was
/// never started, and — the reason this constant exists — a retry of it would be
/// over before anything could ask whether a second retry is allowed while one is
/// in flight. The retry carries the same brief, so it breaks the same way after
/// the same wait, which is what makes that window a window.
const FAILING_TASK_CHILD_DELAY_MS: u64 = 8_000;

/// The status line a delivery carries when the run it reports did not answer.
/// Keyed on like its two siblings, and for the same reason: only a run that
/// broke delivers `failed`, so the reaction to it cannot stand in for either of
/// the others.
const ASYNC_FAILED_STATUS: &str = "status: failed";

/// What the origin says when it is told a task broke. Its own marker, so a test
/// can tell "the origin was told the run failed" from "the origin was handed an
/// answer" — the distinction a retry offer turns on.
const ASYNC_FAILED_ANSWER: &str = "ASYNC-DELIVERY-FAILED";

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
        // One answer rule per brief, not one for the prefix both share: the pair
        // is indistinguishable otherwise, and the origin turn's two slots are
        // exactly what has to be told apart.
        Mock {
            name: "PairedGatedTaskChildAnswerA".to_string(),
            description: "Answers paired child A with the call it was allowed or refused"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: PAIRED_TASK_CHILD_BRIEF_A.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: PAIRED_TASK_CHILD_A_TRACE_PREFIX.to_string(),
                delay_ms: 200,
            }),
        },
        Mock {
            name: "PairedGatedTaskChildAnswerB".to_string(),
            description: "Answers paired child B with the call it was allowed or refused"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: PAIRED_TASK_CHILD_BRIEF_B.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: PAIRED_TASK_CHILD_B_TRACE_PREFIX.to_string(),
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
                // The sibling's result has to survive the other child's
                // resumption untouched, and "untouched" is only an assertion if
                // a second dispatch would say something else.
                distinct_per_invocation: true,
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
        // The dispatch-approval policy's own probe: two awaited tasks in one
        // batch, which under `plan` is a question and under the shipped
        // `async_only` default is not. Both children answer in a single turn,
        // so the only rules needed are one per brief.
        Mock {
            name: "PlannedTasksToolCalls".to_string(),
            description: "Plans two awaited sub-tasks in one batch".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: PLANNED_TASKS_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCalls(ToolCallsResponseConfig {
                tool_calls: vec![
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{PLANNED_TASK_CHILD_BRIEF_A}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{PLANNED_TASK_CHILD_BRIEF_B}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                ],
                delay_ms: 100,
            }),
        },
        Mock {
            name: "PlannedTaskChildAnswerA".to_string(),
            description: "Answers the first planned sub-task".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: PLANNED_TASK_CHILD_BRIEF_A.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    PLANNED_TASK_CHILD_ANSWER_A.to_string(),
                    ": the".to_string(),
                    " first".to_string(),
                    " step".to_string(),
                    " is".to_string(),
                    " done".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        Mock {
            name: "PlannedTaskChildAnswerB".to_string(),
            description: "Answers the second planned sub-task".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: PLANNED_TASK_CHILD_BRIEF_B.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    PLANNED_TASK_CHILD_ANSWER_B.to_string(),
                    ": the".to_string(),
                    " second".to_string(),
                    " step".to_string(),
                    " is".to_string(),
                    " done".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        Mock {
            name: "PlannedTasksAnswer".to_string(),
            description: "Answers the origin chat with the results the settled plan left it"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: PLANNED_TASKS_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: PLANNED_TASKS_TRACE_PREFIX.to_string(),
                delay_ms: 200,
            }),
        },
        // The `async` probes. An `async` call returns a launch envelope instead
        // of a result, so the origin turn ends before its child does and the
        // child's answer reaches the chat later as a delivered `task_result`
        // row. That row is a USER message, which is why the two reaction rules
        // below are keyed on the row's own status line: the prompt-keyed rules
        // cannot see a turn whose last user message is a delivery, and a
        // reaction scripted off the prompt would read the same whether the
        // delivery had arrived or not.
        //
        // Ordering inside this group follows the group above: tool-call rules
        // before answer rules, because a brief is the last user message of its
        // child's FIRST turn only and a second gated call would park the run
        // again instead of answering it.
        Mock {
            name: "AsyncParkParentToolCall".to_string(),
            description: "Detaches a sub-task whose only tool needs the user's approval"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: ASYNC_PARK_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "delegate_task".to_string(),
                arguments: format!(
                    "{{\"task\": \"{ASYNC_PARK_TASK_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\", \"run_mode\": \"async\"}}"
                ),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "AsyncPlainParentToolCall".to_string(),
            description: "Detaches a sub-task that stops for nothing".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: ASYNC_PLAIN_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "delegate_task".to_string(),
                arguments: format!(
                    "{{\"task\": \"{ASYNC_PLAIN_TASK_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\", \"run_mode\": \"async\"}}"
                ),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "QueuedTasksToolCalls".to_string(),
            description: "Plans three awaited sub-tasks, of which a one-slot cap can start one"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: QUEUED_TASKS_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCalls(ToolCallsResponseConfig {
                tool_calls: vec![
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{QUEUED_SLOW_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{QUEUED_QUICK_CHILD_BRIEF_A}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                    ToolCallDef {
                        tool_name: "delegate_task".to_string(),
                        arguments: format!(
                            "{{\"task\": \"{QUEUED_QUICK_CHILD_BRIEF_B}\", \"expected_output\": \"One sentence.\"}}"
                        ),
                    },
                ],
                delay_ms: 100,
            }),
        },
        Mock {
            name: "QueuedSlowChildAnswer".to_string(),
            description: "Answers the slow sub-task only after it has held its slot a while"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: QUEUED_SLOW_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    QUEUED_SLOW_CHILD_ANSWER.to_string(),
                    ": the".to_string(),
                    " slot".to_string(),
                    " is".to_string(),
                    " free".to_string(),
                    " again".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 50,
                initial_delay_ms: Some(QUEUED_SLOW_CHILD_DELAY_MS),
                ..Default::default()
            }),
        },
        Mock {
            name: "QueuedQuickChildAnswerA".to_string(),
            description: "Answers the first queued sub-task as soon as it is allowed to start"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: QUEUED_QUICK_CHILD_BRIEF_A.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    QUEUED_QUICK_CHILD_ANSWER_A.to_string(),
                    ": the".to_string(),
                    " wait".to_string(),
                    " is".to_string(),
                    " over".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "QueuedQuickChildAnswerB".to_string(),
            description: "Answers the second queued sub-task as soon as it is allowed to start"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: QUEUED_QUICK_CHILD_BRIEF_B.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    QUEUED_QUICK_CHILD_ANSWER_B.to_string(),
                    ": the".to_string(),
                    " wait".to_string(),
                    " is".to_string(),
                    " over".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 50,
                ..Default::default()
            }),
        },
        Mock {
            name: "QueuedTasksAnswer".to_string(),
            description: "Answers the origin once every slot of the queued batch is settled"
                .to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: QUEUED_TASKS_PARENT_PROMPT.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    QUEUED_TASKS_PARENT_ANSWER.to_string(),
                    ": every".to_string(),
                    " task".to_string(),
                    " ran".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 100,
                ..Default::default()
            }),
        },
        Mock {
            name: "FailingTaskParentToolCall".to_string(),
            description: "Detaches a sub-task whose provider refuses its first turn".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: FAILING_TASK_PARENT_PROMPT.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "delegate_task".to_string(),
                arguments: format!(
                    "{{\"task\": \"{FAILING_TASK_CHILD_BRIEF}\", \"expected_output\": \"One sentence.\", \"run_mode\": \"async\"}}"
                ),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "FailingTaskChildRefused".to_string(),
            description: "Refuses every turn of the doomed sub-task, so its run fails".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: FAILING_TASK_CHILD_BRIEF.to_string(),
            })],
            // The status a provider that is simply unavailable answers with. What
            // the run needs is an INFRASTRUCTURE failure: a refusal the child
            // could speak on top of would finish the run `completed`, and a
            // completed run is deliberately not retryable.
            response: ResponseConfig::Error(ErrorResponseConfig {
                status_code: 429,
                body: json!({
                    "error": {
                        "code": "429",
                        "message": "Requests to the ChatCompletions_Create Operation have exceeded the call rate limit of your current pricing tier."
                    }
                }),
                initial_delay_ms: Some(FAILING_TASK_CHILD_DELAY_MS),
            }),
        },
        Mock {
            name: "AsyncParkChildToolCall".to_string(),
            description: "Returns the gated call on the detached child's first turn".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: ASYNC_PARK_TASK_CHILD_BRIEF.to_string(),
                },
            )],
            response: ResponseConfig::ToolCall(ToolCallResponseConfig {
                tool_name: "publish_approval_probe".to_string(),
                arguments: "{}".to_string(),
                delay_ms: 100,
            }),
        },
        Mock {
            name: "AsyncParkChildAnswer".to_string(),
            description: "Answers the detached child with the decision its call got".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: ASYNC_PARK_TASK_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::ToolTrace(ToolTraceResponseConfig {
                prefix: ASYNC_PARK_CHILD_TRACE_PREFIX.to_string(),
                delay_ms: 200,
            }),
        },
        Mock {
            name: "AsyncPlainChildAnswer".to_string(),
            description: "Answers the detached child that never stopped".to_string(),
            match_rules: vec![MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                pattern: ASYNC_PLAIN_TASK_CHILD_BRIEF.to_string(),
            })],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    ASYNC_PLAIN_CHILD_ANSWER.to_string(),
                    ": the".to_string(),
                    " probe".to_string(),
                    " needed".to_string(),
                    " no".to_string(),
                    " decision".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        // The two reactions to a delivered row. They must precede nothing in
        // particular — no earlier rule can match a turn whose last user message
        // is a delivery — but they are keyed on the status line rather than on
        // the child's answer so that "which delivery is this" is read off the
        // one field the contract fixes, and so the pair cannot stand in for
        // each other: only a parked run produces `input_required`, and only a
        // run that has an answer produces `completed`.
        Mock {
            name: "AsyncDeliveryFailedReaction".to_string(),
            description: "Reacts to a delivered result that says the run broke".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: ASYNC_FAILED_STATUS.to_string(),
                },
            )],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    ASYNC_FAILED_ANSWER.to_string(),
                    ": the".to_string(),
                    " task".to_string(),
                    " did".to_string(),
                    " not".to_string(),
                    " finish".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        Mock {
            name: "AsyncDeliveryNotifiedReaction".to_string(),
            description: "Reacts to a delivered result that says the run stopped to ask"
                .to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: ASYNC_PARK_NOTIFIED_STATUS.to_string(),
                },
            )],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    ASYNC_PARK_NOTIFIED_ANSWER.to_string(),
                    ": the".to_string(),
                    " task".to_string(),
                    " is".to_string(),
                    " waiting".to_string(),
                    " on".to_string(),
                    " you".to_string(),
                    ".".to_string(),
                ],
                delay_ms: 200,
                ..Default::default()
            }),
        },
        Mock {
            name: "AsyncDeliveryAnsweredReaction".to_string(),
            description: "Reacts to a delivered result that carries the run's answer".to_string(),
            match_rules: vec![MatchRule::LastMessageIsUserWithPattern(
                MatchRuleLastMessageIsUserWithPattern {
                    pattern: ASYNC_DELIVERED_STATUS.to_string(),
                },
            )],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    ASYNC_PARK_ANSWERED_ANSWER.to_string(),
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
        Mock {
            name: "AsyncDispatchParentAnswer".to_string(),
            description: "Answers the turn that launched a detached sub-task".to_string(),
            match_rules: vec![
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: ASYNC_PARK_PARENT_PROMPT.to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: ASYNC_PLAIN_PARENT_PROMPT.to_string(),
                }),
                MatchRule::UserMessagePattern(MatchRuleUserMessagePattern {
                    pattern: FAILING_TASK_PARENT_PROMPT.to_string(),
                }),
            ],
            response: ResponseConfig::Static(StaticResponseConfig {
                chunks: vec![
                    ASYNC_DISPATCH_PARENT_ANSWER.to_string(),
                    ": the".to_string(),
                    " task".to_string(),
                    " is".to_string(),
                    " running".to_string(),
                    " in".to_string(),
                    " the".to_string(),
                    " background".to_string(),
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
                ..Default::default()
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

        // Each child's answer carries ITS OWN marker and not its sibling's: one
        // result delivered into both parent slots is only detectable if the two
        // answers differ.
        for (brief, own, other_marker) in [
            (
                PAIRED_TASK_CHILD_BRIEF_A,
                PAIRED_TASK_CHILD_A_TRACE_PREFIX,
                PAIRED_TASK_CHILD_B_TRACE_PREFIX,
            ),
            (
                PAIRED_TASK_CHILD_BRIEF_B,
                PAIRED_TASK_CHILD_B_TRACE_PREFIX,
                PAIRED_TASK_CHILD_A_TRACE_PREFIX,
            ),
        ] {
            let denied_child_answer = match_default_mocks(
                json!([
                    {"role": "system", "content": "Answer the delegated probe task."},
                    {"role": "user", "content": delegate_preamble_message()},
                    {"role": "user", "content": brief},
                    {"role": "assistant", "content": null, "tool_calls": [
                        {"id": "call_9", "type": "function", "function": {"name": "publish_approval_probe", "arguments": "{}"}},
                    ]},
                    {"role": "tool", "tool_call_id": "call_9", "content": "{\"status\":\"rejected\",\"error\":\"The user denied this tool call.\"}"},
                ]),
                None,
            );
            match denied_child_answer {
                ResponseConfig::Static(config) => {
                    let answer = config.chunks.join("");
                    assert_eq!(
                        answer,
                        format!(
                            "{own}: publish_approval_probe\
                             [{{\"status\":\"rejected\",\"error\":\"The user denied this tool call.\"}}]"
                        )
                    );
                    assert!(!answer.contains(other_marker));
                }
                other => panic!("denied child answer for {brief} matched {other:?}"),
            }
        }

        let origin_answer = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": PAIRED_TASKS_PARENT_PROMPT},
                {"role": "assistant", "content": null},
                {"role": "tool", "content": json!({
                    "status": "completed",
                    "result": format!("{PAIRED_TASK_CHILD_A_TRACE_PREFIX}: publish_approval_probe[approval probe published]"),
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
            ResponseConfig::Static(config) => assert!(config
                .chunks
                .join("")
                .starts_with("MIXED-PLAIN-CHILD-ANSWER: the mock files are listed.")),
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

    /// The lever the park-after-settle e2e reads "the sibling was not re-run"
    /// off: two dispatches of the same brief answer differently, so a result
    /// that is still the one committed before the decision can be recognised as
    /// that one rather than as an identical replacement.
    #[test]
    fn the_mixed_pair_s_sibling_answers_each_dispatch_differently() {
        use serde_json::json;

        let answer = || {
            let response = match_default_mocks(
                json!([
                    {"role": "system", "content": "Answer the delegated probe task."},
                    {"role": "user", "content": delegate_preamble_message()},
                    {"role": "user", "content": MIXED_PLAIN_TASK_CHILD_BRIEF},
                    {"role": "assistant", "content": null, "tool_calls": [
                        {"id": "call_5", "type": "function", "function": {"name": "list_files", "arguments": "{}"}},
                    ]},
                    {"role": "tool", "tool_call_id": "call_5", "content": "{\"files\":[\"a.txt\"]}"},
                ]),
                None,
            );
            match response {
                ResponseConfig::Static(config) => config.chunks.join(""),
                other => panic!("plain child answer matched {other:?}"),
            }
        };

        let first = answer();
        let second = answer();
        assert_ne!(first, second);
        for generated in [&first, &second] {
            assert!(generated.starts_with("MIXED-PLAIN-CHILD-ANSWER"));
        }
    }

    /// The plan-gate probe's four turns. The parent's answer is a trace, so the
    /// assertion is that a declined task reaches the model as the refusal the
    /// e2e reads out of the finished reply — under a scripted sentence the same
    /// answer would appear whether the denial had been delivered or dropped.
    #[test]
    fn the_planned_tasks_probe_traces_the_decision_each_task_was_settled_with() {
        use serde_json::json;

        let child_system = "Answer the delegated probe task.";

        let origin_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": PLANNED_TASKS_PARENT_PROMPT},
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
                    .contains(PLANNED_TASK_CHILD_BRIEF_A));
                assert!(config.tool_calls[1]
                    .arguments
                    .contains(PLANNED_TASK_CHILD_BRIEF_B));
                // No `run_mode`: an awaited batch is what the shipped
                // `async_only` default has nothing to ask about, and the whole
                // A/B rests on both policies seeing the same batch.
                assert!(config
                    .tool_calls
                    .iter()
                    .all(|call| !call.arguments.contains("run_mode")));
            }
            other => panic!("origin turn matched {other:?}"),
        }

        for (brief, answer) in [
            (PLANNED_TASK_CHILD_BRIEF_A, PLANNED_TASK_CHILD_ANSWER_A),
            (PLANNED_TASK_CHILD_BRIEF_B, PLANNED_TASK_CHILD_ANSWER_B),
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
                ResponseConfig::Static(config) => {
                    assert!(config.chunks.join("").starts_with(answer))
                }
                other => panic!("child turn for {brief} matched {other:?}"),
            }
        }

        // One task approved, the other declined: the trace has to carry both,
        // and the refusal verbatim, because that string is what the e2e reads
        // off the finished reply.
        let origin_after_partial_approval = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": PLANNED_TASKS_PARENT_PROMPT},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_plan_a", "type": "function", "function": {"name": "delegate_task", "arguments": "{}"}},
                    {"id": "call_plan_b", "type": "function", "function": {"name": "delegate_task", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "call_plan_a", "content": json!({
                    "status": "completed",
                    "result": format!("{PLANNED_TASK_CHILD_ANSWER_A}: the first step is done."),
                    "truncated": false,
                }).to_string()},
                {"role": "tool", "tool_call_id": "call_plan_b", "content": "{\"status\":\"rejected\",\"error\":\"The user declined this task.\"}"},
            ]),
            None,
        );
        match origin_after_partial_approval {
            ResponseConfig::Static(config) => {
                let answer = config.chunks.join("");
                assert!(answer.starts_with(&format!("{PLANNED_TASKS_TRACE_PREFIX}: ")));
                assert!(answer.contains(PLANNED_TASK_CHILD_ANSWER_A));
                assert!(
                    answer.contains("The user declined this task."),
                    "the refusal must survive the trace's per-result cap: {answer}"
                );
            }
            other => panic!("origin answer after a partial approval matched {other:?}"),
        }
    }

    /// The detached probes' turns, including the two the origin only ever sees
    /// as a delivered row.
    ///
    /// The `run_mode` argument is the assertion that carries the first half:
    /// without it the task is awaited, the child's answer comes back as the
    /// call's result, and there is no delivery to re-arm at all. The reaction
    /// rules are the second half — they are keyed on the status line of the row
    /// rather than on the prompt, because the delivery is the last user message
    /// of the turn it draws and a prompt-keyed rule cannot see that turn.
    #[test]
    fn the_detached_probes_ask_for_async_and_react_to_each_delivered_status() {
        use serde_json::json;

        let child_system = "Answer the delegated probe task.";

        for (prompt, brief) in [
            (ASYNC_PARK_PARENT_PROMPT, ASYNC_PARK_TASK_CHILD_BRIEF),
            (ASYNC_PLAIN_PARENT_PROMPT, ASYNC_PLAIN_TASK_CHILD_BRIEF),
        ] {
            let origin_turn = match_default_mocks(
                json!([
                    {"role": "system", "content": "You are a helpful assistant"},
                    {"role": "user", "content": prompt},
                ]),
                None,
            );
            match origin_turn {
                ResponseConfig::ToolCall(config) => {
                    assert_eq!(config.tool_name, "delegate_task");
                    assert!(config.arguments.contains(brief));
                    assert!(
                        config.arguments.contains("\"run_mode\": \"async\""),
                        "a detached probe must ask for it: {}",
                        config.arguments
                    );
                }
                other => panic!("origin turn for {prompt} matched {other:?}"),
            }

            // Whatever the child does, the turn that dispatched it answers with
            // the launch marker: the e2e reads the absence of the child's answer
            // from this very turn.
            let origin_after_dispatch = match_default_mocks(
                json!([
                    {"role": "system", "content": "You are a helpful assistant"},
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": null, "tool_calls": [
                        {"id": "call_async", "type": "function", "function": {"name": "delegate_task", "arguments": "{}"}},
                    ]},
                    {"role": "tool", "tool_call_id": "call_async", "content": "{\"status\":\"dispatched\"}"},
                ]),
                None,
            );
            match origin_after_dispatch {
                ResponseConfig::Static(config) => assert_eq!(
                    config.chunks.join(""),
                    format!(
                        "{ASYNC_DISPATCH_PARENT_ANSWER}: the task is running in the background."
                    )
                ),
                other => panic!("dispatch answer for {prompt} matched {other:?}"),
            }
        }

        let parked_child_turn = match_default_mocks(
            json!([
                {"role": "system", "content": child_system},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": ASYNC_PARK_TASK_CHILD_BRIEF},
            ]),
            None,
        );
        match parked_child_turn {
            ResponseConfig::ToolCall(config) => {
                assert_eq!(config.tool_name, "publish_approval_probe")
            }
            other => panic!("detached child's first turn matched {other:?}"),
        }

        // One pair of child rules serves the allow and the deny test, so the
        // answer has to be the trace of whatever the call came back with.
        for decision in [
            "approval probe published",
            "{\"status\":\"rejected\",\"error\":\"The user denied this tool call.\"}",
        ] {
            let child_answer = match_default_mocks(
                json!([
                    {"role": "system", "content": child_system},
                    {"role": "user", "content": delegate_preamble_message()},
                    {"role": "user", "content": ASYNC_PARK_TASK_CHILD_BRIEF},
                    {"role": "assistant", "content": null, "tool_calls": [
                        {"id": "call_async_child", "type": "function", "function": {"name": "publish_approval_probe", "arguments": "{}"}},
                    ]},
                    {"role": "tool", "tool_call_id": "call_async_child", "content": decision},
                ]),
                None,
            );
            match child_answer {
                ResponseConfig::Static(config) => assert_eq!(
                    config.chunks.join(""),
                    format!("{ASYNC_PARK_CHILD_TRACE_PREFIX}: publish_approval_probe[{decision}]")
                ),
                other => panic!("detached child's answer for {decision} matched {other:?}"),
            }
        }

        // The two reactions. The row erato renders opens with the status line and
        // carries nothing of the prompt, which is exactly why the prompt-keyed
        // answer above cannot serve here.
        for (status, expected) in [
            (ASYNC_PARK_NOTIFIED_STATUS, ASYNC_PARK_NOTIFIED_ANSWER),
            (ASYNC_DELIVERED_STATUS, ASYNC_PARK_ANSWERED_ANSWER),
        ] {
            let reaction = match_default_mocks(
                json!([
                    {"role": "system", "content": "You are a helpful assistant"},
                    {"role": "user", "content": ASYNC_PARK_PARENT_PROMPT},
                    {"role": "assistant", "content": format!("{ASYNC_DISPATCH_PARENT_ANSWER}: the task is running in the background.")},
                    {"role": "user", "content": format!("Delegated task result — {status}.\nsome guidance\n\nsome body")},
                ]),
                None,
            );
            match reaction {
                ResponseConfig::Static(config) => assert!(
                    config.chunks.join("").starts_with(expected),
                    "the reaction to '{status}' must be its own: {:?}",
                    config.chunks
                ),
                other => panic!("reaction to {status} matched {other:?}"),
            }
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
            PLANNED_TASKS_PARENT_PROMPT,
            PLANNED_TASK_CHILD_BRIEF_A,
            PLANNED_TASK_CHILD_BRIEF_B,
            ASYNC_PARK_PARENT_PROMPT,
            ASYNC_PARK_TASK_CHILD_BRIEF,
            ASYNC_PLAIN_PARENT_PROMPT,
            ASYNC_PLAIN_TASK_CHILD_BRIEF,
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

    /// The doomed probe's whole mechanism, in one place: the origin detaches the
    /// task, and the brief it writes is what the child's own first turn is
    /// refused for.
    ///
    /// Asserted as a pair rather than as "the brief contains 'rate limit'",
    /// because the claim is not about the text — it is that the child turn
    /// carrying this brief really resolves to a provider error. A brief that
    /// stopped matching `RateLimitError` would leave the retry e2e with a task
    /// that quietly succeeds.
    #[test]
    fn the_doomed_probe_detaches_a_task_whose_child_turn_is_refused() {
        use serde_json::json;

        let origin_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": FAILING_TASK_PARENT_PROMPT},
            ]),
            None,
        );
        match origin_turn {
            ResponseConfig::ToolCall(config) => {
                assert_eq!(config.tool_name, "delegate_task");
                assert!(config.arguments.contains(FAILING_TASK_CHILD_BRIEF));
                // Detached, or there is no delivered row to offer a retry on.
                assert!(config.arguments.contains("\"run_mode\": \"async\""));
            }
            other => panic!("origin turn matched {other:?}"),
        }

        let child_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "Answer the delegated probe task."},
                {"role": "user", "content": delegate_preamble_message()},
                {"role": "user", "content": FAILING_TASK_CHILD_BRIEF},
            ]),
            None,
        );
        match child_turn {
            ResponseConfig::Error(config) => {
                assert_eq!(config.status_code, 429);
                // It breaks slowly on purpose: a retry of it has to still be in
                // flight for long enough that "one live retry per failure" is
                // observable.
                assert_eq!(config.initial_delay_ms, Some(FAILING_TASK_CHILD_DELAY_MS));
            }
            other => panic!("child turn matched {other:?}"),
        }
    }

    /// The origin is told a broken run broke, under a marker of its own.
    ///
    /// Keyed on the status line, like the two reactions it sits beside: a
    /// reaction shared with `completed` could not say whether the origin learned
    /// the task had failed or thought it had an answer.
    #[test]
    fn a_failed_delivery_draws_its_own_reaction() {
        use serde_json::json;

        let reaction = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": FAILING_TASK_PARENT_PROMPT},
                {"role": "assistant", "content": "dispatched"},
                {"role": "user", "content": format!("A task you delegated earlier has finished. {ASYNC_FAILED_STATUS}")},
            ]),
            None,
        );
        match reaction {
            ResponseConfig::Static(config) => {
                assert!(config.chunks.join("").starts_with(ASYNC_FAILED_ANSWER))
            }
            other => panic!("reaction matched {other:?}"),
        }
    }

    /// The queued batch: three awaited calls, the first of which is the only one
    /// that can start under a one-slot cap and is the only one that takes any
    /// time.
    ///
    /// The delay is asserted as well as the calls, because it is the mechanism:
    /// a parked child would free its slot and drain the queue, so the slot has to
    /// be held by a run that is simply still working.
    #[test]
    fn the_queued_batch_plans_three_awaited_tasks_behind_one_slow_one() {
        use serde_json::json;

        let origin_turn = match_default_mocks(
            json!([
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": QUEUED_TASKS_PARENT_PROMPT},
            ]),
            None,
        );
        match origin_turn {
            ResponseConfig::ToolCalls(config) => {
                assert_eq!(config.tool_calls.len(), 3);
                assert!(config
                    .tool_calls
                    .iter()
                    .all(|call| call.tool_name == "delegate_task"));
                assert!(config.tool_calls[0]
                    .arguments
                    .contains(QUEUED_SLOW_CHILD_BRIEF));
                assert!(config.tool_calls[1]
                    .arguments
                    .contains(QUEUED_QUICK_CHILD_BRIEF_A));
                assert!(config.tool_calls[2]
                    .arguments
                    .contains(QUEUED_QUICK_CHILD_BRIEF_B));
                // Awaited: the cap is about how many run at once, and a detached
                // batch would settle every slot at launch and queue nothing.
                assert!(config
                    .tool_calls
                    .iter()
                    .all(|call| !call.arguments.contains("run_mode")));
            }
            other => panic!("origin turn matched {other:?}"),
        }

        let child_turn = |brief: &str| {
            match_default_mocks(
                json!([
                    {"role": "system", "content": "Answer the delegated probe task."},
                    {"role": "user", "content": delegate_preamble_message()},
                    {"role": "user", "content": brief},
                ]),
                None,
            )
        };

        match child_turn(QUEUED_SLOW_CHILD_BRIEF) {
            ResponseConfig::Static(config) => {
                assert!(config.chunks.join("").starts_with(QUEUED_SLOW_CHILD_ANSWER));
                assert_eq!(config.initial_delay_ms, Some(QUEUED_SLOW_CHILD_DELAY_MS));
            }
            other => panic!("slow child turn matched {other:?}"),
        }

        for (brief, answer) in [
            (QUEUED_QUICK_CHILD_BRIEF_A, QUEUED_QUICK_CHILD_ANSWER_A),
            (QUEUED_QUICK_CHILD_BRIEF_B, QUEUED_QUICK_CHILD_ANSWER_B),
        ] {
            match child_turn(brief) {
                ResponseConfig::Static(config) => {
                    assert!(config.chunks.join("").starts_with(answer));
                    // Nothing holds these back: the only wait they can show is
                    // the queue's.
                    assert_eq!(config.initial_delay_ms, None);
                }
                other => panic!("child turn for {brief} matched {other:?}"),
            }
        }
    }
}
