import { describe, it, expect } from "vitest";

import {
  CLIENT_ACTION_TOOL_NAME,
  buildOutlookArtifact,
  computeShouldRenderEmailCard,
  extractProposedClientAction,
  isImplementedClientAction,
  offerableAppointmentClientActions,
  offerableClientActions,
  offerableEmailClientActions,
} from "../outlookClientActions";

import type { ContentPart } from "@erato/frontend/library";

const ALLOWED = ["outlook.reply", "outlook.reply_all"];

function toolUsePart(overrides: Record<string, unknown> = {}): ContentPart {
  return {
    content_type: "tool_use",
    tool_call_id: "call-1",
    tool_name: CLIENT_ACTION_TOOL_NAME,
    status: "success",
    input: { action: "outlook.reply_all" },
    output: { status: "proposed", action: "outlook.reply_all" },
    ...overrides,
  } as unknown as ContentPart;
}

describe("offerableClientActions", () => {
  it("intersects backend-allowed actions with the implemented registry", () => {
    expect(
      offerableClientActions([
        "outlook.reply_all",
        "outlook.reply",
        "outlook.delete_mailbox",
      ]),
    ).toEqual(["outlook.reply", "outlook.reply_all"]);
  });

  it("returns nothing for missing or empty allowed actions", () => {
    expect(offerableClientActions(undefined)).toEqual([]);
    expect(offerableClientActions([])).toEqual([]);
    expect(offerableClientActions(["not.implemented"])).toEqual([]);
  });

  it("partitions by kind: each renderer only offers its own actions", () => {
    const allowed = [
      "outlook.create_appointment",
      "outlook.reply",
      "outlook.reply_all",
    ];
    expect(offerableEmailClientActions(allowed)).toEqual([
      "outlook.reply",
      "outlook.reply_all",
    ]);
    expect(offerableAppointmentClientActions(allowed)).toEqual([
      "outlook.create_appointment",
    ]);
    // An appointment-only facet (outlook_schedule) yields NO reply buttons.
    expect(offerableEmailClientActions(["outlook.create_appointment"])).toEqual(
      [],
    );
    expect(offerableAppointmentClientActions(["outlook.reply"])).toEqual([]);
  });
});

describe("isImplementedClientAction", () => {
  it("accepts only registry actions", () => {
    expect(isImplementedClientAction("outlook.reply")).toBe(true);
    expect(isImplementedClientAction("outlook.reply_all")).toBe(true);
    expect(isImplementedClientAction("outlook.create_appointment")).toBe(true);
    expect(isImplementedClientAction("outlook.send")).toBe(false);
    expect(isImplementedClientAction("")).toBe(false);
  });
});

