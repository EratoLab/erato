import { describe, expect, it } from "vitest";

import {
  outlookSidecarUri,
  outlookSourceReferences,
  uniqueOutlookId,
} from "./outlookNavigation";

import type { OutlookMessageReference } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SidecarSnapshot } from "@erato/desktop-sidecar-protocol";

const reference: OutlookMessageReference = {
  external_ids: [
    { key: "email_message_id", value: "<Müller+mail@example.test>" },
  ],
  mailbox: { emailAddress: "shared@example.test" },
};
const descriptor = {
  version: 1,
  target: "classicOutlook",
  launchUriPrefix: "erato-launch://outlook/open?reference=",
  maxReferenceBytes: 16_384,
};
const snapshot: SidecarSnapshot = {
  state: "ready",
  protocolVersion: "1.0",
  serverInfo: null,
  instanceId: "test",
  catalogue: null,
  capabilities: new Map(),
  error: null,
  discoveryExtensions: { "x-erato-outlook-navigation": descriptor },
};

describe("Outlook source navigation", () => {
  it("round-trips UTF-8 as unpadded base64url without leaking it into query parameters", () => {
    const uri = outlookSidecarUri(reference, snapshot, "windows")!;
    const encoded = uri.split("reference=")[1];
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const json = new TextDecoder().decode(
      Uint8Array.from(
        globalThis.atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
        (c) => c.charCodeAt(0),
      ),
    );
    expect(JSON.parse(json)).toEqual(reference);
  });
  it.each(["macos", "linux", undefined])(
    "does not advertise native navigation on %s",
    (os) => {
      expect(outlookSidecarUri(reference, snapshot, os)).toBeNull();
    },
  );
  it.each([
    undefined,
    { ...descriptor, launchUriPrefix: "https://untrusted.test/" },
    { ...descriptor, version: 2 },
    { ...descriptor, maxReferenceBytes: 10 },
    { ...descriptor, target: "newOutlook" },
  ])("requires a compatible advertised contract: %j", (extension) => {
    expect(
      outlookSidecarUri(
        reference,
        {
          ...snapshot,
          discoveryExtensions: { "x-erato-outlook-navigation": extension },
        },
        "windows",
      ),
    ).toBeNull();
  });
  it("invalidates the action while disconnected, even if an old extension remains", () => {
    expect(
      outlookSidecarUri(reference, { ...snapshot, state: "error" }, "windows"),
    ).toBeNull();
  });
  it.each([
    {
      external_ids: [{ key: "ews_id", value: "ews" }],
      mailbox: reference.mailbox,
    },
    {
      external_ids: [{ key: "local_node_id", value: "123" }],
      mailbox: reference.mailbox,
    },
    { external_ids: reference.external_ids },
    {
      external_ids: [{ key: "outlook_entry_id", value: "not hex" }],
      mailbox: reference.mailbox,
    },
    {
      ...reference,
      external_ids: [
        ...reference.external_ids,
        { key: "email_message_id", value: "different" },
      ],
    },
  ])("refuses unresolved, unscoped or ambiguous references: %j", (source) => {
    expect(outlookSidecarUri(source, snapshot, "windows")).toBeNull();
  });
  it("accepts native entry/store IDs without a mailbox SMTP address", () => {
    expect(
      outlookSidecarUri(
        {
          external_ids: [
            { key: "outlook_entry_id", value: "ABCD" },
            { key: "outlook_store_id", value: "0123" },
          ],
        },
        snapshot,
        "windows",
      ),
    ).toMatch(/^erato-launch:/);
  });
  it("never treats local IDs or contradictory EWS IDs as Office.js IDs", () => {
    expect(uniqueOutlookId(reference, "ews_id")).toBeUndefined();
    expect(
      uniqueOutlookId(
        {
          external_ids: [
            { key: "ews_id", value: "one" },
            { key: "ews_id", value: "two" },
          ],
        },
        "ews_id",
      ),
    ).toBeUndefined();
  });
  it("preserves distinct origins and chooses containing mail over nested mail", () => {
    const nested = { external_ids: [{ key: "ews_id", value: "nested" }] };
    expect(
      outlookSourceReferences({
        version: 1,
        origins: [
          { document: nested, topLevelParent: reference },
          { topLevelParent: reference },
          { document: nested },
        ],
      }),
    ).toEqual([reference, nested]);
  });
});
