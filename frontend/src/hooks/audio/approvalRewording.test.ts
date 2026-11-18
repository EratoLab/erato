import { beforeEach, describe, expect, it, vi } from "vitest";

import { withRewording } from "@/lib/toolCallGist/spokenCardRewording";

import { forgetNaturalApprovals, naturalWordings } from "./approvalRewording";


import type { SpokenPiece } from "@/lib/toolCallGist/spokenCard";

const fetchRewordApproval = vi.fn();
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchRewordApproval: (...args: unknown[]) => fetchRewordApproval(...args),
}));

const PIECES: SpokenPiece[] = [
  {
    id: "what",
    role: "what",
    text: "Ich möchte in Dynamics 365 eine Aufgabe anlegen:",
    mustSay: false,
    values: [{ slot: "server", value: { kind: "text", text: "Dynamics 365" } }],
  },
  {
    id: "request",
    role: "request",
    text: "Bitte auf dem Bildschirm bestätigen.",
    mustSay: false,
    values: [],
  },
];
const OPTIONS = { language: "de", now: new Date("2026-11-18T09:00:00Z") };

beforeEach(() => {
  fetchRewordApproval.mockReset();
  forgetNaturalApprovals(["a", "b", "c"]);
});

describe("naturalWordings", () => {
  it("sends the pieces with their facts and takes only checked wordings", async () => {
    fetchRewordApproval.mockResolvedValue({
      pieces: [
        {
          id: "what",
          text: "Ich lege in Dynamics 365 eine Aufgabe an:",
          natural: true,
        },
        { id: "request", text: "Passt schon.", natural: true },
      ],
    });
    const answer = await naturalWordings("a", "m", PIECES, OPTIONS);
    const pieces = withRewording(PIECES, answer);
    expect(fetchRewordApproval.mock.calls[0][0].body).toEqual({
      language: "de",
      pieces: [
        {
          id: "what",
          role: "what",
          text: PIECES[0].text,
          facts: ["Dynamics 365"],
          must_say: false,
        },
        {
          id: "request",
          role: "request",
          text: PIECES[1].text,
          facts: [],
          must_say: false,
        },
      ],
    });
    expect(pieces.map((piece) => piece.text)).toEqual([
      "Ich lege in Dynamics 365 eine Aufgabe an:",
      "Bitte auf dem Bildschirm bestätigen.",
    ]);
  });

  it("asks once per composition and gives nothing on failure", async () => {
    fetchRewordApproval.mockRejectedValue(new Error("404"));
    const first = naturalWordings("b", "m", PIECES, OPTIONS);
    const again = naturalWordings("b", "m", PIECES, OPTIONS);
    expect(await first).toBeUndefined();
    expect(await again).toBeUndefined();
    expect(fetchRewordApproval).toHaveBeenCalledTimes(1);
    // Another composition of the same card is another request.
    await naturalWordings("b", "m", PIECES.slice(1), OPTIONS);
    expect(fetchRewordApproval).toHaveBeenCalledTimes(2);
  });
});