describe("extractProposedClientAction", () => {
  it("extracts a valid successful proposal", () => {
    expect(extractProposedClientAction([toolUsePart()], ALLOWED)).toBe(
      "outlook.reply_all",
    );
  });

  it("ignores other tools and non-tool parts", () => {
    const parts: ContentPart[] = [
      { content_type: "text", text: "use reply_all please" },
      toolUsePart({ tool_name: "some_mcp_tool" }),
    ];
    expect(extractProposedClientAction(parts, ALLOWED)).toBeUndefined();
  });

  it("ignores proposals the backend marked as failed", () => {
    expect(
      extractProposedClientAction([toolUsePart({ status: "error" })], ALLOWED),
    ).toBeUndefined();
    expect(
      extractProposedClientAction(
        [toolUsePart({ status: "in_progress" })],
        ALLOWED,
      ),
    ).toBeUndefined();
  });

  it("ignores malformed inputs", () => {
    expect(
      extractProposedClientAction([toolUsePart({ input: null })], ALLOWED),
    ).toBeUndefined();
    expect(
      extractProposedClientAction([toolUsePart({ input: "reply" })], ALLOWED),
    ).toBeUndefined();
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: 42 } })],
        ALLOWED,
      ),
    ).toBeUndefined();
    expect(
      extractProposedClientAction([toolUsePart({ input: {} })], ALLOWED),
    ).toBeUndefined();
  });

  it("rejects actions outside the facet's allowed list, even if implemented", () => {
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: "outlook.reply_all" } })],
        ["outlook.reply"],
      ),
    ).toBeUndefined();
  });

  it("rejects allowed-but-unimplemented actions", () => {
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: "teams.post" } })],
        ["teams.post"],
      ),
    ).toBeUndefined();
  });

  it("handles empty content", () => {
    expect(extractProposedClientAction(undefined, ALLOWED)).toBeUndefined();
    expect(extractProposedClientAction([], ALLOWED)).toBeUndefined();
  });

  it("accepts outlook.create_appointment only through BOTH gates", () => {
    const proposal = [
      toolUsePart({ input: { action: "outlook.create_appointment" } }),
    ];
    // In the registry AND in the facet's client_actions → accepted.
    expect(
      extractProposedClientAction(proposal, ["outlook.create_appointment"]),
    ).toBe("outlook.create_appointment");
    // Removed from the facet's client_actions → ignored despite the registry.
    expect(extractProposedClientAction(proposal, [])).toBeUndefined();
    expect(extractProposedClientAction(proposal, ALLOWED)).toBeUndefined();
    // Allowed by the facet but outside the registry → ignored (the second
    // gate; asserted with a look-alike id the add-in does not implement).
    expect(
      extractProposedClientAction(
        [toolUsePart({ input: { action: "outlook.create_meeting" } })],
        ["outlook.create_meeting"],
      ),
    ).toBeUndefined();
  });
});

describe("computeShouldRenderEmailCard", () => {
  it("suppresses an ambient reply facet that produced no proposal", () => {
    // The reply facet offers reply/reply-all but the model only answered
    // (no proposal) — a plain summary must NOT become an email card.
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: ALLOWED,
        proposedClientAction: undefined,
      }),
    ).toBe(false);
  });

  it("cards a reply facet once the model has proposed a client action", () => {
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: ALLOWED,
        proposedClientAction: "outlook.reply",
      }),
    ).toBe(true);
  });

  it("cards a facet that advertises ONLY an unimplemented action", () => {
    // The intentional Finding-2 behavior: keyed off the OFFERABLE set, so an
    // action the add-in does not implement does not make this a client-action
    // facet. If this were keyed off the RAW allowed list it would (wrongly)
    // suppress. This is the assertion that fails if the offerable intersection
    // is dropped.
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: ["outlook.forward"],
        proposedClientAction: undefined,
      }),
    ).toBe(true);
  });

  it("still suppresses when a mix of implemented + unimplemented actions is offered without a proposal", () => {
    // outlook.reply IS offerable, so this is a client-action facet and a plain
    // answer (no proposal) must suppress — outlook.forward being present and
    // unimplemented does not change that.
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: ["outlook.forward", "outlook.reply"],
        proposedClientAction: undefined,
      }),
    ).toBe(false);
  });

  it("always cards a facet with no client actions (compose / rewrite)", () => {
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: [],
        proposedClientAction: undefined,
      }),
    ).toBe(true);
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: undefined,
        proposedClientAction: undefined,
      }),
    ).toBe(true);
  });

  it("never lets an appointment proposal promote prose to an email card", () => {
    // A facet offering both kinds: the create-appointment proposal is not an
    // email draft, so the ambient-suppression verdict must hold.
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: [...ALLOWED, "outlook.create_appointment"],
        proposedClientAction: "outlook.create_appointment",
      }),
    ).toBe(false);
  });

  it("treats an appointment-only facet as not email-carding-relevant", () => {
    // outlook_schedule: the verdict is true ("always cards") but inert — the
    // whole-body email card additionally requires a bodyFormat, which
    // appointment facets never stamp (see buildOutlookArtifact below).
    expect(
      computeShouldRenderEmailCard({
        allowedClientActions: ["outlook.create_appointment"],
        proposedClientAction: undefined,
      }),
    ).toBe(true);
  });
});

