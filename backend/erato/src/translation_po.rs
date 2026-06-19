use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const EXPLICIT_ID_FLAG: &str = "js-lingui-explicit-id";
const UNIT_SEPARATOR: char = '\u{1f}';

#[derive(Debug, Default)]
pub struct TranslationPoCache {
    entries: Mutex<HashMap<PathBuf, Vec<u8>>>,
}

impl TranslationPoCache {
    pub fn compile_messages_json(&self, po_path: &Path) -> io::Result<Vec<u8>> {
        let po_path = po_path.canonicalize()?;
        if let Some(cached) = self
            .entries
            .lock()
            .expect("translation po cache should not be poisoned")
            .get(&po_path)
            .cloned()
        {
            return Ok(cached);
        }

        let po_contents = fs::read_to_string(&po_path)?;
        let compiled = compile_po_catalog_to_json(&po_contents).map_err(|err| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("failed to compile {}: {err}", po_path.display()),
            )
        })?;

        self.entries
            .lock()
            .expect("translation po cache should not be poisoned")
            .insert(po_path, compiled.clone());
        Ok(compiled)
    }
}

fn compile_po_catalog_to_json(po_contents: &str) -> Result<Vec<u8>, String> {
    let entries = parse_po_catalog(po_contents)?;
    let mut messages = Map::new();

    for entry in entries {
        if entry.msgid.is_empty() || entry.obsolete {
            continue;
        }

        let is_explicit_id = entry
            .extracted_comments
            .iter()
            .any(|comment| comment == EXPLICIT_ID_FLAG);
        let id = if is_explicit_id {
            entry.msgid.clone()
        } else {
            generate_message_id(&entry.msgid, entry.msgctxt.as_deref())
        };
        let message = if entry.msgstr.is_empty() {
            entry.msgid.as_str()
        } else {
            entry.msgstr.as_str()
        };

        messages.insert(id, compile_message(message)?);
    }

    serde_json::to_vec(&json!({ "messages": messages })).map_err(|err| err.to_string())
}

fn generate_message_id(msg: &str, context: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(msg.as_bytes());
    hasher.update(UNIT_SEPARATOR.to_string().as_bytes());
    hasher.update(context.unwrap_or_default().as_bytes());
    let hash = BASE64_STANDARD.encode(hasher.finalize());
    hash.chars().take(6).collect()
}

#[derive(Debug, Default)]
struct PoEntry {
    extracted_comments: Vec<String>,
    msgctxt: Option<String>,
    msgid: String,
    msgstr: String,
    obsolete: bool,
}

#[derive(Debug, Clone, Copy)]
enum PoField {
    Msgctxt,
    Msgid,
    Msgstr,
}

