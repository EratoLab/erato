//! Short-lived URLs exist only while sending the resource activity.
use super::{
    cards, citations,
    host::{CompletionFiles, Host, Session},
    render,
    streaming::{ReplyTarget, StreamingReply},
    texts::Msg,
};
use crate::db::entity::file_uploads;
use crate::services::file_storage::{FileStorage, SharepointContext};
use eyre::{OptionExt, Result, ensure};
use futures::TryStreamExt;
use image::{AnimationDecoder, ImageFormat, ImageReader};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    time::Duration,
};

const URL_LIFETIME: Duration = Duration::from_secs(86_400);
const MAX_IMAGE_BYTES: u64 = 1_000_000;

fn inline_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return None;
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let format = reader.format()?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Gif | ImageFormat::Jpeg
    ) {
        return None;
    }
    let (width, height) = reader.into_dimensions().ok()?;
    if width == 0 || height == 0 || width > 1024 || height > 1024 {
        return None;
    }
    match format {
        ImageFormat::Png => Some("image/png"),
        ImageFormat::Jpeg => Some("image/jpeg"),
        ImageFormat::Gif => {
            let mut frames = image::codecs::gif::GifDecoder::new(Cursor::new(bytes))
                .ok()?
                .into_frames();
            frames.next()?.ok()?;
            frames.next().is_none().then_some("image/gif")
        }
        _ => None,
    }
}

fn open_action(title: &str, url: &str) -> Value {
    render::card_message(
        cards::adaptive_card(
            vec![],
            vec![json!({"type":"Action.OpenUrl","title":title,"url":url})],
        ),
        title,
    )
}

async fn copy_object(
    source: &FileStorage,
    path: &str,
    destination: &FileStorage,
    key: &str,
    mime: Option<&str>,
) -> Result<()> {
    let mut chunks = source
        .get_file_reader(path)
        .await?
        .into_bytes_stream(..)
        .await?;
    let mut writer = destination.upload_file_writer(key, mime).await?;
    let result = async {
        while let Some(chunk) = chunks.try_next().await? {
            writer.write(chunk).await?;
        }
        writer.close().await?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = writer.abort().await;
    }
    result
}

async fn activity(
    host: &Host,
    session: &Session,
    file: &file_uploads::Model,
    target: &ReplyTarget<'_>,
) -> Result<Value> {
    let state = &host.app_state;
    let providers = &state.file_storage_providers;
    let mut storage = providers
        .get(&file.file_storage_provider_id)
        .ok_or_eyre("Missing source provider")?;
    let mut path = file.file_storage_path.clone();
    let context = session
        .access_token()
        .map(|access_token| SharepointContext { access_token });
    let (mime, url) = if storage.is_sharepoint() {
        let metadata = storage
            .get_sharepoint_file_metadata_with_context(&path, context.as_ref())
            .await?;
        ensure!(
            url::Url::parse(&metadata.download_url)?.scheme() == "https",
            "Teams delivery requires HTTPS"
        );
        let mime = if metadata
            .size_bytes
            .is_some_and(|size| size <= MAX_IMAGE_BYTES)
            && metadata
                .content_type
                .as_deref()
                .is_some_and(|mime| mime.starts_with("image/"))
        {
            let response = target
                .connector
                .http()
                .get(&metadata.download_url)
                .send()
                .await?;
            let bytes = super::connector::read_limited(
                response.error_for_status()?,
                MAX_IMAGE_BYTES as usize,
            )
            .await?;
            inline_type(&bytes)
        } else {
            None
        };
        (mime, metadata.download_url)
    } else {
        let metadata = storage.stat_object(&path).await?;
        if let Some(id) = &state
            .config
            .integrations
            .ms_office
            .teams
            .bot
            .delivery_storage_provider_id
            && id != &file.file_storage_provider_id
        {
            let destination = providers.get(id).ok_or_eyre("Missing delivery provider")?;
            let key = format!("teams-delivery/{}", file.id);
            copy_object(
                storage,
                &path,
                destination,
                &key,
                metadata.content_type.as_deref(),
            )
            .await?;
            storage = destination;
            path = key;
        }
        let mime = if (1..=MAX_IMAGE_BYTES).contains(&metadata.size_bytes) {
            let reader = storage.get_file_reader(&path).await?;
            let bytes = reader.read(0..metadata.size_bytes).await?;
            inline_type(&bytes.to_bytes())
        } else {
            None
        };
        let url = signed_url(storage, &path, &file.filename, mime.is_some()).await?;
        (mime, url)
    };
    ensure!(
        url::Url::parse(&url)?.scheme() == "https",
        "Teams delivery requires HTTPS"
    );
    Ok(match mime {
        Some(mime) => {
            json!({"type":"message","attachments":[{"contentType":mime,"name":file.filename,"contentUrl":url}]})
        }
        None => open_action(
            &Msg::DownloadFile.fill(target.lang, &[("file", &file.filename)]),
            &url,
        ),
    })
}

