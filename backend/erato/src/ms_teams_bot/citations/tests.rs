use super::*;

const FILE: &str = "d8d87f60-f27a-4fd9-8a9a-31d6deea74bf";

fn sources() -> Vec<FileSource> {
    vec![FileSource {
        id: FILE.into(),
        name: "Annual report.pdf".into(),
    }]
}

#[test]
fn file_links_become_native_citations_with_stable_locations_and_no_signed_urls() {
    let input = format!(
        "See [the report](erato-file://{FILE}#page=3). Again [3](erato-file://{FILE}#page=3); [other page](erato-file://{FILE}#page=4)."
    );
    let (text, citations) = render(&input, &sources(), Some("https://erato.example/app/"));
    assert_eq!(text, "See the report [1]. Again [1]; other page [2].");
    assert_eq!(citations.len(), 2);
    assert_eq!(citations[0].appearance["name"], "Annual report.pdf");
    assert_eq!(citations[0].appearance["abstract"], "Page 3");
    assert_eq!(
        citations[0].appearance["url"],
        format!("https://erato.example/app/api/v1beta/files/{FILE}/preview#page=3")
    );
}

#[test]
fn footnotes_reference_links_and_bare_uris_work_without_citing_code_or_images() {
    let input = format!(
        "Claim[^source]. [Report][file]. erato-file://{FILE}\n\n[^source]: [Report](erato-file://{FILE})\n\n[file]: erato-file://{FILE}\n\n`[example](erato-file://{FILE})`\n\n```text\nerato-file://{FILE}\n```\n\n![image](erato-file://{FILE})"
    );
    let (text, citations) = render(&input, &sources(), None);
    assert!(text.starts_with("Claim[1]. Report [1]. [1]"), "{text}");
    assert!(!text.contains("[^source]"), "{text}");
    assert!(text.contains(&format!("`[example](erato-file://{FILE})`")));
    assert!(text.contains(&format!("```text\nerato-file://{FILE}\n```")));
    assert!(text.contains(&format!("![image](erato-file://{FILE})")));
    assert_eq!(citations.len(), 1);
    assert!(citations[0].appearance.get("url").is_none());
}

#[test]
fn unresolved_files_do_not_get_source_metadata_and_external_links_are_untouched() {
    let input = "[Private](erato-file://00000000-0000-0000-0000-000000000001) and [Web](https://example.com)";
    let (text, citations) = render(input, &sources(), Some("https://erato.example"));
    assert_eq!(text, "Private and [Web](https://example.com)");
    assert!(citations.is_empty());
    assert!(referenced_file_ids("`erato-file://secret` ![x](erato-file://secret)").is_empty());
}

#[test]
fn existing_number_markers_are_not_reinterpreted_as_file_citations() {
    let (text, citations) = render(
        &format!("Original [1]. [Report](erato-file://{FILE})."),
        &sources(),
        None,
    );
    assert_eq!(text, "Original [1]. Report [2].");
    assert_eq!(citations[0].position, 2);
}

#[test]
fn more_than_twenty_sources_keep_clickable_links_and_bounded_titles() {
    let files: Vec<_> = (0..21)
        .map(|i| FileSource {
            id: format!("00000000-0000-0000-0000-{i:012}"),
            name: "界".repeat(100),
        })
        .collect();
    let input = files
        .iter()
        .map(|file| format!("[Source](erato-file://{})", file.id))
        .collect::<Vec<_>>()
        .join("\n");
    let (text, citations) = render(&input, &files, Some("https://erato.example"));
    assert_eq!(citations.len(), 20);
    assert!(text.ends_with("[Source](<https://erato.example/api/v1beta/files/00000000-0000-0000-0000-000000000020/preview>)"));
    assert_eq!(
        citations[0].appearance["name"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        80
    );
}

#[test]
fn citation_entities_preserve_mentions_and_stream_metadata_and_are_chunk_local() {
    let (text, citations) = render(&format!("[Report](erato-file://{FILE})"), &sources(), None);
    let mut activity = render::message(
        &text,
        Some(&Mention {
            id: "29:alice".into(),
            name: "Alice".into(),
        }),
    );
    activity["entities"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type": "streaminfo", "streamType": "final"}));
    attach(&mut activity, &citations);
    assert_eq!(activity["entities"][0]["type"], "mention");
    assert_eq!(activity["entities"][1]["type"], "streaminfo");
    assert_eq!(activity["entities"][2]["citation"][0]["position"], 1);
    let mut plain = render::message("Other chunk", None);
    attach(&mut plain, &citations);
    assert!(plain.get("entities").is_none());
}

#[test]
fn unicode_answers_split_within_serialized_budget_without_losing_markers() {
    let (text, citations) = render(
        &format!(
            "{} [Report](erato-file://{FILE}) {}",
            "界\\".repeat(9_000),
            "界".repeat(9_000)
        ),
        &sources(),
        Some("https://erato.example"),
    );
    let chunks = split(&text, &citations, None);
    assert!(chunks.len() > 2);
    assert_eq!(
        chunks.iter().filter(|chunk| chunk.contains("[1]")).count(),
        1
    );
    for chunk in chunks {
        let mut activity = render::message(&chunk, None);
        attach(&mut activity, &citations);
        assert!(serde_json::to_vec(&activity).unwrap().len() <= MAX_ACTIVITY_BYTES);
    }
}

#[test]
fn details_use_authenticated_links_and_invalid_navigation_bases_are_omitted() {
    let input = format!("Checked [Report](erato-file://{FILE}#page=2).");
    assert_eq!(
        details(&input, &sources(), Some("https://erato.example")),
        format!(
            "Checked [Report](<https://erato.example/api/v1beta/files/{FILE}/preview#page=2>)."
        )
    );
    let (_, citations) = render(&input, &sources(), Some("javascript:alert(1)"));
    assert!(citations[0].appearance.get("url").is_none());
    let (_, citations) = render(
        &input,
        &sources(),
        Some("https://user:password@erato.example"),
    );
    assert!(citations[0].appearance.get("url").is_none());
}

#[test]
fn bare_file_urls_keep_sentence_punctuation_and_large_numeric_text_still_splits() {
    let (text, citations) = render(&format!("Source: erato-file://{FILE}."), &sources(), None);
    assert_eq!(text, "Source: [1].");
    assert_eq!(citations.len(), 1);
    let long_number = format!("[{}]", "1".repeat(30_000));
    assert_eq!(split(&long_number, &[], None).concat(), long_number);
}
