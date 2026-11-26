import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createMockAsyncResult } from "../../../test/helpers/asyncResult";
import { createMockMessageCompose } from "../../../test/mocks/outlook/composeMail";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../../test/mocks/outlook/mailbox";
import {
  getComposeBodyType,
  replaceComposeSelection,
  replaceComposeSubjectText,
  prependComposeBody,
} from "../outlookComposeWrite";

describe("outlookComposeWrite", () => {
  let mailbox: ReturnType<typeof installMockMailbox>;

  beforeEach(() => {
    mailbox = installMockMailbox();
  });

  afterEach(() => {
    uninstallMockMailbox();
  });

  function createAppointmentCompose(body: {
    getAsync: ReturnType<typeof vi.fn>;
    getTypeAsync?: ReturnType<typeof vi.fn>;
    setSelectedDataAsync: ReturnType<typeof vi.fn>;
    prependAsync: ReturnType<typeof vi.fn>;
  }) {
    return {
      itemType: "appointment",
      subject: { getAsync: vi.fn() },
      body,
    };
  }

  describe("getComposeBodyType", () => {
    it("returns 'html' when body type is Html", async () => {
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Html)),
          ),
          setSelectedDataAsync: vi.fn(),
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      const result = await getComposeBodyType();
      expect(result).toBe("html");
    });

    it("returns 'text' when body type is Text", async () => {
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Text)),
          ),
          setSelectedDataAsync: vi.fn(),
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      const result = await getComposeBodyType();
      expect(result).toBe("text");
    });

    it("infers 'html' when getTypeAsync is unavailable", async () => {
      const getAsync = vi.fn((coercionType, callback) => {
        if (coercionType === Office.CoercionType.Html) {
          callback(createMockAsyncResult("<div>Hello</div>"));
          return;
        }

        callback(createMockAsyncResult("Hello"));
      });
      const item = createMockMessageCompose({
        body: {
          getAsync,
          setSelectedDataAsync: vi.fn(),
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      const result = await getComposeBodyType();
      expect(result).toBe("html");
      expect(getAsync).toHaveBeenCalledWith(
        Office.CoercionType.Html,
        expect.any(Function),
      );
      expect(getAsync).toHaveBeenCalledWith(
        Office.CoercionType.Text,
        expect.any(Function),
      );
    });

    it("falls back to 'text' when html body reads are unavailable", async () => {
      const getAsync = vi.fn((coercionType, callback) => {
        if (coercionType === Office.CoercionType.Html) {
          callback(
            createMockAsyncResult("", "failed", {
              message: "HTML body unsupported",
              code: "UnsupportedDataObject",
            }),
          );
          return;
        }

        callback(createMockAsyncResult("Hello"));
      });
      const item = createMockMessageCompose({
        body: {
          getAsync,
          setSelectedDataAsync: vi.fn(),
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      const result = await getComposeBodyType();
      expect(result).toBe("text");
    });

    it("throws when no compose item is available", async () => {
      mailbox.item = null;
      await expect(getComposeBodyType()).rejects.toThrow(
        "No compose item available",
      );
    });
  });

  describe("replaceComposeSelection", () => {
    it("writes into an appointment organizer description", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      mailbox.item = createAppointmentCompose({
        getAsync: vi.fn(),
        getTypeAsync: vi.fn((callback) =>
          callback(createMockAsyncResult(Office.CoercionType.Html)),
        ),
        setSelectedDataAsync,
        prependAsync: vi.fn(),
      });

      await replaceComposeSelection("Updated agenda");

      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "Updated agenda",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });

    it("converts plain text to HTML with line breaks for html body", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Html)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("line one\nline two");
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "line one<br>\nline two",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });

    it("uses Html coercion for html content into html body", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Html)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("<b>bold</b>", true);
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "<b>bold</b>",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });

    it("uses Text coercion for plain content into text body", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Text)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("plain text");
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "plain text",
        { coercionType: Office.CoercionType.Text },
        expect.any(Function),
      );
    });

    it("strips HTML tags when inserting html content into text body", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Text)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("<b>bold</b> text", true);
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "bold text",
        { coercionType: Office.CoercionType.Text },
        expect.any(Function),
      );
    });

    it("falls back to text insertion when html insertion is rejected", async () => {
      const setSelectedDataAsync = vi.fn((data, options, callback) => {
        if (options.coercionType === Office.CoercionType.Html) {
          callback(
            createMockAsyncResult(undefined, "failed", {
              message: "HTML insertion unsupported",
              code: "InvalidFormatError",
            }),
          );
          return;
        }

        callback(createMockAsyncResult(undefined));
      });
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn((coercionType, callback) => {
            if (coercionType === Office.CoercionType.Html) {
              callback(createMockAsyncResult("plain text"));
              return;
            }

            callback(createMockAsyncResult("plain text"));
          }),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("<b>bold</b>", true);
      expect(setSelectedDataAsync).toHaveBeenNthCalledWith(
        1,
        "<b>bold</b>",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
      expect(setSelectedDataAsync).toHaveBeenNthCalledWith(
        2,
        "bold",
        { coercionType: Office.CoercionType.Text },
        expect.any(Function),
      );
    });
  });

  describe("draft format and body type", () => {
    const HTML_DRAFT =
      '<p>Hi,</p><ul><li>one</li><li><a href="https://example.com/a">two</a></li></ul><img src="https://x.example/p.gif"><p style="color:#fff">Bye</p>';
    const CLEAN_HTML =
      '<p>Hi,</p><ul><li>one</li><li><a href="https://example.com/a">two</a></li></ul><p>Bye</p>';
    const DRAFT_TEXT = "Hi,\n\n- one\n- two (https://example.com/a)\n\nBye";
    const PLAIN_DRAFT = "Hi,\nthanks";
    const PLAIN_AS_HTML = "Hi,<br>\nthanks";
    const Html = () => Office.CoercionType.Html;
    const Text = () => Office.CoercionType.Text;

    function installBody(
      bodyType: Office.CoercionType,
      refuse?: Office.CoercionType,
    ) {
      const setSelectedDataAsync = vi.fn((_data, options, callback) => {
        callback(
          options.coercionType === refuse
            ? createMockAsyncResult(undefined, "failed", {
                message: "Coercion refused",
                code: "InvalidFormatError",
              })
            : createMockAsyncResult(undefined),
        );
      });
      mailbox.item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(bodyType)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      return setSelectedDataAsync;
    }

    function written(setSelectedDataAsync: ReturnType<typeof vi.fn>) {
      return setSelectedDataAsync.mock.calls.map(([data, options]) => [
        options.coercionType,
        data,
      ]);
    }

    it.each([
      ["html draft", "html body", true, Html, undefined, [[Html, CLEAN_HTML]]],
      ["html draft", "text body", true, Text, undefined, [[Text, DRAFT_TEXT]]],
      [
        "html draft",
        "html body refusing Html",
        true,
        Html,
        Html,
        [
          [Html, CLEAN_HTML],
          [Text, DRAFT_TEXT],
        ],
      ],
      [
        "html draft",
        "text body refusing Text",
        true,
        Text,
        Text,
        [
          [Text, DRAFT_TEXT],
          [Html, CLEAN_HTML],
        ],
      ],
      [
        "plain draft",
        "html body",
        false,
        Html,
        undefined,
        [[Html, PLAIN_AS_HTML]],
      ],
      [
        "plain draft",
        "text body",
        false,
        Text,
        undefined,
        [[Text, PLAIN_DRAFT]],
      ],
      [
        "plain draft",
        "html body refusing Html",
        false,
        Html,
        Html,
        [
          [Html, PLAIN_AS_HTML],
          [Text, PLAIN_DRAFT],
        ],
      ],
      [
        "plain draft",
        "text body refusing Text",
        false,
        Text,
        Text,
        [
          [Text, PLAIN_DRAFT],
          [Html, PLAIN_AS_HTML],
        ],
      ],
    ] as const)(
      "%s into %s",
      async (_draft, _body, isHtml, bodyType, refuse, expected) => {
        const setSelectedDataAsync = installBody(bodyType(), refuse?.());

        await replaceComposeSelection(
          isHtml ? HTML_DRAFT : PLAIN_DRAFT,
          isHtml,
        );

        expect(written(setSelectedDataAsync)).toEqual(
          expected.map(([coercion, data]) => [coercion(), data]),
        );
      },
    );

    it.each([
      [
        "a tagless fragment with a character reference",
        "Terms &amp; Conditions apply",
        "Terms & Conditions apply",
      ],
      [
        "inline tags with newline paragraphs",
        "Hi Anna,\n\nthanks for the <strong>quick</strong> reply.\n\nBest\nSam\n",
        "Hi Anna,\n\nthanks for the quick reply.\n\nBest\nSam",
      ],
    ])(
      "writes %s into a text body as clean text",
      async (_name, draft, text) => {
        const setSelectedDataAsync = installBody(Office.CoercionType.Text);

        await replaceComposeSelection(draft, true);

        expect(written(setSelectedDataAsync)).toEqual([
          [Office.CoercionType.Text, text],
        ]);
      },
    );

    it("keeps the paragraphs of inline tags with newline paragraphs in an html body", async () => {
      const setSelectedDataAsync = installBody(Office.CoercionType.Html);

      await replaceComposeSelection("Hi,\n\nthe <b>new</b> date", true);

      expect(written(setSelectedDataAsync)).toEqual([
        [Office.CoercionType.Html, "Hi,<br><br>the <b>new</b> date"],
      ]);
    });

    it("writes nothing raw when the host refuses both coercions", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(
          createMockAsyncResult(undefined, "failed", {
            message: "Coercion refused",
            code: "InvalidFormatError",
          }),
        ),
      );
      mailbox.item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Text)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });

      await expect(replaceComposeSelection(HTML_DRAFT, true)).rejects.toThrow();
      expect(written(setSelectedDataAsync)).toEqual([
        [Office.CoercionType.Text, DRAFT_TEXT],
        [Office.CoercionType.Html, CLEAN_HTML],
      ]);
    });

    it("never passes the raw draft to the host", async () => {
      const setSelectedDataAsync = installBody(Office.CoercionType.Html);

      await replaceComposeSelection(
        '<p>Hi<img src="https://x.example/p.gif"></p><a href="javascript:x()">go</a>',
        true,
      );

      expect(written(setSelectedDataAsync)).toEqual([
        [Office.CoercionType.Html, "<p>Hi</p><a>go</a>"],
      ]);
    });
  });

  describe("replaceComposeSubjectText", () => {
    function installSubject(subject: string) {
      const setAsync = vi.fn((_subject, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const setSelectedDataAsync = vi.fn();
      mailbox.item = createMockMessageCompose({
        subject: {
          getAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(subject)),
          ),
          setAsync,
        },
        body: {
          getAsync: vi.fn(),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      return { setAsync, setSelectedDataAsync };
    }

    it("replaces the passage inside the subject as plain text", async () => {
      const { setAsync, setSelectedDataAsync } = installSubject(
        "Re: Budget (draft) for Q3",
      );

      await replaceComposeSubjectText(
        "Budget (draft)",
        "<p>Final\nbudget</p>",
        true,
      );

      expect(setAsync).toHaveBeenCalledWith(
        "Re: Final budget for Q3",
        expect.any(Function),
      );
      expect(setSelectedDataAsync).not.toHaveBeenCalled();
    });

    it("writes an html draft's text, link address included, into the subject", async () => {
      const { setAsync } = installSubject("Re: Notes");

      await replaceComposeSubjectText(
        "Notes",
        '<p>Notes on <a href="https://example.com/a">the plan</a></p><p>v2</p>',
        true,
      );

      expect(setAsync).toHaveBeenCalledWith(
        "Re: Notes on the plan (https://example.com/a) v2",
        expect.any(Function),
      );
    });

    it("matches across whitespace differences between selection and subject", async () => {
      const { setAsync } = installSubject("Re: Budget  draft");

      await replaceComposeSubjectText("Budget draft", "Final budget");

      expect(setAsync).toHaveBeenCalledWith(
        "Re: Final budget",
        expect.any(Function),
      );
    });

    it.each([
      ["missing", "Re: Travel plans", "Draft"],
      ["ambiguous", "Draft v1 / Draft v2", "Draft"],
      ["overlapping", "aaa", "aa"],
    ])(
      "writes nothing when the passage is %s in the subject",
      async (_case, subject, passage) => {
        const { setAsync, setSelectedDataAsync } = installSubject(subject);

        await expect(
          replaceComposeSubjectText(passage, "Plan"),
        ).rejects.toThrow("exactly once");
        expect(setAsync).not.toHaveBeenCalled();
        expect(setSelectedDataAsync).not.toHaveBeenCalled();
      },
    );

    it("writes into an appointment organizer subject", async () => {
      const setAsync = vi.fn((_subject, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      mailbox.item = {
        itemType: "appointment",
        subject: {
          getAsync: vi.fn((callback) =>
            callback(createMockAsyncResult("Weekly sync")),
          ),
          setAsync,
        },
        body: { setSelectedDataAsync: vi.fn() },
      };

      await replaceComposeSubjectText("Weekly", "Biweekly");

      expect(setAsync).toHaveBeenCalledWith(
        "Biweekly sync",
        expect.any(Function),
      );
    });
  });

  describe("prependComposeBody", () => {
    it("prepends an appointment organizer description", async () => {
      const prependAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      mailbox.item = createAppointmentCompose({
        getAsync: vi.fn(),
        getTypeAsync: vi.fn((callback) =>
          callback(createMockAsyncResult(Office.CoercionType.Text)),
        ),
        setSelectedDataAsync: vi.fn(),
        prependAsync,
      });

      await prependComposeBody("Important: agenda updated");

      expect(prependAsync).toHaveBeenCalledWith(
        "Important: agenda updated",
        { coercionType: Office.CoercionType.Text },
        expect.any(Function),
      );
    });

    it("calls prependAsync with matching coercion type", async () => {
      const prependAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Html)),
          ),
          setSelectedDataAsync: vi.fn(),
          prependAsync,
        },
      });
      mailbox.item = item;

      await prependComposeBody("<p>header</p>");
      expect(prependAsync).toHaveBeenCalledWith(
        "<p>header</p>",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });

    it("prepends a cleaned draft as text into a text body", async () => {
      const prependAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      mailbox.item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Text)),
          ),
          setSelectedDataAsync: vi.fn(),
          prependAsync,
        },
      });

      await prependComposeBody("<ol><li>a</li><li>b</li></ol>");
      expect(prependAsync).toHaveBeenCalledWith(
        "1. a\n2. b",
        { coercionType: Office.CoercionType.Text },
        expect.any(Function),
      );
    });
  });
});