async fn signed_url(
    storage: &FileStorage,
    path: &str,
    filename: &str,
    preview: bool,
) -> Result<String> {
    if preview {
        storage
            .generate_presigned_preview_url(path, Some(URL_LIFETIME), Some(filename))
            .await
    } else {
        storage
            .generate_presigned_download_url(path, Some(URL_LIFETIME), Some(filename))
            .await
    }
}

fn push_text(body: &mut Vec<Value>, text: &str) {
    if !text.trim().is_empty() {
        body.push(json!({"type":"TextBlock","text":text.trim(),"wrap":true}));
    }
}

fn illustrated_answer(
    text: &str,
    earlier: &str,
    sources: &[citations::FileSource],
    images: &HashMap<String, &Value>,
    target: &ReplyTarget<'_>,
    base: Option<&str>,
) -> Option<(Value, HashSet<String>)> {
    if images.is_empty() {
        return None;
    }
    let mut body = Vec::new();
    let mut placed = HashSet::new();
    let (tail, _) = citations::render_with_limit(
        text,
        sources,
        base,
        0,
        target.lang,
        |file, alt, preceding| {
            let Some(attachment) = images.get(&file.id) else {
                return false;
            };
            if !placed.insert(file.id.clone()) {
                return false;
            }
            push_text(&mut body, preceding);
            preceding.clear();
            body.push(json!({"type":"Image","url":attachment["contentUrl"],"altText":if alt.is_empty() { &file.name } else { alt },"size":"Auto"}));
            true
        },
    );
    if placed.is_empty() {
        return None;
    }
    push_text(&mut body, &tail);
    let earlier = citations::details(earlier, sources, base, target.lang);
    let (extra_text, details) = render::answer_with_details("", &earlier, target.lang);
    push_text(&mut body, &extra_text);
    let mut card = cards::adaptive_card(body, vec![]);
    if let Some(details) = details {
        card["content"]["actions"] = details["content"]["actions"].clone();
    }
    if let Some(mention) = &target.mention {
        let message = render::message("", Some(mention));
        card["content"]["body"].as_array_mut()?.insert(
            0,
            json!({"type":"TextBlock","text":message["text"],"wrap":true}),
        );
        card["content"]["msteams"] = json!({"entities":message["entities"]});
    }
    let summary = card["content"]["body"]
        .as_array()?
        .iter()
        .filter_map(|b| b["text"].as_str().or(b["altText"].as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    let activity = render::card_message(card, &render::bounded_text(&summary, 200));
    render::card_fits(&activity).then_some((activity, placed))
}

/// Render the final answer and deliver each authorized output exactly once. Only
/// Markdown image references have a position in the answer; other outputs follow it.
#[allow(clippy::too_many_arguments)]
pub(super) async fn finish(
    host: &Host,
    session: Option<&Session>,
    target: &ReplyTarget<'_>,
    stream: &mut StreamingReply<'_>,
    files: &CompletionFiles,
    text: &str,
    earlier: &str,
    base: Option<&str>,
) -> Result<()> {
    let Some(session) = session else {
        return stream
            .finish_with_sources(text, earlier, &files.sources, base)
            .await;
    };
    let mut prepared = HashMap::new();
    if !files.outputs.is_empty() {
        let referenced = citations::image_ids(text);
        for file in &files.outputs {
            if referenced.contains(&file.id) {
                prepared.insert(file.id, activity(host, session, file, target).await.ok());
            }
        }
    }
    let images = prepared
        .iter()
        .filter_map(|(id, activity)| {
            let attachment = activity.as_ref()?["attachments"].get(0)?;
            attachment["contentType"]
                .as_str()?
                .starts_with("image/")
                .then(|| (id.to_string(), attachment))
        })
        .collect();
    let mut placed = HashSet::new();
    if let Some((card, ids)) =
        illustrated_answer(text, earlier, &files.sources, &images, target, base)
        && stream.finish_card(&card).await
    {
        placed = ids;
    } else {
        stream
            .finish_with_sources(text, earlier, &files.sources, base)
            .await?;
    }
    if stream.is_cancelled() {
        return Ok(());
    }
    for file in &files.outputs {
        if placed.contains(&file.id.to_string()) {
            continue;
        }
        let outgoing = match prepared.remove(&file.id) {
            Some(prepared) => prepared,
            None => activity(host, session, file, target).await.ok(),
        };
        if let Some(activity) = outgoing
            && target.send(&activity).await.is_ok()
        {
            continue;
        }
        tracing::warn!(file_id = %file.id, "Could not deliver Teams file");
        if let Some(url) = citations::source_url(base, &file.id.to_string(), None) {
            let title = Msg::OpenFile.fill(target.lang, &[("file", &file.filename)]);
            let _ = target.send(&open_action(&title, &url)).await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn s3_download_and_preview_request_one_day() {
        let config = serde_json::from_value(json!({"provider_kind":"s3","config":{
            "endpoint":"https://storage.example","bucket":"files","region":"us-east-1",
            "access_key_id":"fixture","secret_access_key":"fixture"
        }}))
        .unwrap();
        let storage = FileStorage::from_config(&config).unwrap();
        for preview in [false, true] {
            let url = signed_url(&storage, "objects/id", "chart.png", preview)
                .await
                .unwrap();
            let url = url::Url::parse(&url).unwrap();
            assert!(url.path().ends_with("/objects/id"));
            assert!(
                url.query_pairs()
                    .any(|(k, v)| k.eq_ignore_ascii_case("x-amz-expires") && v == "86400")
            );
            let disposition = url
                .query_pairs()
                .find(|(k, _)| k == "response-content-disposition")
                .unwrap()
                .1;
            assert!(disposition.contains("chart.png"));
            assert!(disposition.starts_with(if preview { "inline" } else { "attachment" }));
        }
    }

    #[test]
    fn images_must_fit_teams_limits() {
        let mut wide = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1025, 1)
            .write_to(&mut wide, ImageFormat::Png)
            .unwrap();
        assert_eq!(inline_type(wide.get_ref()), None);
        let mut large = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(32, 24)
            .write_to(&mut large, ImageFormat::Jpeg)
            .unwrap();
        assert_eq!(inline_type(large.get_ref()), Some("image/jpeg"));
        large.get_mut().resize(MAX_IMAGE_BYTES as usize + 1, 0);
        assert_eq!(inline_type(large.get_ref()), None);
        let mut gif = Vec::new();
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
        let frame = image::Frame::new(image::RgbaImage::new(2, 2));
        encoder
            .encode_frames([frame.clone(), frame].into_iter())
            .unwrap();
        drop(encoder);
        assert_eq!(inline_type(&gif), None);
    }
}
