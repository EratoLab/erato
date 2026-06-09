use std::fs;
use std::path::PathBuf;

use erato::services::file_processor::create_file_processor;
use insta::assert_snapshot;

struct ExampleFixture {
    name: &'static str,
    path: &'static str,
    mime_type: Option<&'static str>,
}

fn read_example_file(filename: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/integration_tests/test_files")
        .join(filename);

    fs::read(&path).unwrap_or_else(|_| panic!("Failed to read fixture file {:?}", path))
}

#[tokio::test]
async fn test_file_processor_examples_are_snapshotted() {
    let processor =
        create_file_processor("kreuzberg").expect("Expected to create kreuzberg file processor");

    let fixtures = [
        ExampleFixture {
            name: "Acme_Inc_Company_Overview_pptx",
            path: "Acme_Inc_Company_Overview.pptx",
            mime_type: Some(
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ),
        },
        ExampleFixture {
            name: "email_with_sample_compressed_pdf",
            path: "email-with-sample-compressed-pdf.eml",
            mime_type: Some("message/rfc822"),
        },
        ExampleFixture {
            name: "please_review_attached_draft_eml",
            path: "please_review_attached_draft.eml",
            mime_type: Some("message/rfc822"),
        },
        ExampleFixture {
            name: "re_another_doc_you_have_to_check_eml",
            path: "re_another_doc_you_have_to_check.eml",
            mime_type: Some("message/rfc822"),
        },
        ExampleFixture {
            name: "sample_report_compressed_pdf",
            path: "sample-report-compressed.pdf",
            mime_type: Some("application/pdf"),
        },
        ExampleFixture {
            name: "styled_newsletter_multipart_alternative_eml",
            path: "styled_newsletter_multipart_alternative.eml",
            mime_type: Some("message/rfc822"),
        },
        ExampleFixture {
            name: "synthesized_thread_bundle_eml",
            path: "synthesized_thread_bundle.eml",
            mime_type: Some("message/rfc822"),
        },
    ];

    for fixture in fixtures {
        let bytes = read_example_file(fixture.path);
        let extracted = processor
            .parse_file(bytes, fixture.mime_type)
            .await
            .expect("Failed to extract fixture");

        assert_snapshot!(fixture.name, extracted);
    }
}
