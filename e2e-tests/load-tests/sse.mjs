// Incremental SSE parsing shared by the direct diagnostic and its tests.
export async function readChatStream(body, onEvent) {
  let buffer = "";
  const decoder = new TextDecoder();
  let ended = false;
  let completed = false;
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue; // keepalive
      const event = JSON.parse(data);
      onEvent(event);
      if (event.message_type === "error")
        throw new Error(`SSE error: ${JSON.stringify(event)}`);
      if (event.message_type === "assistant_message_completed")
        completed = true;
      if (event.message_type === "stream_end") {
        ended = true;
        if (!completed)
          throw new Error("SSE ended without assistant completion");
        return; // Do not wait for the HTTP keepalive connection to close.
      }
    }
  }
  if (!ended || !completed)
    throw new Error("SSE closed without assistant completion and stream_end");
}
