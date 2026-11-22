//! What the voice says while the user waits for an answer in conversational
//! audio mode: short lines in the answer's own voice, on timers, and a line
//! naming what a running tool call reads. Only the mechanism is here: the
//! words are data, from a content package or the deployment. A language
//! without lines says nothing, and the screen shows the wait as before.

use std::collections::HashMap;

use erato_memory::HeapSize;
use facet::Facet;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::config::has_hidden_chars;
use crate::config_facet_attrs as erato_config;
use crate::spoken::{Written, is_language_tag, written_table};
use config::Config;
use serde::Deserializer;

/// How much the voice says while the user waits.
#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Facet, HeapSize, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum WaitLinesAmount {
    /// An opener after a few seconds, a line per slow tool call, and lines
    /// for long waits.
    #[default]
    Normal,
    /// No opener: only tool call lines and the lines for long waits.
    LongOnly,
    /// Nothing is said; the screen shows the wait.
    Off,
}

/// `[audio_conversational.wait_lines]`. Times count from the end of the
/// user's speech unless said otherwise.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Facet, HeapSize)]
#[serde(default)]
pub struct WaitLinesConfig {
    /// `normal`, `long_only` or `off`. Defaults to `normal`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub amount: WaitLinesAmount,
    /// When the opener ("Einen Moment.") is due, and never before the
    /// transcript is back. Defaults to `3000`; allowed from `1500` to `10000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub first_after_ms: u32,
    /// How long a tool call runs before its line is due. Defaults to `1500`;
    /// allowed from `0` to `10000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub tool_after_ms: u32,
    /// When the "still on it" line is due. Defaults to `12000`; allowed from
    /// `5000` to `60000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub still_after_ms: u32,
    /// The "still on it" line waits until nothing was said for this long, so
    /// it is skipped while tool lines keep coming. Defaults to `8000`;
    /// allowed from `2000` to `30000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub still_quiet_ms: u32,
    /// When the "this takes longer" line is due. Defaults to `22000`;
    /// allowed from `10000` to `120000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub long_after_ms: u32,
    /// After the long line, "still on it" again every this many
    /// milliseconds until the turn ends. `0` says it no more. Defaults to
    /// `18000`; allowed `0` or from `10000` to `60000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub still_repeat_ms: u32,
    /// How many "still on it" lines at most after the long line, so a turn
    /// that hangs goes quiet while the screen shows the wait. Defaults to
    /// `3`; allowed from `0` to `20`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub still_repeat_max: u32,
    /// From the end of one line to the start of the next. Defaults to
    /// `4000`; allowed from `1000` to `15000`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub min_gap_ms: u32,
    /// Openers, tool lines and the first "still on it" in one turn at most;
    /// the long line and the repeats after it are outside this cap. `0` says
    /// nothing at all. Defaults to `3`; allowed from `0` to `5`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub max_per_turn: u32,
    /// After this many turns with an opener, the opener comes from the short
    /// set. `0` never shortens. Defaults to `3`; allowed up to `50`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub taper_after_turns: u32,
    /// Whether a user may choose their own amount. `false` is a lock no
    /// audience reopens; with `true`, a supervisor's audience may still
    /// close it. Defaults to `true`.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub user_choice: bool,
    /// Lines per language tag, by slot. A language or slot without lines
    /// says nothing.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub phrases: HashMap<String, WaitLinePhrasesConfig>,
    /// Tool call line templates per language tag. `search` holds
    /// `{search}`; `items` and `list` hold `{table}`. A template not set, or
    /// empty, says nothing.
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub tools: HashMap<String, WaitLineToolsConfig>,
}

/// The lines of one language, by slot. The variants are picked at random,
/// never the one said last.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize, Facet, HeapSize)]
#[serde(default)]
pub struct WaitLinePhrasesConfig {
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub opener: Option<Vec<String>>,
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub opener_short: Option<Vec<String>>,
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub still: Option<Vec<String>>,
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub long: Option<Vec<String>>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize, Facet, HeapSize)]
#[serde(default)]
pub struct WaitLineToolsConfig {
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub search: Option<String>,
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub items: Option<String>,
    #[facet(erato_config::introduced_in(version = "unreleased"))]
    pub list: Option<String>,
}

