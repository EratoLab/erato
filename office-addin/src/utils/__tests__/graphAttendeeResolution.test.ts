import { describe, expect, it, vi } from "vitest";

import { resolveAttendeeNameViaGraph } from "../graphAttendeeResolution";

import type { GraphTransport } from "../fetchOutlookMessageGraph";

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? "OK" : "Forbidden",
    json: () => Promise.resolve(value),
  } as unknown as Response;
}

const token = () => vi.fn().mockResolvedValue("tok");

const person = (displayName: string, address: string, cls = "Person") => ({
  displayName,
  personType: { class: cls },
  scoredEmailAddresses: [{ address }],
});

function transportOf(
  router: (url: string) => Response,
): GraphTransport & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => router(url)) as never;
}

describe("resolveAttendeeNameViaGraph", () => {
  it("resolves a single People match", async () => {
    const transport = transportOf((url) => {
      expect(url).toContain("/me/people");
      expect(url).toContain(encodeURIComponent('"Bob Builder"'));
      return jsonResponse({ value: [person("Bob Builder", "bob@x.de")] });
    });

    await expect(
      resolveAttendeeNameViaGraph({ people: token() }, "Bob Builder", {
        transport,
      }),
    ).resolves.toEqual({
      kind: "resolved",
      smtp: "bob@x.de",
      name: "Bob Builder",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("prefers an exact display-name hit among fuzzy matches", async () => {
    const transport = transportOf(() =>
      jsonResponse({
        value: [
          person("Christina Test", "christina@x.de"),
          person("chris test", "chris@x.de"),
        ],
      }),
    );

    await expect(
      resolveAttendeeNameViaGraph({ people: token() }, "Chris Test", {
        transport,
      }),
    ).resolves.toEqual({
      kind: "resolved",
      smtp: "chris@x.de",
      name: "chris test",
    });
  });

  it("returns the candidate list when genuinely ambiguous (groups filtered, capped)", async () => {
    const transport = transportOf(() =>
      jsonResponse({
        value: [
          person("Chris A", "a@x.de"),
          person("Chris B", "b@x.de"),
          person("Chris DL", "dl@x.de", "Group"),
          ...Array.from({ length: 6 }, (_, i) =>
            person(`Chris ${i}`, `c${i}@x.de`),
          ),
        ],
      }),
    );

    const outcome = await resolveAttendeeNameViaGraph(
      { people: token() },
      "Chris",
      { transport },
    );
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind === "ambiguous") {
      expect(outcome.candidates).toHaveLength(5);
      expect(outcome.candidates[0]).toEqual({
        name: "Chris A",
        smtp: "a@x.de",
      });
      expect(outcome.candidates.map((c) => c.smtp)).not.toContain("dl@x.de");
    }
  });

  it("falls back to /users when People finds nothing, escaping the OData quote", async () => {
    const urls: string[] = [];
    const transport = transportOf((url) => {
      urls.push(url);
      if (url.includes("/me/people")) return jsonResponse({ value: [] });
      return jsonResponse({
        value: [{ displayName: "Pat O'Brien", mail: "pat@x.de" }],
      });
    });

    await expect(
      resolveAttendeeNameViaGraph(
        { people: token(), users: token() },
        "Pat O'Brien",
        { transport },
      ),
    ).resolves.toEqual({
      kind: "resolved",
      smtp: "pat@x.de",
      name: "Pat O'Brien",
    });
    expect(urls[1]).toContain("/users");
    expect(urls[1]).toContain(
      encodeURIComponent("startswith(displayName,'Pat O''Brien')"),
    );
  });

  it("falls back to /users when People is not permitted (403)", async () => {
    const transport = transportOf((url) =>
      url.includes("/me/people")
        ? jsonResponse({}, 403)
        : jsonResponse({ value: [{ displayName: "Bob", mail: "bob@x.de" }] }),
    );

    await expect(
      resolveAttendeeNameViaGraph({ people: token(), users: token() }, "Bob", {
        transport,
      }),
    ).resolves.toMatchObject({ kind: "resolved", smtp: "bob@x.de" });
  });

  it("is unavailable only when every leg fails (403 / consent throw)", async () => {
    const transport = transportOf(() => jsonResponse({}, 403));
    const consentDenied = vi
      .fn()
      .mockRejectedValue(new Error("consent_required"));

    const outcome = await resolveAttendeeNameViaGraph(
      { people: token(), users: consentDenied },
      "Bob",
      { transport },
    );
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") {
      expect(outcome.detail).toContain("People.Read");
      expect(outcome.detail).toContain("consent_required");
    }
  });

  it("a clean empty leg outranks an unavailable sibling: not-found", async () => {
    const transport = transportOf((url) =>
      url.includes("/me/people")
        ? jsonResponse({}, 403)
        : jsonResponse({ value: [] }),
    );

    await expect(
      resolveAttendeeNameViaGraph(
        { people: token(), users: token() },
        "Ghost",
        { transport },
      ),
    ).resolves.toEqual({ kind: "not-found" });
  });

  it("reports unavailable when no directory scopes are configured", async () => {
    const outcome = await resolveAttendeeNameViaGraph({}, "Bob", {});
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") {
      expect(outcome.detail).toContain("no directory permissions configured");
    }
  });
});
