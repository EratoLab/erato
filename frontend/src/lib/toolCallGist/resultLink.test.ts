import { describe, expect, it } from "vitest";

import { resultLinkOf } from "./resultLink";

const link = (uri: unknown, extra: Record<string, unknown> = {}) => ({
  links: [
    { uri, host: "records.example", matches_server_host: true, ...extra },
  ],
});

describe("resultLinkOf", () => {
  it("reads an https link on the server's own host", () => {
    expect(
      resultLinkOf(link("https://Records.example/pages/1", { title: "Q3‮" })),
    ).toEqual({
      href: "https://records.example/pages/1",
      host: "records.example",
      onServer: true,
      title: "Q3",
    });
  });

  it("keeps a port and says the host, never the server, when the URL disagrees", () => {
    expect(resultLinkOf(link("https://evil.example:8443/x"))).toMatchObject({
      host: "evil.example:8443",
      onServer: false,
    });
    expect(
      resultLinkOf(
        link("https://records.example/x", { matches_server_host: "yes" }),
      ),
    ).toMatchObject({ onServer: false });
    expect(
      resultLinkOf(link("https://records.example/x", { host: 5 })),
    ).toMatchObject({ onServer: false });
  });

  it("shows a lookalike host as the browser reads it", () => {
    expect(resultLinkOf(link("https://rëcords.example/x"))?.host).toMatch(
      /^xn--/,
    );
  });

  it.each<[string, unknown]>([
    ["no details", undefined],
    ["details that are text", "https://records.example"],
    ["links that are not a list", { links: { uri: "https://a.example" } }],
    ["a URI that is not text", link(["https://a.example"])],
    ["an http URI", link("http://records.example/x")],
    ["a javascript URI", link("javascript:alert(1)")],
    ["user info", link("https://user@records.example/x")],
    ["a URI that does not parse", link("https://exa mple.com/")],
    ["an overlong URI", link(`https://records.example/${"a".repeat(2_000)}`)],
  ])("finds no link in %s", (_name, details) => {
    expect(resultLinkOf(details)).toBeUndefined();
  });

  it("takes the first readable link and reads at most a hundred", () => {
    const junk = Array.from({ length: 100 }, () => ({ uri: 1 }));
    expect(
      resultLinkOf({
        links: [
          null,
          { uri: "http://a.example" },
          ...link("https://b.example/").links,
        ],
      })?.host,
    ).toBe("b.example");
    expect(
      resultLinkOf({ links: [...junk, ...link("https://b.example/").links] }),
    ).toBeUndefined();
  });
});