fn parse_po_catalog(contents: &str) -> Result<Vec<PoEntry>, String> {
    let mut entries = Vec::new();
    let mut current = PoEntry::default();
    let mut field = None;
    let mut has_message = false;

    for line in contents.lines() {
        let trimmed = line.trim_start();

        if trimmed.is_empty() {
            finish_po_entry(&mut entries, &mut current, &mut has_message);
            field = None;
            continue;
        }

        if let Some(comment) = trimmed.strip_prefix("#. ") {
            current.extracted_comments.push(comment.to_string());
            continue;
        }

        if trimmed.starts_with("#~") {
            current.obsolete = true;
            continue;
        }

        if trimmed.starts_with('#') {
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("msgctxt") {
            current.msgctxt = Some(parse_po_quoted(value.trim())?);
            field = Some(PoField::Msgctxt);
            has_message = true;
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("msgid") {
            if has_message {
                finish_po_entry(&mut entries, &mut current, &mut has_message);
            }
            current.msgid = parse_po_quoted(value.trim())?;
            field = Some(PoField::Msgid);
            has_message = true;
            continue;
        }

        if let Some(value) = trimmed
            .strip_prefix("msgstr[0]")
            .or_else(|| trimmed.strip_prefix("msgstr"))
        {
            current.msgstr = parse_po_quoted(value.trim())?;
            field = Some(PoField::Msgstr);
            has_message = true;
            continue;
        }

        if trimmed.starts_with('"') {
            let value = parse_po_quoted(trimmed)?;
            match field {
                Some(PoField::Msgctxt) => current
                    .msgctxt
                    .get_or_insert_with(String::new)
                    .push_str(&value),
                Some(PoField::Msgid) => current.msgid.push_str(&value),
                Some(PoField::Msgstr) => current.msgstr.push_str(&value),
                None => return Err(format!("unexpected PO string continuation: {trimmed}")),
            }
            continue;
        }
    }

    finish_po_entry(&mut entries, &mut current, &mut has_message);
    Ok(entries)
}

fn finish_po_entry(entries: &mut Vec<PoEntry>, current: &mut PoEntry, has_message: &mut bool) {
    if *has_message {
        entries.push(std::mem::take(current));
        *has_message = false;
    } else {
        current.extracted_comments.clear();
        current.obsolete = false;
    }
}

fn parse_po_quoted(input: &str) -> Result<String, String> {
    let input = input.trim();
    if !input.starts_with('"') {
        return Err(format!("expected quoted PO string, got: {input}"));
    }

    let mut output = String::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '"' {
            if ch.is_whitespace() {
                continue;
            }
            return Err(format!("unexpected character before PO string: {ch}"));
        }

        loop {
            let Some(ch) = chars.next() else {
                return Err("unterminated PO string".to_string());
            };
            match ch {
                '"' => break,
                '\\' => {
                    let escaped = chars
                        .next()
                        .ok_or_else(|| "unterminated PO escape".to_string())?;
                    match escaped {
                        'n' => output.push('\n'),
                        'r' => output.push('\r'),
                        't' => output.push('\t'),
                        '"' => output.push('"'),
                        '\\' => output.push('\\'),
                        other => output.push(other),
                    }
                }
                other => output.push(other),
            }
        }
    }

    Ok(output)
}

fn compile_message(message: &str) -> Result<Value, String> {
    let mut parser = MessageParser::new(message);
    let tokens = parser.parse_tokens(None)?;
    Ok(Value::Array(tokens))
}

struct MessageParser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> MessageParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn parse_tokens(&mut self, end: Option<char>) -> Result<Vec<Value>, String> {
        let mut tokens = Vec::new();
        let mut text_start = self.pos;

        while let Some(ch) = self.peek_char() {
            if Some(ch) == end {
                break;
            }

            match ch {
                '{' => {
                    self.push_text(&mut tokens, text_start);
                    self.bump_char();
                    tokens.push(self.parse_placeholder()?);
                    text_start = self.pos;
                }
                '}' if end.is_none() => {
                    return Err("unexpected closing brace in message".to_string());
                }
                '#' => {
                    self.push_text(&mut tokens, text_start);
                    self.bump_char();
                    tokens.push(Value::String("#".to_string()));
                    text_start = self.pos;
                }
                _ => {
                    self.bump_char();
                }
            }
        }

        self.push_text(&mut tokens, text_start);
        Ok(tokens)
    }

    fn parse_placeholder(&mut self) -> Result<Value, String> {
        self.skip_whitespace();
        let arg = self.read_until(&[',', '}']).trim().to_string();
        if arg.is_empty() {
            return Err("empty ICU argument".to_string());
        }

        match self.peek_char() {
            Some('}') => {
                self.bump_char();
                Ok(json!([arg]))
            }
            Some(',') => {
                self.bump_char();
                self.skip_whitespace();
                let format = self.read_until(&[',', '}']).trim().to_string();
                match self.peek_char() {
                    Some('}') => {
                        self.bump_char();
                        Ok(json!([arg, format]))
                    }
                    Some(',') => {
                        self.bump_char();
                        if matches!(format.as_str(), "plural" | "select" | "selectordinal") {
                            self.parse_format_cases(arg, format)
                        } else {
                            let param = self.read_until(&['}']).trim().to_string();
                            self.expect_char('}')?;
                            Ok(json!([arg, format, param]))
                        }
                    }
                    _ => Err("unterminated ICU argument".to_string()),
                }
            }
            _ => Err("unterminated ICU argument".to_string()),
        }
    }

    fn parse_format_cases(&mut self, arg: String, format: String) -> Result<Value, String> {
        let mut cases = Map::new();

        loop {
            self.skip_whitespace();
            if self.peek_char() == Some('}') {
                self.bump_char();
                break;
            }

            if self.input[self.pos..].starts_with("offset:") {
                self.pos += "offset:".len();
                self.skip_whitespace();
                let offset = self.read_case_key();
                if !offset.is_empty() {
                    cases.insert(
                        "offset".to_string(),
                        json!(offset.parse::<i64>().unwrap_or(0)),
                    );
                }
                continue;
            }

            let raw_key = self.read_case_key();
            if raw_key.is_empty() {
                return Err("empty ICU case key".to_string());
            }
            let key = raw_key.strip_prefix('=').unwrap_or(&raw_key).to_string();
            self.skip_whitespace();
            self.expect_char('{')?;
            let tokens = self.parse_tokens(Some('}'))?;
            self.expect_char('}')?;
            cases.insert(key, Value::Array(tokens));
        }

        Ok(json!([arg, format, cases]))
    }

    fn read_case_key(&mut self) -> String {
        let start = self.pos;
        while let Some(ch) = self.peek_char() {
            if ch.is_whitespace() || ch == '{' || ch == '}' {
                break;
            }
            self.bump_char();
        }
        self.input[start..self.pos].to_string()
    }

    fn read_until(&mut self, chars: &[char]) -> &'a str {
        let start = self.pos;
        while let Some(ch) = self.peek_char() {
            if chars.contains(&ch) {
                break;
            }
            self.bump_char();
        }
        &self.input[start..self.pos]
    }

    fn push_text(&self, tokens: &mut Vec<Value>, start: usize) {
        if start < self.pos {
            tokens.push(Value::String(self.input[start..self.pos].to_string()));
        }
    }

    fn expect_char(&mut self, expected: char) -> Result<(), String> {
        match self.peek_char() {
            Some(ch) if ch == expected => {
                self.bump_char();
                Ok(())
            }
            Some(ch) => Err(format!("expected `{expected}`, got `{ch}`")),
            None => Err(format!("expected `{expected}`, got end of message")),
        }
    }

    fn skip_whitespace(&mut self) {
        while self.peek_char().is_some_and(char::is_whitespace) {
            self.bump_char();
        }
    }

    fn peek_char(&self) -> Option<char> {
        self.input[self.pos..].chars().next()
    }

    fn bump_char(&mut self) -> Option<char> {
        let ch = self.peek_char()?;
        self.pos += ch.len_utf8();
        Some(ch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_lingui_message_ids() {
        assert_eq!(
            generate_message_id("Shared Chat - {effectiveSharedChatTitle}", None),
            "gNNfb4"
        );
    }

    #[test]
    fn compiles_variable_messages() {
        assert_eq!(
            compile_message("Audio file: {filename} · Status: {status}").unwrap(),
            json!(["Audio file: ", ["filename"], " · Status: ", ["status"]])
        );
    }

    #[test]
    fn compiles_plural_messages() {
        assert_eq!(
            compile_message("{0, plural, =0 {No files} one {# file} other {# files}}").unwrap(),
            json!([[
                "0",
                "plural",
                {
                    "0": ["No files"],
                    "one": ["#", " file"],
                    "other": ["#", " files"]
                }
            ]])
        );
    }

    #[test]
    fn compiles_po_catalog_to_lingui_json() {
        let po = r#"
#. js-lingui-explicit-id
msgid "about.title"
msgstr "About"

#: src/pages/SharedChatPage.tsx
msgid "Shared Chat - {effectiveSharedChatTitle}"
msgstr ""
"#;
        let compiled = compile_po_catalog_to_json(po).unwrap();
        let value: Value = serde_json::from_slice(&compiled).unwrap();
        assert_eq!(value["messages"]["about.title"], json!(["About"]));
        assert_eq!(
            value["messages"]["gNNfb4"],
            json!(["Shared Chat - ", ["effectiveSharedChatTitle"]])
        );
    }

    #[test]
    fn compiles_current_frontend_catalog_examples() {
        let compiled = compile_po_catalog_to_json(include_str!(
            "../../../frontend/src/locales/de/messages.po"
        ))
        .unwrap();
        let value: Value = serde_json::from_slice(&compiled).unwrap();

        assert_eq!(value["messages"]["about.title"], json!(["Über uns"]));
        assert_eq!(
            value["messages"]["5FapVx"],
            json!(["Abtastrate: ", ["sampleRate"], " Hz"])
        );
        assert_eq!(
            value["messages"]["rvEDpN"],
            json!([[
                "0",
                "plural",
                {
                    "0": ["Keine Dateien"],
                    "one": ["#", " Datei"],
                    "other": ["#", " Dateien"]
                }
            ]])
        );
    }
}
