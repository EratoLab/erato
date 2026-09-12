import assert from "node:assert/strict";
import test from "node:test";
import { readChatStream } from "./sse.mjs";
async function* chunks(text) {
  // Split inside CRLFs, JSON and UTF-8 multibyte characters.
  for (const byte of new TextEncoder().encode(text)) yield Uint8Array.of(byte);
}
test("accepts fragmented SSE and records the full stream", async () => {
  const events = [];
  await readChatStream(
    chunks(
      ': keepalive\r\n\r\ndata: {"message_type":"text_delta","text":"ä"}\r\n\r\ndata: {"message_type":"assistant_message_completed"}\n\ndata: {"message_type":"stream_end"}\n\n',
    ),
    (e) => events.push(e),
  );
  assert.equal(events[0].text, "ä");
  assert.equal(events.length, 3);
});
test("reports structured errors before completion", async () => {
  await assert.rejects(
    readChatStream(
      chunks('data: {"message_type":"error","error_type":"rate_limit"}\n\n'),
      () => {},
    ),
    /rate_limit/,
  );
});
test("rejects truncated or failed streams instead of counting a completed chat", async () => {
  await assert.rejects(
    readChatStream(chunks('data: {"message_type":"text_delta"}\n\n'), () => {}),
    /without assistant completion/,
  );
});