describe("buildOutlookArtifact", () => {
  const scheduleInfo = {
    clientActions: ["outlook.create_appointment"],
    alwaysAskActions: ["outlook.create_appointment"],
    presentation: "auto_prompt",
  };

  it("stamps an artifact for outlook_schedule despite it carrying no body_format", () => {
    // The decoupled gate (ERMAIN-387): the confirm card can only render when
    // the artifact (facet metadata + proposal) reaches the fence renderer.
    const artifact = buildOutlookArtifact({
      facetId: "outlook_schedule",
      facetArgs: { now_iso: "2026-07-06T10:00:00+02:00", timezone: "Europe/Berlin" },
      clientActionInfo: scheduleInfo,
      content: [
        toolUsePart({ input: { action: "outlook.create_appointment" } }),
      ],
      messageId: "msg-1",
      freshItemIdentity: undefined,
    });
    expect(artifact).toMatchObject({
      facetId: "outlook_schedule",
      renderMode: "body",
      messageId: "msg-1",
      allowedClientActions: ["outlook.create_appointment"],
      alwaysAskClientActions: ["outlook.create_appointment"],
      proposedClientAction: "outlook.create_appointment",
      clientActionPresentation: "auto_prompt",
    });
    // No bodyFormat ⇒ the email-shaped paths (drift rescue, whole-body card)
    // stay off for scheduling prose.
    expect(artifact?.bodyFormat).toBeUndefined();
    expect(artifact?.isFreshCompletion).toBeUndefined();
  });

  it("returns undefined for a facet with neither body_format nor offerable actions", () => {
    expect(
      buildOutlookArtifact({
        facetId: "some_facet",
        facetArgs: { anything: "else" },
        clientActionInfo: undefined,
        content: [],
        messageId: "msg-1",
        freshItemIdentity: undefined,
      }),
    ).toBeUndefined();
    expect(
      buildOutlookArtifact({
        facetId: undefined,
        facetArgs: { body_format: "text" },
        clientActionInfo: undefined,
        content: [],
        messageId: "msg-1",
        freshItemIdentity: undefined,
      }),
    ).toBeUndefined();
    // Advertising only unimplemented actions does not open the second door.
    expect(
      buildOutlookArtifact({
        facetId: "some_facet",
        facetArgs: {},
        clientActionInfo: {
          clientActions: ["teams.post"],
          alwaysAskActions: [],
        },
        content: [],
        messageId: "msg-1",
        freshItemIdentity: undefined,
      }),
    ).toBeUndefined();
  });

  it("keeps the email-facet stamp unchanged (bodyFormat, suppression, freshness)", () => {
    const artifact = buildOutlookArtifact({
      facetId: "outlook_reply_from_read",
      facetArgs: { body_format: "html" },
      clientActionInfo: {
        clientActions: ALLOWED,
        alwaysAskActions: ["outlook.reply_all"],
        presentation: "auto_prompt",
      },
      content: [],
      messageId: "msg-2",
      freshItemIdentity: "item-abc",
    });
    expect(artifact).toMatchObject({
      facetId: "outlook_reply_from_read",
      bodyFormat: "html",
      renderMode: "body",
      // No proposal on an ambient client-action facet ⇒ suppressed.
      shouldRenderEmailCard: false,
      isFreshCompletion: true,
      itemIdentity: "item-abc",
    });
  });

  it("marks review facets as suggestions and plain body facets as body", () => {
    expect(
      buildOutlookArtifact({
        facetId: "outlook_review_draft",
        facetArgs: { body_format: "text" },
        clientActionInfo: undefined,
        content: [],
        messageId: "m",
        freshItemIdentity: undefined,
      })?.renderMode,
    ).toBe("suggestions");
    expect(
      buildOutlookArtifact({
        facetId: "compose_email",
        facetArgs: { body_format: "text" },
        clientActionInfo: undefined,
        content: [],
        messageId: "m",
        freshItemIdentity: undefined,
      }),
    ).toMatchObject({ renderMode: "body", bodyFormat: "text" });
  });
});
