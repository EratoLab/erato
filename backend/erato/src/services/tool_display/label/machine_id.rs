//! Which values are machine identifiers: a UUID or a long opaque token that
//! nobody can read, compare or do anything with. The one place that decides,
//! for every card and row; the raw arguments in Technical details keep them.
//! Identifiers people work with are never machine IDs: issue numbers, ticket
//! keys, SKUs, file names and paths, email addresses and phone numbers.

use super::arguments::looks_like_a_uuid;

/// A hex or base64-like token shorter than this is still something a person
/// can read and compare, as a short commit hash is.
const MIN_OPAQUE_CHARS: usize = 16;
/// Past this nothing is an identifier, only a long value.
const MAX_ID_CHARS: usize = 512;
/// A run of letters of one case or of digits this short on average, over the
/// whole token, is noise and not words; camelCase words run longer.
const MAX_MEAN_RUN_TENTHS: usize = 25;
/// The most digits a phone number has, E.164's limit: a digit-only value
/// longer than this is no phone number.
const MAX_PHONE_DIGITS: usize = 15;
/// The shape of workspace-issued short IDs: one capital, then capitals and
/// digits mixed, 9 to 12 characters in all.
const SHORT_ID_CHARS: std::ops::RangeInclusive<usize> = 9..=12;
const MIN_SHORT_ID_RUNS: usize = 4;
const MIN_SHORT_ID_DIGITS: usize = 2;
const MIN_JWT_SEGMENT_CHARS: usize = 10;

/// Whether `text` is a machine identifier, read as one token: surrounding
/// white space aside, anything with a space, an `@` or a scheme is not.
pub fn is_machine_id(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty()
        || text.len() > MAX_ID_CHARS
        || text.chars().any(char::is_whitespace)
        || text.contains('@')
        || text.contains("://")
    {
        return false;
    }
    looks_like_a_uuid(text)
        || is_long_digits(text)
        || is_hex_token(text)
        || is_short_mixed_id(text)
        || is_jwt_like(text)
        || is_opaque_token(text)
}

fn is_long_digits(text: &str) -> bool {
    text.len() > MAX_PHONE_DIGITS && text.bytes().all(|byte| byte.is_ascii_digit())
}

/// Letters and digits mixed all through, so an account number that opens with
/// two letters and runs on in digits stays readable.
fn is_hex_token(text: &str) -> bool {
    text.len() >= MIN_OPAQUE_CHARS
        && text.bytes().all(|byte| byte.is_ascii_hexdigit())
        && text.bytes().any(|byte| byte.is_ascii_digit())
        && text.bytes().any(|byte| byte.is_ascii_alphabetic())
        && runs(text) >= MIN_SHORT_ID_RUNS
}

fn is_short_mixed_id(text: &str) -> bool {
    let mut chars = text.chars();
    SHORT_ID_CHARS.contains(&text.len())
        && chars.next().is_some_and(|first| first.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && text.bytes().filter(u8::is_ascii_digit).count() >= MIN_SHORT_ID_DIGITS
        && runs(text) >= MIN_SHORT_ID_RUNS
}

fn is_jwt_like(text: &str) -> bool {
    let segments: Vec<&str> = text.split('.').collect();
    segments.len() == 3
        && segments.iter().all(|segment| {
            segment.len() >= MIN_JWT_SEGMENT_CHARS && segment.bytes().all(is_base64_byte)
        })
}

/// Base64-like and noisy: a token whose runs of one character class are too
/// short to be words, measured within the parts its separators leave.
fn is_opaque_token(text: &str) -> bool {
    if text.len() < MIN_OPAQUE_CHARS || !text.bytes().all(is_base64_byte) {
        return false;
    }
    let letters = text.bytes().filter(u8::is_ascii_alphanumeric).count();
    let run_count: usize = text.split(['_', '-', '+', '/', '=']).map(runs).sum();
    run_count > 0 && letters * 10 <= run_count * MAX_MEAN_RUN_TENTHS
}

fn is_base64_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'+' | b'/' | b'=')
}

/// How many runs of one class (lower case, upper case, digit) `text` has.
fn runs(text: &str) -> usize {
    #[derive(PartialEq, Clone, Copy)]
    enum Class {
        Lower,
        Upper,
        Digit,
    }
    let mut count = 0;
    let mut previous = None;
    for byte in text.bytes() {
        let class = if byte.is_ascii_digit() {
            Class::Digit
        } else if byte.is_ascii_uppercase() {
            Class::Upper
        } else if byte.is_ascii_lowercase() {
            Class::Lower
        } else {
            continue;
        };
        if previous != Some(class) {
            count += 1;
        }
        previous = Some(class);
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuids_and_long_opaque_tokens_are_machine_ids() {
        for id in [
            "aaaaaaaa-0000-4000-8000-0000000000a1",
            "AAAAAAAA-0000-4000-8000-0000000000A1",
            "{aaaaaaaa-0000-4000-8000-0000000000a1}",
            "9b1d5f2e3c4a4f88a1b20c1d2e3f4a5b",
            "507f1f77bcf86cd799439011",
            "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
            "pi_3MtwBwLkdIwHu7ix28a3tqPa",
            "cus_NffrFeUfNV2Hib",
            "C024BE91L",
            "U012AB3CD",
            "1234567890123456789",
            "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
        ] {
            assert!(is_machine_id(id), "{id}");
        }
    }

    #[test]
    fn identifiers_people_recognise_are_not_machine_ids() {
        for text in [
            "#4211",
            "4211",
            "INC-0012345",
            "ABC-123",
            "SKU-0000",
            "SKU12345",
            "WIDGET0001",
            "ACME-WIDGET-BLUE-0001",
            "f_1",
            "report_2024_q3_final_version_2.pdf",
            "src/module_0.py",
            "/srv/app/some_long_directory_name",
            "ana@contoso.example",
            "+49 170 1234567",
            "+4917012345678",
            "491701234567890",
            "DE44500105175407324931",
            "3e26caa46",
            "main",
            "customer-reported-needs-triage",
            "UserAccountSettingsPage",
            "ProductCategoryMappingTable",
            "https://example.test/9b1d5f2e3c4a4f88a1b20c1d2e3f4a5b",
            "has a space in 9b1d5f2e3c4a4f88a1b20c1d2e3f4a5b",
            "",
        ] {
            assert!(!is_machine_id(text), "{text}");
        }
    }

    #[test]
    fn surrounding_white_space_does_not_hide_a_machine_id() {
        assert!(is_machine_id("  aaaaaaaa-0000-4000-8000-0000000000a1 "));
    }

    #[test]
    fn a_huge_value_is_no_identifier() {
        assert!(!is_machine_id(&"a1b2".repeat(1000)));
    }
}
