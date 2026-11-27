import { describe, expect, it, vi } from "vitest";

import { isSameHostArtifact, stampHostArtifact } from "../hostArtifactStamp";

import type { HostArtifact, Message } from "@erato/frontend/library";

const message = (text: string): Message => ({
  id: "a1",
  role: "assistant",
  content: [{ content_type: "text", text }],
  createdAt: "2026-01-01T00:00:00.000Z",
});

const artifact = (overrides: Partial<HostArtifact> = {}): HostArtifact => ({
  facetId: "word_document_review",
  renderMode: "suggestions",
  messageId: "a1",
  allowedClientActions: ["word.apply_edits"],
  submittedCard: { toolCallId: "call-1", language: "plan", content: "call-1" },
  ...overrides,
});

const withArtifact = (source: Message, hostArtifact: HostArtifact) => ({
  ...source,
  hostArtifact,
});

describe("stampHostArtifact", () => {
  it("keeps the last stamp while the message and its inputs are unchanged", () => {
    const source = message("Done.");
    const info = { clientActions: ["word.apply_edits"] };
    const first = stampHostArtifact(
      undefined,
      source,
      ["facet", info],
      () => artifact(),
      withArtifact,
    );
    const build = vi.fn(() => artifact());

    const second = stampHostArtifact(
      first,
      source,
      ["facet", info],
      build,
      withArtifact,
    );

    expect(second).toBe(first);
    expect(build).not.toHaveBeenCalled();
  });

  it("keeps the stamped message when new inputs build an equal artifact", () => {
    const source = message("Done.");
    const first = stampHostArtifact(
      undefined,
      source,
      [{ clientActions: ["word.apply_edits"] }],
      () => artifact(),
      withArtifact,
    );

    const second = stampHostArtifact(
      first,
      source,
      [{ clientActions: ["word.apply_edits"] }],
      () => artifact(),
      withArtifact,
    );

    expect(second.message).toBe(first.message);
  });

  it("stamps a changed message with the last artifact when it is equal", () => {
    const first = stampHostArtifact(
      undefined,
      message("Do"),
      [],
      () => artifact(),
      withArtifact,
    );
    const streamed = message("Done.");

    const second = stampHostArtifact(
      first,
      streamed,
      [],
      () => artifact(),
      withArtifact,
    );

    expect(second.message).not.toBe(first.message);
    expect(second.message.content).toBe(streamed.content);
    expect(second.message.hostArtifact).toBe(first.message.hostArtifact);
  });

  it("stamps a changed artifact", () => {
    const first = stampHostArtifact(
      undefined,
      message("Done."),
      ["a"],
      () => artifact(),
      withArtifact,
    );
    const changed = artifact({ proposedClientAction: "word.apply_edits" });

    const second = stampHostArtifact(
      first,
      first.source,
      ["b"],
      () => changed,
      withArtifact,
    );

    expect(second.message.hostArtifact).toBe(changed);
  });

  it("drops an artifact the new inputs no longer build", () => {
    const first = stampHostArtifact(
      undefined,
      message("Done."),
      ["word_document_review"],
      () => artifact(),
      withArtifact,
    );

    const second = stampHostArtifact(
      first,
      first.source,
      [undefined],
      () => undefined,
      withArtifact,
    );

    expect(second.message).toBe(first.source);
    expect(second.message.hostArtifact).toBeUndefined();
  });

  it("leaves a message without an artifact as it is", () => {
    const source = message("Done.");

    const stamp = stampHostArtifact(
      undefined,
      source,
      [],
      () => undefined,
      withArtifact,
    );

    expect(stamp.message).toBe(source);
  });
});

describe("isSameHostArtifact", () => {
  it("compares arrays and objects by their entries", () => {
    expect(isSameHostArtifact(artifact(), artifact())).toBe(true);
    expect(
      isSameHostArtifact(
        artifact(),
        artifact({ allowedClientActions: ["word.add_comments"] }),
      ),
    ).toBe(false);
    expect(
      isSameHostArtifact(
        artifact(),
        artifact({
          submittedCard: {
            toolCallId: "call-2",
            language: "plan",
            content: "call-2",
          },
        }),
      ),
    ).toBe(false);
  });

  it("counts a nested value that is not a plain record as changed", () => {
    const card = new Map([["toolCallId", "call-1"]]);
    type Card = HostArtifact["submittedCard"];
    expect(
      isSameHostArtifact(
        artifact({ submittedCard: card as unknown as Card }),
        artifact({ submittedCard: new Map(card) as unknown as Card }),
      ),
    ).toBe(false);
  });

  it("tells a missing field from one set to undefined", () => {
    expect(
      isSameHostArtifact(
        artifact(),
        artifact({ proposedClientAction: undefined }),
      ),
    ).toBe(false);
  });
});