pub const FIRST_AFTER_MS_RANGE: std::ops::RangeInclusive<u32> = 1500..=10_000;
pub const TOOL_AFTER_MS_RANGE: std::ops::RangeInclusive<u32> = 0..=10_000;
pub const STILL_AFTER_MS_RANGE: std::ops::RangeInclusive<u32> = 5000..=60_000;
pub const STILL_QUIET_MS_RANGE: std::ops::RangeInclusive<u32> = 2000..=30_000;
pub const LONG_AFTER_MS_RANGE: std::ops::RangeInclusive<u32> = 10_000..=120_000;
pub const STILL_REPEAT_MS_RANGE: std::ops::RangeInclusive<u32> = 10_000..=60_000;
pub const STILL_REPEAT_MAX_RANGE: std::ops::RangeInclusive<u32> = 0..=20;
pub const MIN_GAP_MS_RANGE: std::ops::RangeInclusive<u32> = 1000..=15_000;
pub const MAX_PER_TURN_RANGE: std::ops::RangeInclusive<u32> = 0..=5;
pub const TAPER_AFTER_TURNS_RANGE: std::ops::RangeInclusive<u32> = 0..=50;

/// A line longer than this is not a short line.
pub const MAX_LINE_CHARS: usize = 120;
/// Variants one slot keeps.
pub const MAX_VARIANTS: usize = 8;

impl Default for WaitLinesConfig {
    fn default() -> Self {
        Self {
            amount: WaitLinesAmount::Normal,
            first_after_ms: 3000,
            tool_after_ms: 1500,
            still_after_ms: 12_000,
            still_quiet_ms: 8000,
            long_after_ms: 22_000,
            still_repeat_ms: 18_000,
            still_repeat_max: 3,
            min_gap_ms: 4000,
            max_per_turn: 3,
            taper_after_turns: 3,
            user_choice: true,
            phrases: HashMap::new(),
            tools: HashMap::new(),
        }
    }
}

/// The slots of a language's lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WaitLineSlot {
    Opener,
    OpenerShort,
    Still,
    Long,
}

impl WaitLineSlot {
    pub const ALL: [Self; 4] = [Self::Opener, Self::OpenerShort, Self::Still, Self::Long];

    fn name(self) -> &'static str {
        match self {
            Self::Opener => "opener",
            Self::OpenerShort => "opener_short",
            Self::Still => "still",
            Self::Long => "long",
        }
    }
}

/// The lines and tool templates that apply in one language.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WaitLineSet {
    pub lines: Vec<(WaitLineSlot, String)>,
    pub search: Option<String>,
    pub items: Option<String>,
    pub list: Option<String>,
}

/// Why `line` cannot be said as a wait line, or `None` when it can.
pub fn line_problem(line: &str) -> Option<&'static str> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Some("it is blank");
    }
    if trimmed.chars().count() > MAX_LINE_CHARS {
        return Some("it is longer than 120 characters");
    }
    if trimmed.chars().any(char::is_control) || has_hidden_chars(trimmed) {
        return Some("it holds control or hidden characters");
    }
    // A question invites an answer the closed microphone would not hear.
    if trimmed.ends_with(['?', '？', '¿']) {
        return Some("it asks a question");
    }
    if trimmed.contains(['{', '}']) {
        return Some("it holds a brace; only tool templates have slots");
    }
    None
}

