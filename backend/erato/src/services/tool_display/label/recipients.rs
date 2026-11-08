//! Members of a call's arguments that say who a message, invite or share
//! reaches, or where a person is reached: an email address or a phone, mobile
//! or fax number. Compared as [`bare_member`] spells them. A value below one
//! shows as written: a name read from a result could pass an attacker's
//! address or number off as a colleague's or the helpdesk's. So does a value
//! shaped like a phone number below any member ([`is_phone_shaped`]).

/// Who a message, invite or share is addressed to.
pub const RECIPIENT_MEMBERS: [&str; 15] = [
    "to",
    "torecipients",
    "recipient",
    "recipients",
    "attendee",
    "attendees",
    "requiredattendees",
    "invitee",
    "invitees",
    "guests",
    "participants",
    "sharewith",
    "sharedwith",
    "shareto",
    "sendto",
];
/// Who gets a copy.
pub const COPY_RECIPIENT_MEMBERS: [&str; 5] = [
    "cc",
    "ccrecipients",
    "bcc",
    "bccrecipients",
    "optionalattendees",
];
/// Where a person or recipient object holds its email address, as in
/// `{"email": ...}` or Graph's `{"emailAddress": {"address": ...}}`.
pub const ADDRESS_MEMBERS: [&str; 6] = [
    "email",
    "emailaddress",
    "address",
    "mail",
    "userprincipalname",
    "upn",
];
/// How a member holding a contact number ends once trailing digits are cut,
/// so `phone`, `phoneNumber`, `mobilePhone`, Graph's `businessPhones` and
/// Dataverse's `telephone1` and `address1_fax` all count.
pub const CONTACT_NUMBER_ENDINGS: [&str; 13] = [
    "phone",
    "phones",
    "phonenumber",
    "phonenumbers",
    "mobile",
    "mobilenumber",
    "cellnumber",
    "fax",
    "faxnumber",
    "sms",
    "smsnumber",
    "msisdn",
    "pager",
];
/// Who a call or message reaches, before a number word: `to_number`,
/// `recipientNumber`, `dst_no`. A bare `dst` counts too.
pub const RECIPIENT_NUMBER_WORDS: [&str; 8] = [
    "to",
    "recipient",
    "dest",
    "destination",
    "target",
    "dst",
    "receiver",
    "callee",
];
pub const NUMBER_WORDS: [&str; 4] = ["number", "numbers", "num", "no"];
/// Digits in a phone number: a short local one up to E.164's longest.
const PHONE_DIGITS: std::ops::RangeInclusive<usize> = 7..=15;

