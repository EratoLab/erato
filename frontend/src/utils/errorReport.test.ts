import { describe, expect, it } from "vitest";

import {
  FrontendRequestError,
  renderFrontendErrorReport,
  sanitizeHeaders,
} from "./errorReport";

describe("frontend error reports", () => {
  it("renders frontend diagnostics into the configured backend template", () => {
    const error = new Error("Rendering failed");
    error.stack =
      "Error: Rendering failed\n    at ChatPanel (ChatPanel.tsx:42:5)";

    const report = renderFrontendErrorReport(error, {
      template:
        "env={{environment}} time={{timestamp}} chat={{chat_id}} platform={{platform}}\n{{error}}",
      environment: "test",
      chatId: "chat-123",
      platform: "common",
      timestamp: new Date("2026-07-13T10:00:00.000Z"),
      componentStack: "at ChatPanel (ChatPanel.tsx:21:3)",
    });

    expect(report).toContain(
      "env=test time=2026-07-13T10:00:00.000Z chat=chat-123 platform=common",
    );
    expect(report).toContain("at ChatPanel (ChatPanel.tsx:42:5)");
    expect(report).toContain("Component stack:");
  });

  it("includes request and response context", () => {
    const error = new FrontendRequestError(
      "SSE request failed",
      {
        method: "POST",
        url: "/api/messages/submitstream",
        headers: { "x-erato-platform": "office-addin" },
        body: '{"message":"hello","existing_chat_id":"chat-123","assistant_id":"assistant-456","selected_facet_ids":["search","mail"]}',
      },
      {
        status: 400,
        statusText: "Bad Request",
        body: "invalid message",
      },
    );

    const report = renderFrontendErrorReport(error, {
      template:
        "chat={{chat_id}} assistant={{assistant_id}} platform={{platform}} facets={{facets_active}}\n{{error}}",
    });

    expect(report).toContain(
      "chat=chat-123 assistant=assistant-456 platform=office-addin facets=mail, search",
    );
    expect(report).toContain("Method: POST");
    expect(report).toContain("URL: /api/messages/submitstream");
    expect(report).toContain('"message": "hello"');
    expect(report).toContain("Status: 400 Bad Request");
    expect(report).toContain("invalid message");
  });

  it("redacts sensitive request headers", () => {
    expect(
      sanitizeHeaders({
        Authorization: "Bearer secret",
        Cookie: "session=secret",
        "X-Erato-Platform": "common",
      }),
    ).toEqual({
      authorization: "<redacted>",
      cookie: "<redacted>",
      "x-erato-platform": "common",
    });
  });
});