/// Why `template` cannot be a tool line with `slot`, or `None`.
pub fn template_problem(template: &str, slot: &str) -> Option<&'static str> {
    let trimmed = template.trim();
    if trimmed.chars().count() > MAX_LINE_CHARS {
        return Some("it is longer than 120 characters");
    }
    if trimmed.chars().any(char::is_control) || has_hidden_chars(trimmed) {
        return Some("it holds control or hidden characters");
    }
    if trimmed.ends_with(['?', '？', '¿']) {
        return Some("it asks a question");
    }
    let marker = format!("{{{slot}}}");
    if trimmed.matches(&marker).count() != 1 {
        return Some("it must hold its slot exactly once");
    }
    if trimmed.replacen(&marker, "", 1).contains(['{', '}']) {
        return Some("it holds a brace that is not its slot");
    }
    None
}

impl WaitLinesConfig {
    /// Sets each value outside its range back to its default and names it.
    pub fn fall_back_out_of_range(&mut self) -> Vec<String> {
        let defaults = Self::default();
        let mut warnings = Vec::new();
        let mut check = |key: &str,
                         value: &mut u32,
                         default: u32,
                         range: &std::ops::RangeInclusive<u32>| {
            if !range.contains(value) {
                warnings.push(format!(
                        "`audio_conversational.wait_lines.{key}` = {value} is outside {} to {}; using the default {default}.",
                        range.start(),
                        range.end()
                    ));
                *value = default;
            }
        };
        check(
            "first_after_ms",
            &mut self.first_after_ms,
            defaults.first_after_ms,
            &FIRST_AFTER_MS_RANGE,
        );
        check(
            "tool_after_ms",
            &mut self.tool_after_ms,
            defaults.tool_after_ms,
            &TOOL_AFTER_MS_RANGE,
        );
        check(
            "still_after_ms",
            &mut self.still_after_ms,
            defaults.still_after_ms,
            &STILL_AFTER_MS_RANGE,
        );
        check(
            "still_quiet_ms",
            &mut self.still_quiet_ms,
            defaults.still_quiet_ms,
            &STILL_QUIET_MS_RANGE,
        );
        check(
            "long_after_ms",
            &mut self.long_after_ms,
            defaults.long_after_ms,
            &LONG_AFTER_MS_RANGE,
        );
        check(
            "still_repeat_max",
            &mut self.still_repeat_max,
            defaults.still_repeat_max,
            &STILL_REPEAT_MAX_RANGE,
        );
        check(
            "min_gap_ms",
            &mut self.min_gap_ms,
            defaults.min_gap_ms,
            &MIN_GAP_MS_RANGE,
        );
        check(
            "max_per_turn",
            &mut self.max_per_turn,
            defaults.max_per_turn,
            &MAX_PER_TURN_RANGE,
        );
        check(
            "taper_after_turns",
            &mut self.taper_after_turns,
            defaults.taper_after_turns,
            &TAPER_AFTER_TURNS_RANGE,
        );
        if self.still_repeat_ms != 0 && !STILL_REPEAT_MS_RANGE.contains(&self.still_repeat_ms) {
            warnings.push(format!(
                "`audio_conversational.wait_lines.still_repeat_ms` = {} is neither 0 nor from {} to {}; using the default {}.",
                self.still_repeat_ms,
                STILL_REPEAT_MS_RANGE.start(),
                STILL_REPEAT_MS_RANGE.end(),
                defaults.still_repeat_ms
            ));
            self.still_repeat_ms = defaults.still_repeat_ms;
        }
        warnings
    }

