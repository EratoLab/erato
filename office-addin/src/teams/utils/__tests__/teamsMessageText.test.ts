import { describe, expect, it } from "vitest";

import {
  referencedAttachmentIds,
  teamsMessageBodyToText,
} from "../teamsMessageText";

const html = (content: string) => ({ contentType: "html" as const, content });

describe("teamsMessageBodyToText", () => {
  it("passes a text body through untouched apart from newline normalisation", () => {
    expect(
      teamsMessageBodyToText({
        contentType: "text",
        content: "one\r\n\r\n\r\n\r\ntwo  \n",
      }),
    ).toBe("one\n\ntwo");
  });

  it("renders a mention as @name", () => {
    expect(
      teamsMessageBodyToText(
        html('<p>Hi <at id="0">Alan Turing</at>, ready?</p>'),
      ),
    ).toBe("Hi @Alan Turing, ready?");
  });

  it("turns break and block boundaries into newlines", () => {
    expect(
      teamsMessageBodyToText(html("<p>one</p><div>two<br>three</div>")),
    ).toBe("one\n\ntwo\nthree");
  });

  it("fences a Teams codeblock", () => {
    expect(
      teamsMessageBodyToText(
        html("<p>see</p><codeblock>npm run test</codeblock>"),
      ),
    ).toBe("see\n\n```\nnpm run test\n```");
  });

  it("backticks inline code", () => {
    expect(teamsMessageBodyToText(html("<p>run <code>ls</code> now</p>"))).toBe(
      "run `ls` now",
    );
  });

  it("reduces a hosted image to a marker", () => {
    expect(
      teamsMessageBodyToText(
        html('<p>look <img src="https://graph/hosted/1"></p>'),
      ),
    ).toBe("look [image]");
  });

  it("names an attachment element from the message attachments", () => {
    expect(
      teamsMessageBodyToText(html('<attachment id="att-1"></attachment>'), {
        attachments: [{ id: "att-1", name: "agenda.docx" }],
      }),
    ).toBe("[attachment: agenda.docx]");
  });

  it("falls back to a bare marker for an unknown attachment id", () => {
    expect(
      teamsMessageBodyToText(html('<attachment id="gone"></attachment>')),
    ).toBe("[attachment]");
  });

  it("renders an emoji as its alt text", () => {
    expect(
      teamsMessageBodyToText(
        html('<p>nice <emoji alt="😀" id="smile"></emoji></p>'),
      ),
    ).toBe("nice 😀");
  });

  it("prefixes quoted lines", () => {
    expect(
      teamsMessageBodyToText(
        html("<blockquote><p>old</p><p>news</p></blockquote>"),
      ),
    ).toBe("> old\n>\n> news");
  });

  it("keeps a link's text and appends its href", () => {
    expect(
      teamsMessageBodyToText(
        html('<a href="https://erato.example/x">docs</a>'),
      ),
    ).toBe("docs (https://erato.example/x)");
  });

  it("unwraps an ATP Safe Links redirect back to the original url", () => {
    const safeLink =
      "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Ferato.example%2Fx&data=0123456789";
    expect(teamsMessageBodyToText(html(`<a href="${safeLink}">docs</a>`))).toBe(
      "docs (https://erato.example/x)",
    );
  });

  it("unwraps only the wrapper's own host, not any url that names it", () => {
    const impostor =
      "https://attacker.example/safelinks.protection.outlook.com?url=https%3A%2F%2Ferato.example%2Ftrusted";
    expect(teamsMessageBodyToText(html(`<a href="${impostor}">docs</a>`))).toBe(
      `docs (${impostor})`,
    );

    const subdomainImpostor =
      "https://safelinks.protection.outlook.com.attacker.example/?url=https%3A%2F%2Ferato.example%2Ftrusted";
    expect(
      teamsMessageBodyToText(html(`<a href="${subdomainImpostor}">docs</a>`)),
    ).toBe(`docs (${subdomainImpostor})`);
  });

  it("decodes entities and drops script and style content", () => {
    expect(
      teamsMessageBodyToText(
        html(
          "<style>p{color:red}</style><p>A &amp; B</p><script>alert(1)</script>",
        ),
      ),
    ).toBe("A & B");
  });

  it("returns an empty string for an empty body", () => {
    expect(teamsMessageBodyToText(undefined)).toBe("");
    expect(teamsMessageBodyToText(html("   "))).toBe("");
  });
});

describe("referencedAttachmentIds", () => {
  it("collects the ids the body already discloses", () => {
    expect(
      referencedAttachmentIds(html('<attachment id="a"></attachment>')),
    ).toEqual(new Set(["a"]));
  });

  it("is empty for a text body", () => {
    expect(
      referencedAttachmentIds({ contentType: "text", content: "hi" }).size,
    ).toBe(0);
  });
});
