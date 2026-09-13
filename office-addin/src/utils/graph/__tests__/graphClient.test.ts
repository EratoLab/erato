import { describe, it, expect } from "vitest";

import { GRAPH_BASE, mailboxRoot } from "../graphClient";

describe("mailboxRoot", () => {
  it("falls back to the signed-in user's own store without an owner", () => {
    expect(mailboxRoot()).toBe(`${GRAPH_BASE}/me`);
    expect(mailboxRoot(null)).toBe(`${GRAPH_BASE}/me`);
  });

  it("addresses the owner's store when an owner is given", () => {
    expect(mailboxRoot("shared@contoso.com")).toBe(
      `${GRAPH_BASE}/users/shared%40contoso.com`,
    );
  });

  it("escapes a '+' in the local part, which would otherwise decode as a space", () => {
    expect(mailboxRoot("shared+box@contoso.com")).toBe(
      `${GRAPH_BASE}/users/shared%2Bbox%40contoso.com`,
    );
  });

  it("treats an empty owner as no owner", () => {
    expect(mailboxRoot("")).toBe(`${GRAPH_BASE}/me`);
  });
});