    /// Removes lines and templates that cannot be said, so that one bad
    /// entry of a content package never stops a deployment, and names each.
    pub fn drop_unusable(&mut self) -> Vec<String> {
        let mut dropped = Vec::new();
        let place = "audio_conversational.wait_lines";
        self.phrases.retain(|language, _| {
            let keep = is_language_tag(language);
            if !keep {
                dropped.push(format!(
                    "{place}.phrases.{language}: not a lowercase language tag such as `de`"
                ));
            }
            keep
        });
        for (language, phrases) in &mut self.phrases {
            for slot in WaitLineSlot::ALL {
                let Some(lines) = phrases.slot_mut(slot).as_mut() else {
                    continue;
                };
                lines.retain(|line| match line_problem(line) {
                    Some(problem) => {
                        dropped.push(format!(
                            "{place}.phrases.{language}.{}: '{line}' is ignored: {problem}",
                            slot.name()
                        ));
                        false
                    }
                    None => true,
                });
                if lines.len() > MAX_VARIANTS {
                    dropped.push(format!(
                        "{place}.phrases.{language}.{}: only the first {MAX_VARIANTS} variants are kept",
                        slot.name()
                    ));
                    lines.truncate(MAX_VARIANTS);
                }
            }
        }
        self.tools.retain(|language, _| {
            let keep = is_language_tag(language);
            if !keep {
                dropped.push(format!(
                    "{place}.tools.{language}: not a lowercase language tag such as `de`"
                ));
            }
            keep
        });
        for (language, tools) in &mut self.tools {
            for (name, slot, template) in [
                ("search", "search", &mut tools.search),
                ("items", "table", &mut tools.items),
                ("list", "table", &mut tools.list),
            ] {
                let Some(text) = template.as_deref() else {
                    continue;
                };
                if text.trim().is_empty() {
                    *template = None;
                    continue;
                }
                if let Some(problem) = template_problem(text, slot) {
                    dropped.push(format!(
                        "{place}.tools.{language}.{name}: '{text}' is ignored: {problem}"
                    ));
                    *template = None;
                }
            }
        }
        dropped.sort();
        dropped
    }

    /// Removes each line and tool template for which `problem` names one,
    /// and names each. Templates are checked with their slot left out.
    pub fn drop_lines_where(
        &mut self,
        mut problem: impl FnMut(&str, &str) -> Option<String>,
    ) -> Vec<String> {
        let mut dropped = Vec::new();
        let place = "audio_conversational.wait_lines";
        for (language, phrases) in &mut self.phrases {
            for slot in WaitLineSlot::ALL {
                let Some(lines) = phrases.slot_mut(slot).as_mut() else {
                    continue;
                };
                lines.retain(|line| match problem(language, line) {
                    Some(why) => {
                        dropped.push(format!(
                            "{place}.phrases.{language}.{}: '{line}' is ignored: {why}",
                            slot.name()
                        ));
                        false
                    }
                    None => true,
                });
            }
        }
        for (language, tools) in &mut self.tools {
            for (name, template) in [
                ("search", &mut tools.search),
                ("items", &mut tools.items),
                ("list", &mut tools.list),
            ] {
                let Some(text) = template.as_deref() else {
                    continue;
                };
                let said = text.replace("{search}", " ").replace("{table}", " ");
                if let Some(why) = problem(language, &said) {
                    dropped.push(format!(
                        "{place}.tools.{language}.{name}: '{text}' is ignored: {why}"
                    ));
                    *template = None;
                }
            }
        }
        dropped.sort();
        dropped
    }

    /// The lines and templates set for `language` (a bare tag such as
    /// `de`). A language with none says nothing: English for a French
    /// listener would be worse than silence.
    pub fn set_for(&self, language: &str) -> WaitLineSet {
        let phrases = self.phrases.get(language);
        let mut lines = Vec::new();
        for slot in WaitLineSlot::ALL {
            let set = phrases.and_then(|phrases| phrases.slot(slot));
            lines.extend(
                set.into_iter()
                    .flatten()
                    .map(|line| (slot, line.trim().to_string())),
            );
        }
        let tools = self.tools.get(language);
        let template = |text: Option<&Option<String>>| {
            text.and_then(Option::as_deref)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string)
        };
        WaitLineSet {
            lines,
            search: template(tools.map(|t| &t.search)),
            items: template(tools.map(|t| &t.items)),
            list: template(tools.map(|t| &t.list)),
        }
    }
}

const PLACE: &str = "audio_conversational.wait_lines";
const TIMINGS: &[&str] = &[
    "first_after_ms",
    "tool_after_ms",
    "still_after_ms",
    "still_quiet_ms",
    "long_after_ms",
    "still_repeat_ms",
    "still_repeat_max",
    "min_gap_ms",
    "max_per_turn",
    "taper_after_turns",
];