/// `share_with`, `shareWith` and `Share-With` alike: lower case without `_`
/// and `-`, the spelling the lists hold.
pub fn bare_member(member: &str) -> String {
    member
        .chars()
        .filter(|c| !matches!(c, '_' | '-'))
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Whether `member` holds a phone, mobile, fax or pager number, or the
/// number a call or message goes to (`to_number`, `dst`).
pub fn is_contact_number_member(member: &str) -> bool {
    let bare = bare_member(member);
    let stem = bare.trim_end_matches(|c: char| c.is_ascii_digit());
    // Whole names only: `autonumber` ends in `tonumber`.
    let to_a_number = stem == "dst"
        || RECIPIENT_NUMBER_WORDS
            .iter()
            .filter_map(|word| stem.strip_prefix(word))
            .any(|rest| NUMBER_WORDS.contains(&rest));
    to_a_number
        || CONTACT_NUMBER_ENDINGS
            .iter()
            .any(|ending| stem.ends_with(ending))
}

/// Digits and phone punctuation only (`+49 170 1234567`, `(030) 1234567`,
/// `0170/1234567`, `+1-555-0100`): 7 to 15 digits and at least one other
/// character. A digit-only value is left to the caller. Read as NFKC, with
/// any dash and digits of any script, so full-width forms count too.
pub fn is_phone_shaped(value: &str) -> bool {
    use unicode_normalization::UnicodeNormalization;
    let mut digits = 0usize;
    let mut punctuation = false;
    for c in value.nfkc() {
        if c.is_numeric() {
            digits += 1;
            if digits > *PHONE_DIGITS.end() {
                return false;
            }
        } else if matches!(
            c,
            '+' | '-' | '.' | '(' | ')' | '/' | '\u{2010}'..='\u{2015}' | '\u{2212}'
        ) || c.is_whitespace()
        {
            punctuation = true;
        } else {
            return false;
        }
    }
    punctuation && PHONE_DIGITS.contains(&digits)
}

/// Whether `member` names recipients or holds an address or contact number.
pub fn is_recipient_member(member: &str) -> bool {
    let bare = bare_member(member);
    [
        RECIPIENT_MEMBERS.as_slice(),
        &COPY_RECIPIENT_MEMBERS,
        &ADDRESS_MEMBERS,
    ]
    .iter()
    .any(|members| members.contains(&bare.as_str()))
        || is_contact_number_member(member)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contact_number_members_count_as_recipients_in_any_spelling() {
        for member in [
            "phone",
            "Phone",
            "phones",
            "phone_number",
            "phoneNumber",
            "Phone-Number",
            "phoneNumbers",
            "telephone",
            "telephone1",
            "telephone3",
            "telephoneNumber",
            "address1_telephone2",
            "mobile",
            "mobilePhone",
            "mobile_number",
            "cellPhone",
            "cell_number",
            "homePhones",
            "businessPhones",
            "assistantphone",
            "fax",
            "faxNumber",
            "address2_fax",
            "sms",
            "smsNumber",
            "msisdn",
            "pager",
            "to_number",
            "toNumber",
            "To-Number",
            "recipient_number",
            "recipientNumber",
            "dest_number",
            "destination_number",
            "destinationNumber",
            "target_number",
            "targetNum",
            "dst",
            "DST",
            "dst_number",
            "dst_no",
            "receiver_number",
            "callee_number",
            "calleeNumbers",
            "to_number2",
        ] {
            assert!(is_contact_number_member(member), "{member}");
            assert!(is_recipient_member(member), "{member}");
        }
    }

    #[test]
    fn phone_shaped_values_are_digits_with_phone_punctuation() {
        for value in [
            "+49 170 1234567",
            "+1-555-0100",
            "(030) 1234567",
            "(030)1234567",
            "0170/1234567",
            "+49.170.1234567",
            "+49 (0) 170 123 45 67",
            "555-0100",
            "2026-11-08",
            "1.250.000",
            "+1\u{2011}555\u{2011}0100",
            "\u{FF0B}\u{FF14}\u{FF19}\u{FF0D}170\u{FF0D}1234567",
            "+123456789012345",
            // NFKC leaves Arabic-Indic and Devanagari digits as they are.
            "+\u{0664}\u{0669}-\u{0661}\u{0667}\u{0660}-\u{0661}\u{0662}\u{0663}\u{0664}\u{0665}\u{0666}\u{0667}",
            "(\u{0966}\u{0969}\u{0966}) \u{0967}\u{0968}\u{0969}\u{096A}\u{096B}\u{096C}\u{096D}",
        ] {
            assert!(is_phone_shaped(value), "{value}");
        }
        for value in [
            "4917012345678",
            "\u{0664}\u{0669}\u{0661}\u{0667}\u{0660}\u{0661}\u{0662}\u{0663}\u{0664}\u{0665}\u{0666}\u{0667}",
            "+12345",
            "555-010",
            "+1234567890123456",
            "+49 170 1234567 ext",
            "+49-170-1234567x",
            "INC-0012345",
            "fld_1",
            "5f0c2a10-0000-4000-8000-00000000a001",
            "12345678-1234-1234-1234-123456789012",
            "+-./() ",
            "",
        ] {
            assert!(!is_phone_shaped(value), "{value}");
        }
    }

    #[test]
    fn other_members_are_not_recipients() {
        for member in [
            "phonecallid",
            "phonecall",
            "activityid",
            "number",
            "Number",
            "numbers",
            "ordernumber",
            "order_no",
            "autonumber",
            "new_autonumber",
            "accountnumber",
            "target",
            "destination",
            "receiver",
            "callee",
            "isdst",
            "dstoffset",
            "targetid",
            "destination_id",
            "telephonecount",
            "faxed",
            "smsid",
            "mobileapp",
            "from",
            "subject",
            "regarding",
            "",
            "123",
        ] {
            assert!(!is_contact_number_member(member), "{member}");
            assert!(!is_recipient_member(member), "{member}");
        }
    }

    #[test]
    fn every_listed_member_counts_in_its_written_spellings() {
        for member in RECIPIENT_MEMBERS
            .iter()
            .chain(&COPY_RECIPIENT_MEMBERS)
            .chain(&ADDRESS_MEMBERS)
        {
            assert!(is_recipient_member(member), "{member}");
            assert!(is_recipient_member(&member.to_uppercase()), "{member}");
        }
        for member in ["Share-With", "share_with", "emailAddress", "BCC_Recipients"] {
            assert!(is_recipient_member(member), "{member}");
        }
        assert!(!is_contact_number_member("email"));
    }
}
