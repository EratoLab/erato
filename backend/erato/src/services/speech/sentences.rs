/// Incremental sentence assembly. Keep the last token until its boundary is known.
#[derive(Default)]
pub struct Sentences {
    pending: String,
}
impl Sentences {
    pub fn push(&mut self, text: &str) -> Vec<String> {
        self.pending.push_str(text);
        let mut result = Vec::new();
        loop {
            let mut end = None;
            let mut fenced = false;
            for (i, ch) in self.pending.char_indices() {
                if (i == 0 || self.pending.as_bytes()[i - 1] == b'\n')
                    && (self.pending[i..].starts_with("```")
                        || self.pending[i..].starts_with("~~~"))
                {
                    fenced = !fenced;
                }
                if fenced {
                    continue;
                }
                if !matches!(ch, '.' | '!' | '?' | '\n' | '。' | '！' | '？') {
                    continue;
                }
                let after = i + ch.len_utf8();
                let rest = &self.pending[after..];
                if rest.is_empty() {
                    break;
                }
                if ch == '.' {
                    let token = self.pending[..i].split_whitespace().last().unwrap_or("");
                    if ["Mr", "Mrs", "Ms", "Dr", "Prof", "St", "vs", "e.g", "i.e"].contains(&token)
                        || token.chars().count() == 1
                        || rest.starts_with(|c: char| c.is_ascii_digit())
                    {
                        continue;
                    }
                }
                if rest.starts_with(char::is_whitespace) || matches!(ch, '。' | '！' | '？') {
                    end = Some(after);
                    break;
                }
            }
            // Bound a pathological unpunctuated sentence below provider input limits.
            if end.is_none() && !fenced && self.pending.chars().count() > 2000 {
                end = self
                    .pending
                    .char_indices()
                    .take(2000)
                    .filter(|(_, c)| c.is_whitespace())
                    .map(|(i, c)| i + c.len_utf8())
                    .last()
                    .or_else(|| self.pending.char_indices().nth(2000).map(|(i, _)| i));
            }
            let Some(end) = end else {
                break;
            };
            let sentence: String = self.pending.drain(..end).collect();
            if !sentence.trim().is_empty() {
                result.push(sentence);
            }
        }
        result
    }
    pub fn finish(&mut self) -> Option<String> {
        let text = std::mem::take(&mut self.pending);
        (!text.trim().is_empty()).then_some(text)
    }
}

/// Speak visible prose and inline code; omit code blocks, HTML and image descriptions.
pub fn speakable(markdown: &str) -> String {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};
    let mut suppressed = 0;
    let mut text = String::new();
    for event in Parser::new(markdown) {
        match event {
            Event::Start(Tag::CodeBlock(_) | Tag::Image { .. }) => suppressed += 1,
            Event::End(TagEnd::CodeBlock | TagEnd::Image) => suppressed -= 1,
            Event::Text(t) | Event::Code(t) if suppressed == 0 => text.push_str(&t),
            Event::SoftBreak | Event::HardBreak if suppressed == 0 => text.push(' '),
            Event::End(TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::Item)
                if suppressed == 0 =>
            {
                text.push(' ')
            }
            _ => {}
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_unicode_input_is_bounded_without_losing_text() {
        let input = "文".repeat(4500);
        let mut s = Sentences::default();
        let mut segments = s.push(&input);
        segments.extend(s.finish());
        assert!(segments.iter().all(|part| part.chars().count() <= 2000));
        assert_eq!(segments.concat(), input);
    }
    #[test]
    fn speaks_visible_prose_but_omits_code_and_images() {
        assert_eq!(speakable("Hello [world](https://example.com).\n\n```rs\nlet secret = 1;\n```\n\n![image](x.png)").trim(), "Hello world.");
    }
    #[test]
    fn boundaries_and_tail_preserve_text() {
        let mut s = Sentences::default();
        assert!(s.push("Dr. Smith paid 3.").is_empty());
        let mut out = s.push("14 euros. Next");
        out.extend(s.push(" sentence! Tail"));
        out.extend(s.finish());
        assert_eq!(
            out,
            ["Dr. Smith paid 3.14 euros.", " Next sentence!", " Tail"]
        );
    }
}