/// `[audio_conversational.wait_lines]` as written: a value of the wrong kind
/// keeps its default and an unknown key is left out, each with a warning, so
/// that one bad entry of a content package never stops a deployment.
fn shaped_wait_lines(written: Written) -> (WaitLinesConfig, Vec<String>) {
    let mut warnings = Vec::new();
    let mut config = WaitLinesConfig::default();
    let mut settings = written_table(PLACE, written, &mut warnings);
    match settings.remove("amount") {
        None => {}
        Some(Written::Text(text)) => match text.as_str() {
            "normal" => config.amount = WaitLinesAmount::Normal,
            "long_only" => config.amount = WaitLinesAmount::LongOnly,
            "off" => config.amount = WaitLinesAmount::Off,
            _ => warnings.push(format!(
                "{PLACE}.amount is not `normal`, `long_only` or `off`; the default is used"
            )),
        },
        Some(_) => warnings.push(format!(
            "{PLACE}.amount is not `normal`, `long_only` or `off`; the default is used"
        )),
    }
    for key in TIMINGS {
        let Some(value) = settings.remove(*key) else {
            continue;
        };
        let slot = match *key {
            "first_after_ms" => &mut config.first_after_ms,
            "tool_after_ms" => &mut config.tool_after_ms,
            "still_after_ms" => &mut config.still_after_ms,
            "still_quiet_ms" => &mut config.still_quiet_ms,
            "long_after_ms" => &mut config.long_after_ms,
            "still_repeat_ms" => &mut config.still_repeat_ms,
            "still_repeat_max" => &mut config.still_repeat_max,
            "min_gap_ms" => &mut config.min_gap_ms,
            "max_per_turn" => &mut config.max_per_turn,
            _ => &mut config.taper_after_turns,
        };
        match value {
            Written::Number(number) if u32::try_from(number).is_ok() => {
                *slot = u32::try_from(number).unwrap_or(*slot);
            }
            _ => warnings.push(format!(
                "{PLACE}.{key} is not a whole number; the default is used"
            )),
        }
    }
    match settings.remove("user_choice") {
        None => {}
        Some(Written::Flag(flag)) => config.user_choice = flag,
        Some(_) => warnings.push(format!(
            "{PLACE}.user_choice is not `true` or `false`; the default is used"
        )),
    }
    if let Some(languages) = settings.remove("phrases") {
        let place = format!("{PLACE}.phrases");
        for (language, slots) in written_table(&place, languages, &mut warnings) {
            let place = format!("{place}.{language}");
            let mut slots = written_table(&place, slots, &mut warnings);
            let mut phrases = WaitLinePhrasesConfig::default();
            for slot in WaitLineSlot::ALL {
                let Some(value) = slots.remove(slot.name()) else {
                    continue;
                };
                let place = format!("{place}.{}", slot.name());
                let lines = match value {
                    Written::List(items) => items
                        .into_iter()
                        .filter_map(|item| match item {
                            Written::Text(text) => Some(text),
                            _ => {
                                warnings.push(format!(
                                    "{place}: an entry is not a text and is ignored"
                                ));
                                None
                            }
                        })
                        .collect(),
                    _ => {
                        warnings.push(format!("{place} is not a list of lines and is ignored"));
                        continue;
                    }
                };
                *phrases.slot_mut(slot) = Some(lines);
            }
            let mut unknown: Vec<String> = slots.into_keys().collect();
            unknown.sort();
            for key in unknown {
                warnings.push(format!("{place}.{key} is not a known slot and is ignored"));
            }
            config.phrases.insert(language, phrases);
        }
    }
    if let Some(languages) = settings.remove("tools") {
        let place = format!("{PLACE}.tools");
        for (language, templates) in written_table(&place, languages, &mut warnings) {
            let place = format!("{place}.{language}");
            let mut templates = written_table(&place, templates, &mut warnings);
            let mut tools = WaitLineToolsConfig::default();
            for (name, target) in [
                ("search", &mut tools.search),
                ("items", &mut tools.items),
                ("list", &mut tools.list),
            ] {
                match templates.remove(name) {
                    None => {}
                    Some(Written::Text(text)) => *target = Some(text),
                    Some(_) => {
                        warnings.push(format!("{place}.{name} is not a text and is ignored"))
                    }
                }
            }
            let mut unknown: Vec<String> = templates.into_keys().collect();
            unknown.sort();
            for key in unknown {
                warnings.push(format!(
                    "{place}.{key} is not a known template and is ignored"
                ));
            }
            config.tools.insert(language, tools);
        }
    }
    let mut unknown: Vec<String> = settings.into_keys().collect();
    unknown.sort();
    for key in unknown {
        warnings.push(format!(
            "{PLACE}.{key} is not known to this Erato version and is ignored"
        ));
    }
    warnings.sort();
    (config, warnings)
}

