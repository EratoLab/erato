use std::io::{BufReader, Cursor};
use std::sync::Arc;

use async_trait::async_trait;
use eyre::{Context, Report};
use ical::{IcalParser, VcardParser, parser::Component, property::Property};
use kreuzberg::plugins::{DocumentExtractor, Plugin};
use kreuzberg::types::internal::InternalDocument;

use super::{PLAIN_TEXT_MIME_TYPE, normalize_mime_type};

// --- Calendar and vCard extractor wiring -----------------------------------

const CALENDAR_VCARD_EXTRACTOR_NAME: &str = "calendar-vcard-extractor";

pub(crate) fn register_calendar_vcard_extractor() -> Result<(), Report> {
    kreuzberg::plugins::register_document_extractor(Arc::new(CalendarVcardExtractor))
        .wrap_err("failed to register calendar/vcard extractor")
}

#[derive(Default)]
struct CalendarVcardExtractor;

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl DocumentExtractor for CalendarVcardExtractor {
    async fn extract_bytes(
        &self,
        content: &[u8],
        mime_type: &str,
        _config: &kreuzberg::ExtractionConfig,
    ) -> kreuzberg::Result<InternalDocument> {
        let normalized_mime = normalize_mime_type(mime_type);
        if normalized_mime != PLAIN_TEXT_MIME_TYPE {
            return Err(kreuzberg::KreuzbergError::UnsupportedFormat(
                mime_type.to_string(),
            ));
        }

        let markdown = if let Ok(raw_text) = std::str::from_utf8(content) {
            if raw_text.contains("BEGIN:VCALENDAR") {
                let summary = render_calendar_summary(content);
                if !summary.trim().is_empty() {
                    summary
                } else {
                    String::new()
                }
            } else if raw_text.contains("BEGIN:VCARD") {
                let summary = render_vcard_summary(content);
                if !summary.trim().is_empty() {
                    summary
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        if !markdown.trim().is_empty() {
            let mut doc = InternalDocument::new("calendar-vcard");
            doc.mime_type = normalized_mime;
            doc.metadata.output_format = Some("markdown".to_string());
            doc.pre_rendered_content = Some(markdown);
            return Ok(doc);
        }

        // Fallback to plain-text extraction when this isn't calendar/vCard data.
        Ok(plain_text_document(content, mime_type))
    }

    fn supported_mime_types(&self) -> &[&str] {
        &[PLAIN_TEXT_MIME_TYPE]
    }

    fn priority(&self) -> i32 {
        90
    }
}

impl Plugin for CalendarVcardExtractor {
    fn name(&self) -> &str {
        CALENDAR_VCARD_EXTRACTOR_NAME
    }

    fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    fn initialize(&self) -> kreuzberg::Result<()> {
        Ok(())
    }

    fn shutdown(&self) -> kreuzberg::Result<()> {
        Ok(())
    }
}

fn plain_text_document(content: &[u8], mime_type: &str) -> InternalDocument {
    let text = String::from_utf8_lossy(content).into_owned();
    let text = text
        .trim_end_matches('\n')
        .trim_end_matches('\r')
        .to_string();

    let mut doc = InternalDocument::new("text");
    doc.mime_type = mime_type.to_string();
    doc.metadata.output_format = Some("markdown".to_string());
    if !text.is_empty() {
        doc.pre_rendered_content = Some(text);
    }
    doc
}

/// Unescape RFC 5545 / RFC 6350 TEXT escaping: `\n`/`\N` -> newline, `\,` -> `,`,
/// `\;` -> `;`, `\\` -> `\`. Other backslash sequences keep the following char.
fn unescape_ics_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => out.push('\n'),
            Some(',') => out.push(','),
            Some(';') => out.push(';'),
            Some('\\') => out.push('\\'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

fn property_param<'a>(
    params: &'a Option<Vec<(String, Vec<String>)>>,
    key: &str,
) -> Option<&'a str> {
    params.as_ref().and_then(|params| {
        params.iter().find_map(|(name, values)| {
            if !name.eq_ignore_ascii_case(key) {
                return None;
            }

            values.first().map(String::as_str)
        })
    })
}

fn normalized_contact_name(property_name: &str) -> &str {
    property_name.rsplit('.').next().unwrap_or(property_name)
}

fn render_property_value(value: &str) -> String {
    unescape_ics_text(value)
}

fn format_person(property: &Property) -> String {
    let value = property.value.clone().unwrap_or_default();
    let address = value
        .trim()
        .strip_prefix("mailto:")
        .or_else(|| value.trim().strip_prefix("MAILTO:"))
        .unwrap_or_else(|| value.trim());
    match property_param(&property.params, "CN") {
        Some(cn) if !cn.is_empty() && !address.is_empty() => format!("{cn} <{address}>"),
        Some(cn) if !cn.is_empty() => cn.to_string(),
        _ => address.to_string(),
    }
}

#[derive(Default)]
struct CalendarEventSummary {
    summary: Option<String>,
    dtstart: Option<String>,
    dtend: Option<String>,
    duration: Option<String>,
    location: Option<String>,
    organizer: Option<String>,
    attendees: Vec<String>,
    description: Option<String>,
    rrule: Option<String>,
    status: Option<String>,
}

impl CalendarEventSummary {
    fn render(&self) -> Option<String> {
        let mut lines = Vec::new();
        if let Some(summary) = &self.summary {
            lines.push(format!("Summary: {summary}"));
        }
        if let Some(dtstart) = &self.dtstart {
            lines.push(format!("Start: {dtstart}"));
        }
        if let Some(dtend) = &self.dtend {
            lines.push(format!("End: {dtend}"));
        }
        if let Some(duration) = &self.duration {
            lines.push(format!("Duration: {duration}"));
        }
        if let Some(location) = &self.location {
            lines.push(format!("Location: {location}"));
        }
        if let Some(organizer) = &self.organizer {
            lines.push(format!("Organizer: {organizer}"));
        }
        if !self.attendees.is_empty() {
            lines.push(format!("Attendees: {}", self.attendees.join(", ")));
        }
        if let Some(rrule) = &self.rrule {
            lines.push(format!("Recurrence: {rrule}"));
        }
        if let Some(status) = &self.status {
            lines.push(format!("Status: {status}"));
        }
        if let Some(description) = &self.description {
            lines.push(format!("Description: {description}"));
        }
        if lines.is_empty() {
            None
        } else {
            Some(lines.join("\n"))
        }
    }
}

#[derive(Default)]
struct ContactSummary {
    full_name: Option<String>,
    structured_name: Option<String>,
    organization: Option<String>,
    title: Option<String>,
    emails: Vec<String>,
    phones: Vec<String>,
    address: Option<String>,
    url: Option<String>,
    note: Option<String>,
}

impl ContactSummary {
    fn render(&self) -> Option<String> {
        let mut out = Vec::new();
        if let Some(name) = self.full_name.as_ref().or(self.structured_name.as_ref()) {
            out.push(format!("Name: {name}"));
        }
        if let Some(organization) = &self.organization {
            out.push(format!("Organization: {organization}"));
        }
        if let Some(title) = &self.title {
            out.push(format!("Title: {title}"));
        }
        if !self.emails.is_empty() {
            out.push(format!("Email: {}", self.emails.join(", ")));
        }
        if !self.phones.is_empty() {
            out.push(format!("Phone: {}", self.phones.join(", ")));
        }
        if let Some(address) = &self.address {
            out.push(format!("Address: {address}"));
        }
        if let Some(url) = &self.url {
            out.push(format!("URL: {url}"));
        }
        if let Some(note) = &self.note {
            out.push(format!("Note: {note}"));
        }

        if out.is_empty() {
            None
        } else {
            Some(out.join("\n"))
        }
    }
}

fn summarize_calendar_component(properties: &[Property]) -> Option<String> {
    let mut summary = CalendarEventSummary::default();

    for property in properties {
        match property.name.as_str() {
            "SUMMARY" => summary.summary = property.value.as_deref().map(render_property_value),
            "DTSTART" => summary.dtstart = property.value.as_deref().map(render_property_value),
            "DTEND" => summary.dtend = property.value.as_deref().map(render_property_value),
            "DURATION" => summary.duration = property.value.as_deref().map(str::to_string),
            "LOCATION" => summary.location = property.value.as_deref().map(render_property_value),
            "ORGANIZER" => summary.organizer = Some(format_person(property)),
            "ATTENDEE" => {
                let person = format_person(property);
                if !person.is_empty() {
                    summary.attendees.push(person);
                }
            }
            "DESCRIPTION" => {
                summary.description = property.value.as_deref().map(render_property_value)
            }
            "RRULE" => summary.rrule = property.value.as_deref().map(str::to_string),
            "STATUS" => summary.status = property.value.as_deref().map(str::to_uppercase),
            _ => {}
        }
    }

    summary.render()
}

fn summarize_vcard_properties(properties: &[Property]) -> Option<String> {
    let mut summary = ContactSummary::default();

    for property in properties {
        let property_name = normalized_contact_name(&property.name);
        let Some(value) = property.value.as_deref() else {
            continue;
        };

        match property_name {
            "FN" => summary.full_name = Some(render_property_value(value)),
            "N" if summary.structured_name.is_none() => {
                let parts: Vec<String> = value
                    .split(';')
                    .map(|part| render_property_value(part.trim()))
                    .collect();
                let family = parts.first().map(String::as_str).unwrap_or("");
                let given = parts.get(1).map(String::as_str).unwrap_or("");
                let assembled = format!("{given} {family}").trim().to_string();
                if !assembled.is_empty() {
                    summary.structured_name = Some(assembled);
                }
            }
            "ORG" => {
                let value = render_property_value(value).replace(';', ", ");
                let value = value.trim_end_matches(", ").trim().to_string();
                if !value.is_empty() {
                    summary.organization = Some(value);
                }
            }
            "TITLE" => summary.title = Some(render_property_value(value)),
            "EMAIL" => {
                let value = render_property_value(value);
                if !value.is_empty() {
                    summary.emails.push(value);
                }
            }
            "TEL" => {
                let value = render_property_value(value);
                let value = value.strip_prefix("tel:").unwrap_or(&value);
                if !value.is_empty() {
                    summary.phones.push(value.to_string());
                }
            }
            "ADR" => {
                let parts: Vec<String> = value
                    .split(';')
                    .map(|part| render_property_value(part.trim()))
                    .filter(|part| !part.is_empty())
                    .collect();
                if !parts.is_empty() {
                    summary.address = Some(parts.join(", "));
                }
            }
            "URL" => summary.url = Some(value.to_string()),
            "NOTE" => summary.note = Some(render_property_value(value)),
            _ => {}
        }
    }

    summary.render()
}

fn render_calendar_summary(content: &[u8]) -> String {
    let unfolded = unfold_ics_folding(content);
    let parser = IcalParser::new(BufReader::new(Cursor::new(unfolded)));
    let mut sections = Vec::new();
    let mut parsed = false;
    let mut has_content = false;

    for calendar_result in parser {
        let Ok(calendar) = calendar_result else {
            continue;
        };
        parsed = true;

        let method = calendar
            .get_property("METHOD")
            .and_then(|property| property.value.as_deref())
            .map(|method| method.to_ascii_uppercase());

        let mut component_blocks = Vec::new();

        for event in &calendar.events {
            if let Some(block) = summarize_calendar_component(&event.properties) {
                component_blocks.push(block);
            }
        }

        for todo in &calendar.todos {
            if let Some(block) = summarize_calendar_component(&todo.properties) {
                component_blocks.push(block);
            }
        }

        for journal in &calendar.journals {
            if let Some(block) = summarize_calendar_component(&journal.properties) {
                component_blocks.push(block);
            }
        }

        if component_blocks.is_empty() {
            continue;
        }
        has_content = true;
        let mut section = String::new();
        if let Some(method) = method {
            section.push_str(&format!("Method: {method}\n"));
        }
        section.push_str(&component_blocks.join("\n\n"));
        sections.push(format!("## Calendar event\n\n{section}"));
    }

    if parsed && !has_content {
        String::new()
    } else {
        sections.join("\n\n")
    }
}

fn render_vcard_summary(content: &[u8]) -> String {
    let unfolded = unfold_ics_folding(content);
    let parser = VcardParser::new(BufReader::new(Cursor::new(unfolded)));
    let mut sections = Vec::new();
    let mut parsed = false;
    let mut has_content = false;

    for contact_result in parser {
        let Ok(contact) = contact_result else {
            continue;
        };
        parsed = true;

        if let Some(block) = summarize_vcard_properties(&contact.properties) {
            has_content = true;
            sections.push(format!("## Contact card\n\n{block}"));
        }
    }

    if parsed && !has_content {
        String::new()
    } else {
        sections.join("\n\n")
    }
}

fn unfold_ics_folding(content: &[u8]) -> Vec<u8> {
    let mut text = String::from_utf8_lossy(content).into_owned();
    text = text.replace("\r\n\t", " ");
    text = text.replace("\r\n ", " ");
    text = text.replace("\n\t", " ");
    text = text.replace("\n ", " ");
    text.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::file_processor::{FileProcessor, KreuzbergProcessor};

    fn token_count(text: &str) -> usize {
        let bpe = tiktoken_rs::o200k_base().expect("o200k_base tokenizer");
        bpe.encode_with_special_tokens(text).len()
    }

    #[tokio::test]
    async fn test_kreuzberg_extracts_outlook_meeting_request_calendar() {
        // An Outlook-style meeting REQUEST: `multipart/alternative` with text/plain + text/html +
        // `text/calendar; method=REQUEST`, where the calendar part carries a full VTIMEZONE and a
        // VALARM (the boilerplate Outlook always emits). Modeled on the structure of a real Outlook
        // iCalendar invite (RFC 5545 VEVENT + VTIMEZONE + VALARM). The readable invite details must
        // surface; the timezone/alarm/PRODID boilerplate must NOT; the output must be small.
        let eml = "From: Organizer <organizer@example.com>\r\n\
                To: Attendee One <attendee1@example.com>\r\n\
                Subject: Project sync\r\n\
                MIME-Version: 1.0\r\n\
                Content-Type: multipart/alternative; boundary=\"INVITE\"\r\n\r\n\
                --INVITE\r\n\
                Content-Type: text/plain; charset=utf-8\r\n\r\n\
                When: June 12, 2026 10:00-10:30\r\n\r\n\
                --INVITE\r\n\
                Content-Type: text/html; charset=utf-8\r\n\r\n\
                <html><body><p>You're invited.</p></body></html>\r\n\
                --INVITE\r\n\
                Content-Type: text/calendar; method=REQUEST; charset=utf-8\r\n\
                Content-Transfer-Encoding: 7bit\r\n\r\n\
                BEGIN:VCALENDAR\r\n\
                PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN\r\n\
                VERSION:2.0\r\n\
                METHOD:REQUEST\r\n\
                BEGIN:VTIMEZONE\r\n\
                TZID:W. Europe Standard Time\r\n\
                BEGIN:STANDARD\r\n\
                DTSTART:16011028T030000\r\n\
                TZOFFSETFROM:+0200\r\n\
                TZOFFSETTO:+0100\r\n\
                END:STANDARD\r\n\
                END:VTIMEZONE\r\n\
                BEGIN:VEVENT\r\n\
                DTSTART;TZID=W. Europe Standard Time:20260612T100000\r\n\
                DTEND;TZID=W. Europe Standard Time:20260612T103000\r\n\
                DTSTAMP:20260601T120000Z\r\n\
                UID:040000008200E00074C5B7101A82E00800000000\r\n\
                SEQUENCE:0\r\n\
                ORGANIZER;CN=Organizer Name:mailto:organizer@example.com\r\n\
                ATTENDEE;CN=Attendee One;RSVP=TRUE:mailto:attendee1@example.com\r\n\
                ATTENDEE;CN=Attendee Two:mailto:attendee2@example.com\r\n\
                SUMMARY:Project sync\r\n\
                LOCATION:Conference Room B\r\n\
                DESCRIPTION:Weekly project sync to review status.\r\n\
                TRANSP:OPAQUE\r\n\
                CLASS:PUBLIC\r\n\
                X-MICROSOFT-CDO-BUSYSTATUS:BUSY\r\n\
                BEGIN:VALARM\r\n\
                TRIGGER:-PT15M\r\n\
                ACTION:DISPLAY\r\n\
                DESCRIPTION:Reminder\r\n\
                END:VALARM\r\n\
                END:VEVENT\r\n\
                END:VCALENDAR\r\n\
                --INVITE--\r\n";

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.as_bytes().to_vec(), Some("message/rfc822"))
            .await
            .expect("Outlook meeting request should extract");

        // Readable invite details surface.
        assert!(
            extracted.contains("## Calendar event"),
            "missing header:\n{extracted}"
        );
        assert!(
            extracted.contains("Method: REQUEST"),
            "missing method:\n{extracted}"
        );
        assert!(
            extracted.contains("Summary: Project sync"),
            "missing summary:\n{extracted}"
        );
        assert!(
            extracted.contains("Location: Conference Room B"),
            "missing location:\n{extracted}"
        );
        assert!(
            extracted.contains("Organizer: Organizer Name <organizer@example.com>"),
            "missing organizer:\n{extracted}"
        );
        assert!(
            extracted.contains("Attendee One <attendee1@example.com>")
                && extracted.contains("Attendee Two <attendee2@example.com>"),
            "missing attendees:\n{extracted}"
        );
        assert!(
            extracted.contains("Start: 20260612T100000"),
            "missing dtstart:\n{extracted}"
        );

        // Boilerplate must NOT leak.
        for forbidden in [
            "VTIMEZONE",
            "TZOFFSET",
            "VALARM",
            "PRODID",
            "Outlook 16.0",
            "X-MICROSOFT",
            "TRANSP",
            "040000008200E000",
        ] {
            assert!(
                !extracted.contains(forbidden),
                "boilerplate {forbidden:?} leaked into extracted content:\n{extracted}"
            );
        }

        // Output is token-light.
        let tokens = token_count(&extracted);
        assert!(
            tokens < 200,
            "invite output too large: {tokens} tokens:\n{extracted}"
        );
    }

    #[test]
    fn test_calendar_summary_surfaces_recurrence_rule() {
        // A recurring event: the RRULE recurrence line must be surfaced.
        let ics = "BEGIN:VCALENDAR\r\n\
                VERSION:2.0\r\n\
                BEGIN:VEVENT\r\n\
                SUMMARY:Weekly standup\r\n\
                DTSTART:20260601T090000Z\r\n\
                RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10\r\n\
                UID:recurring-1\r\n\
                END:VEVENT\r\n\
                END:VCALENDAR\r\n";
        let summary = render_calendar_summary(ics.as_bytes());
        assert!(!summary.is_empty(), "recurrence event should parse");
        assert!(
            summary.contains("Recurrence: FREQ=WEEKLY;BYDAY=MO;COUNT=10"),
            "recurrence rule not surfaced:\n{summary}"
        );
        assert!(!summary.contains("recurring-1"), "UID leaked:\n{summary}");
    }
    #[test]
    fn test_calendar_summary_reflects_cancellation_method() {
        // A cancellation: METHOD:CANCEL plus STATUS:CANCELLED must be reflected.
        let ics = "BEGIN:VCALENDAR\r\n\
                VERSION:2.0\r\n\
                METHOD:CANCEL\r\n\
                BEGIN:VEVENT\r\n\
                SUMMARY:Project sync\r\n\
                STATUS:CANCELLED\r\n\
                DTSTART:20260612T100000Z\r\n\
                END:VEVENT\r\n\
                END:VCALENDAR\r\n";
        let summary = render_calendar_summary(ics.as_bytes());
        assert!(!summary.is_empty(), "cancellation should parse");
        assert!(
            summary.contains("Method: CANCEL"),
            "method not reflected:\n{summary}"
        );
        assert!(
            summary.contains("Status: CANCELLED"),
            "status not reflected:\n{summary}"
        );
    }
    #[tokio::test]
    async fn test_kreuzberg_extracts_bare_ics_upload() {
        // A bare `.ics` body (mime `text/calendar`) used to error with "Unsupported format" in
        // kreuzberg. It must now extract via our route and yield the summary. Includes ICS text
        // escaping (`\,` and `\n`) which must be unescaped.
        let ics = "BEGIN:VCALENDAR\r\n\
                VERSION:2.0\r\n\
                PRODID:-//Google Inc//Google Calendar 70.9054//EN\r\n\
                BEGIN:VEVENT\r\n\
                SUMMARY:Lunch with Sam\\, then walk\r\n\
                DTSTART:20260615T120000Z\r\n\
                DTEND:20260615T130000Z\r\n\
                LOCATION:Cafe Central\r\n\
                DESCRIPTION:First line\\nSecond line\r\n\
                UID:bare-ics-1\r\n\
                END:VEVENT\r\n\
                END:VCALENDAR\r\n";

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(ics.as_bytes().to_vec(), Some("text/calendar"))
            .await
            .expect("bare .ics must extract, not error with Unsupported format");

        assert!(
            extracted.contains("## Calendar event"),
            "missing header:\n{extracted}"
        );
        assert!(
            extracted.contains("Summary: Lunch with Sam, then walk"),
            "ICS escaping not unescaped or summary missing:\n{extracted}"
        );
        assert!(
            extracted.contains("Location: Cafe Central"),
            "missing location:\n{extracted}"
        );
        assert!(
            extracted.contains("First line\nSecond line"),
            "escaped newline not unescaped:\n{extracted}"
        );
        assert!(
            !extracted.contains("bare-ics-1"),
            "UID leaked:\n{extracted}"
        );
        assert!(!extracted.contains("PRODID"), "PRODID leaked:\n{extracted}");
    }
    #[tokio::test]
    async fn test_kreuzberg_extracts_vcard_3_with_photo() {
        // A vCard 3.0 with a large base64 PHOTO. FN/ORG/EMAIL/TEL must be present; the PHOTO base64
        // sentinel must be ABSENT; output must be token-light. Modeled on RFC 6350 / Apple Contacts
        // vCard 3.0 exports.
        let mut photo = String::new();
        while photo.len() < 60_000 {
            photo.push_str("PHOTOSENTINELiVBORw0KGgoAAAANSUhEUgAAAAEAAAAB");
        }
        let raw_photo_len = photo.len();
        let vcf = format!(
            "BEGIN:VCARD\r\n\
                 VERSION:3.0\r\n\
                 N:Doe;Jane;;;\r\n\
                 FN:Jane Doe\r\n\
                 ORG:Example Corp;Engineering\r\n\
                 TITLE:Staff Engineer\r\n\
                 EMAIL;TYPE=INTERNET:jane.doe@example.com\r\n\
                 TEL;TYPE=WORK,VOICE:+1-555-0100\r\n\
                 ADR;TYPE=WORK:;;123 Main St;Springfield;CA;94000;USA\r\n\
                 URL:https://example.com/jane\r\n\
                 NOTE:Met at conference.\r\n\
                 PHOTO;ENCODING=b;TYPE=PNG:{photo}\r\n\
                 REV:20260601T120000Z\r\n\
                 UID:vcard3-uid\r\n\
                 END:VCARD\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(vcf.into_bytes(), Some("text/vcard"))
            .await
            .expect("bare vCard 3.0 must extract");

        assert!(
            extracted.contains("## Contact card"),
            "missing header:\n{extracted}"
        );
        assert!(
            extracted.contains("Name: Jane Doe"),
            "missing FN:\n{extracted}"
        );
        assert!(
            extracted.contains("Organization: Example Corp, Engineering"),
            "missing ORG:\n{extracted}"
        );
        assert!(
            extracted.contains("Title: Staff Engineer"),
            "missing TITLE:\n{extracted}"
        );
        assert!(
            extracted.contains("Email: jane.doe@example.com"),
            "missing EMAIL:\n{extracted}"
        );
        assert!(
            extracted.contains("Phone: +1-555-0100"),
            "missing TEL:\n{extracted}"
        );
        assert!(
            extracted.contains("123 Main St"),
            "missing ADR:\n{extracted}"
        );

        assert!(
            !extracted.contains("PHOTOSENTINEL"),
            "PHOTO base64 leaked into extracted content:\n{extracted}"
        );
        assert!(
            !extracted.contains("vcard3-uid"),
            "UID leaked:\n{extracted}"
        );

        let tokens = token_count(&extracted);
        assert!(
            tokens < 100,
            "vCard output too large: {tokens} tokens (raw photo {raw_photo_len} bytes):\n{extracted}"
        );
    }
    #[tokio::test]
    async fn test_kreuzberg_extracts_vcard_4_with_photo() {
        // A vCard 4.0 with a large base64 data-URI PHOTO. Same assertions: useful fields present,
        // PHOTO absent, small. Modeled on RFC 6350 vCard 4.0 (PHOTO as a `data:` URI).
        let mut photo = String::new();
        while photo.len() < 60_000 {
            photo.push_str("PHOTO4SENTINELiVBORw0KGgoAAAANSUhEUgAAAAE");
        }
        let vcf = format!(
            "BEGIN:VCARD\r\n\
                 VERSION:4.0\r\n\
                 FN:John Smith\r\n\
                 N:Smith;John;;;\r\n\
                 ORG:Acme Inc.\r\n\
                 TITLE:Director\r\n\
                 EMAIL:john.smith@acme.example\r\n\
                 TEL;VALUE=uri;TYPE=\"voice,home\":tel:+1-555-0199\r\n\
                 URL:https://acme.example\r\n\
                 PHOTO:data:image/png;base64,{photo}\r\n\
                 UID:urn:uuid:vcard4-uid\r\n\
                 END:VCARD\r\n"
        );

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(vcf.into_bytes(), Some("text/x-vcard"))
            .await
            .expect("bare vCard 4.0 must extract");

        assert!(
            extracted.contains("Name: John Smith"),
            "missing FN:\n{extracted}"
        );
        assert!(
            extracted.contains("Organization: Acme Inc."),
            "missing ORG:\n{extracted}"
        );
        assert!(
            extracted.contains("Email: john.smith@acme.example"),
            "missing EMAIL:\n{extracted}"
        );
        assert!(
            extracted.contains("Phone: +1-555-0199"),
            "missing TEL (tel: scheme not stripped?):\n{extracted}"
        );
        assert!(
            !extracted.contains("PHOTO4SENTINEL"),
            "PHOTO base64 leaked:\n{extracted}"
        );
        let tokens = token_count(&extracted);
        assert!(
            tokens < 100,
            "vCard 4.0 output too large: {tokens} tokens:\n{extracted}"
        );
    }

    #[tokio::test]
    async fn test_kreuzberg_surfaces_calendar_part_in_invite_email() {
        // End-to-end: a meeting-invite email carrying a `text/calendar` part must surface the event
        // via the supplement appended in parse_file (confirming the email-path wiring, not just the
        // bare-upload path).
        let eml = "From: Organizer <org@example.com>\r\n\
                To: Person <p@example.com>\r\n\
                Subject: Invite\r\n\
                MIME-Version: 1.0\r\n\
                Content-Type: multipart/mixed; boundary=\"MX\"\r\n\r\n\
                --MX\r\n\
                Content-Type: text/plain; charset=utf-8\r\n\r\n\
                Body text.\r\n\
                --MX\r\n\
                Content-Type: text/calendar; method=REQUEST; charset=utf-8\r\n\r\n\
                BEGIN:VCALENDAR\r\n\
                METHOD:REQUEST\r\n\
                BEGIN:VEVENT\r\n\
                SUMMARY:Quarterly review\r\n\
                DTSTART:20260701T140000Z\r\n\
                END:VEVENT\r\n\
                END:VCALENDAR\r\n\
                --MX--\r\n";

        let processor = KreuzbergProcessor;
        let extracted = processor
            .parse_file(eml.as_bytes().to_vec(), Some("message/rfc822"))
            .await
            .expect("invite email should extract");

        assert!(
            extracted.contains("## Calendar event")
                && extracted.contains("Summary: Quarterly review"),
            "calendar part not surfaced from invite email:\n{extracted}"
        );
    }

    #[test]
    fn test_calendar_summary_handles_multiple_events_and_vtodo() {
        // Multiple VEVENTs plus a minimal VTODO (SUMMARY + DESCRIPTION).
        let ics = "BEGIN:VCALENDAR\r\n\
                VERSION:2.0\r\n\
                BEGIN:VEVENT\r\n\
                SUMMARY:First event\r\n\
                END:VEVENT\r\n\
                BEGIN:VEVENT\r\n\
                SUMMARY:Second event\r\n\
                END:VEVENT\r\n\
                BEGIN:VTODO\r\n\
                SUMMARY:Buy supplies\r\n\
                DESCRIPTION:Pens and paper\r\n\
                END:VTODO\r\n\
                END:VCALENDAR\r\n";
        let summary = render_calendar_summary(ics.as_bytes());
        assert!(!summary.is_empty(), "multi-component should parse");
        assert!(
            summary.contains("Summary: First event"),
            "missing first:\n{summary}"
        );
        assert!(
            summary.contains("Summary: Second event"),
            "missing second:\n{summary}"
        );
        assert!(
            summary.contains("Summary: Buy supplies"),
            "missing vtodo:\n{summary}"
        );
        assert!(
            summary.contains("Description: Pens and paper"),
            "missing vtodo desc:\n{summary}"
        );
    }
    #[test]
    fn test_ical_parser_handles_folded_lines() {
        // RFC 5545 line folding: a CRLF followed by a space continues the line.
        let folded = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Weekly standup\r\nDESCRIPTION:Line one\r\n two\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let summary = render_calendar_summary(folded.as_bytes());

        assert!(summary.contains("Description: Line one two"));
    }
}
