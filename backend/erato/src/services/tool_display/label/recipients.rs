//! Members of a call's arguments that say who a message, invite or share
//! reaches, or where a person is reached: an email address or a phone, mobile
//! or fax number. Compared as [`bare_member`] spells them. A value below one
//! shows as written: a name read from a result could pass an attacker's
//! address or number off as a colleague's or the helpdesk's.

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

/// `share_with`, `shareWith` and `Share-With` alike: lower case without `_`
/// and `-`, the spelling the lists hold.
pub fn bare_member(member: &str) -> String {
    member
        .chars()
        .filter(|c| !matches!(c, '_' | '-'))
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Whether `member` holds a phone, mobile, fax or pager number.
pub fn is_contact_number_member(member: &str) -> bool {
    let bare = bare_member(member);
    let stem = bare.trim_end_matches(|c: char| c.is_ascii_digit());
    CONTACT_NUMBER_ENDINGS
        .iter()
        .any(|ending| stem.ends_with(ending))
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
        ] {
            assert!(is_contact_number_member(member), "{member}");
            assert!(is_recipient_member(member), "{member}");
        }
    }

    #[test]
    fn other_members_are_not_recipients() {
        for member in [
            "phonecallid",
            "phonecall",
            "activityid",
            "number",
            "ordernumber",
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