/// Reads `[audio_conversational.wait_lines]` keeping the default for every
/// value of the wrong kind; [`misshaped_wait_lines`] names them.
pub fn deserialize_wait_lines<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Box<WaitLinesConfig>, D::Error> {
    Ok(Box::new(
        shaped_wait_lines(Written::deserialize(deserializer)?).0,
    ))
}

/// What the loader replaced or left out of `[audio_conversational.wait_lines]`
/// for its kind or name, sorted.
pub fn misshaped_wait_lines(schema: &Config) -> Vec<String> {
    schema
        .get::<Written>(PLACE)
        .map(|written| shaped_wait_lines(written).1)
        .unwrap_or_default()
}

impl WaitLinePhrasesConfig {
    fn slot(&self, slot: WaitLineSlot) -> Option<&Vec<String>> {
        match slot {
            WaitLineSlot::Opener => self.opener.as_ref(),
            WaitLineSlot::OpenerShort => self.opener_short.as_ref(),
            WaitLineSlot::Still => self.still.as_ref(),
            WaitLineSlot::Long => self.long.as_ref(),
        }
    }

    fn slot_mut(&mut self, slot: WaitLineSlot) -> &mut Option<Vec<String>> {
        match slot {
            WaitLineSlot::Opener => &mut self.opener,
            WaitLineSlot::OpenerShort => &mut self.opener_short,
            WaitLineSlot::Still => &mut self.still,
            WaitLineSlot::Long => &mut self.long,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn german() -> WaitLinesConfig {
        WaitLinesConfig {
            phrases: HashMap::from([(
                "de".to_string(),
                WaitLinePhrasesConfig {
                    opener: Some(vec!["Einen Moment.".into(), "Moment, bitte.".into()]),
                    still: Some(vec![]),
                    ..Default::default()
                },
            )]),
            tools: HashMap::from([(
                "de".to_string(),
                WaitLineToolsConfig {
                    list: Some("Ich sehe mir die {table} an.".into()),
                    items: Some(" ".into()),
                    ..Default::default()
                },
            )]),
            ..Default::default()
        }
    }

    #[test]
    fn without_lines_nothing_is_said() {
        let set = WaitLinesConfig::default().set_for("de");
        assert_eq!(set, WaitLineSet::default());
        assert_eq!(german().set_for("en"), WaitLineSet::default());
    }

    #[test]
    fn only_the_slots_and_templates_set_are_said() {
        let set = german().set_for("de");
        assert_eq!(
            set.lines,
            [
                (WaitLineSlot::Opener, "Einen Moment.".to_string()),
                (WaitLineSlot::Opener, "Moment, bitte.".to_string()),
            ]
        );
        assert_eq!(set.list.as_deref(), Some("Ich sehe mir die {table} an."));
        assert_eq!(set.items, None);
        assert_eq!(set.search, None);
    }

    #[test]
    fn unusable_lines_and_templates_are_dropped_with_a_reason() {
        let mut config = WaitLinesConfig {
            phrases: HashMap::from([
                (
                    "de".to_string(),
                    WaitLinePhrasesConfig {
                        opener: Some(vec![
                            "Einen Moment.".into(),
                            "Darf ich kurz nachsehen?".into(),
                            " ".into(),
                            "Moment {name}.".into(),
                        ]),
                        ..Default::default()
                    },
                ),
                ("DE".to_string(), WaitLinePhrasesConfig::default()),
            ]),
            tools: HashMap::from([(
                "en".to_string(),
                WaitLineToolsConfig {
                    search: Some("Looking.".into()),
                    items: Some(String::new()),
                    list: Some("Checking {table} and {table}.".into()),
                },
            )]),
            ..Default::default()
        };
        let dropped = config.drop_unusable();
        assert_eq!(dropped.len(), 6, "{dropped:?}");
        assert!(dropped.iter().any(|d| d.contains("asks a question")));
        assert_eq!(
            config.phrases["de"].opener.as_deref(),
            Some(&["Einen Moment.".to_string()][..])
        );
        assert_eq!(config.set_for("en"), WaitLineSet::default());
    }

    fn shaped(value: serde_json::Value) -> (WaitLinesConfig, Vec<String>) {
        shaped_wait_lines(Written::deserialize(value).unwrap())
    }

    #[test]
    fn a_wrong_kind_or_an_unknown_key_warns_instead_of_stopping() {
        let (config, warnings) = shaped(serde_json::json!({
            "amount": "loud",
            "first_after_ms": "3000",
            "oppener": ["Moment."],
            "still_repeat_ms": 0,
            "phrases": {
                "de": {
                    "opener": "Einen Moment.",
                    "still": ["Ich bin noch dran.", 7],
                    "oppener": ["Moment."]
                }
            },
            "tools": { "de": { "list": 3, "lists": "x" } }
        }));
        assert_eq!(config.amount, WaitLinesAmount::Normal);
        assert_eq!(config.first_after_ms, 3000);
        assert_eq!(config.still_repeat_ms, 0);
        let de = &config.phrases["de"];
        assert_eq!(de.opener, None);
        assert_eq!(
            de.still.as_deref(),
            Some(&["Ich bin noch dran.".to_string()][..])
        );
        assert_eq!(config.tools["de"].list, None);
        for expected in [
            "wait_lines.amount",
            "wait_lines.first_after_ms",
            "wait_lines.oppener",
            "phrases.de.opener is not a list",
            "phrases.de.still: an entry",
            "phrases.de.oppener",
            "tools.de.list is not a text",
            "tools.de.lists",
        ] {
            assert!(
                warnings.iter().any(|warning| warning.contains(expected)),
                "{expected}: {warnings:?}"
            );
        }
        assert_eq!(warnings.len(), 8, "{warnings:?}");
    }

    #[test]
    fn a_well_formed_block_reads_as_written() {
        let (config, warnings) = shaped(serde_json::json!({
            "amount": "long_only",
            "max_per_turn": 2,
            "user_choice": false,
            "phrases": { "en": { "long": ["This is taking a while."] } },
            "tools": { "en": { "search": "Searching for {search}." } }
        }));
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(config.amount, WaitLinesAmount::LongOnly);
        assert_eq!(config.max_per_turn, 2);
        assert!(!config.user_choice);
        assert_eq!(config.set_for("en").lines.len(), 1);
        assert_eq!(
            config.set_for("en").search.as_deref(),
            Some("Searching for {search}.")
        );
    }

    #[test]
    fn a_timing_out_of_range_falls_back_to_its_default() {
        let mut config = WaitLinesConfig {
            first_after_ms: 200,
            max_per_turn: 9,
            still_repeat_ms: 5000,
            still_repeat_max: 99,
            ..Default::default()
        };
        let warnings = config.fall_back_out_of_range();
        assert_eq!(warnings.len(), 4, "{warnings:?}");
        assert_eq!(config.still_repeat_max, 3);
        assert_eq!(config.still_repeat_ms, 18_000);
        assert_eq!(config.first_after_ms, 3000);
        assert_eq!(config.max_per_turn, 3);
    }
}
