import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  THEME_MODE_LOCAL_STORAGE_KEY,
  ThemeProvider,
} from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { MessageContent } from "./MessageContent";

import type {
  ContentPart,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";
import type React from "react";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const renderWithTheme = (ui: React.ReactElement) => {
  return render(
    <I18nProvider i18n={i18n}>
      <StaticFeatureConfigProvider>
        <ThemeProvider>{ui}</ThemeProvider>
      </StaticFeatureConfigProvider>
    </I18nProvider>,
  );
};

const textContent = (text: string): ContentPart[] => [
  { content_type: "text", text },
];

const multipleTextContent = (...texts: string[]): ContentPart[] =>
  texts.map((text) => ({ content_type: "text", text }));

const reasoningContent = (
  text: string,
  startedAt?: string | null,
  endedAt?: string | null,
): ContentPart =>
  ({
    content_type: "reasoning",
    text,
    started_at: startedAt,
    ended_at: endedAt,
  }) as ContentPart;

const toolUseContent = ({
  startedAt,
  endedAt,
}: {
  startedAt?: string | null;
  endedAt?: string | null;
}): ContentPart =>
  ({
    content_type: "tool_use",
    status: "success",
    tool_call_id: "tool-call-123",
    tool_name: "search",
    input: null,
    output: null,
    progress_message: null,
    started_at: startedAt,
    ended_at: endedAt,
  }) as ContentPart;

const makeFile = (overrides: Partial<FileUploadItem> = {}): FileUploadItem => ({
  id: "file_123",
  filename: "sample-report-compressed.pdf",
  download_url: "https://files.example.com/sample-report-compressed.pdf",
  preview_url: "https://files.example.com/preview/sample-report-compressed.pdf",
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  file_capability: FileTypeUtil.createMockFileCapability(
    "sample-report-compressed.pdf",
  ),
  ...overrides,
});

beforeAll(() => {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: stub,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
});

describe("MessageContent", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("adopts the theme typography hooks for headings and inline code", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "# Title\n\n## Section\n\nText with **strong** and `code`.",
        )}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).toHaveClass("font-heading-bold");
    expect(
      screen.getByRole("heading", { level: 2, name: "Section" }),
    ).toHaveClass("font-heading");
    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).not.toHaveAttribute("node");
    expect(container.querySelector("article")).toHaveClass("font-sans");
    expect(container.querySelector("p")).not.toHaveAttribute("node");
    expect(container.querySelector("strong")).toHaveClass("font-body-semibold");
    expect(container.querySelector("code")).toHaveClass("font-mono");
    expect(container.querySelector("code")).not.toHaveAttribute("node");
    expect(container.querySelector("code")).toHaveClass(
      "border-theme-code-inline-border",
    );
    expect(container.querySelector("code")).toHaveClass(
      "bg-theme-code-inline-bg",
    );
  });

  it("renders fenced code blocks with the built-in Prism light theme", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```javascript\nconst answer = 42;\n```")}
      />,
    );

    const themedBlock = container.querySelector(
      "pre.message-content-code-block > div",
    );

    expect(
      container.querySelector("pre.message-content-code-block"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre pre")).toBeNull();
    expect(themedBlock).toHaveAttribute(
      "style",
      expect.stringContaining("background-color: white;"),
    );
    expect(themedBlock).toHaveAttribute(
      "style",
      expect.stringContaining("margin: 0px;"),
    );
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toHaveTextContent("const answer = 42;");
  });

  it("uses the same Prism block renderer for untagged fenced code", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "```\nline one of untagged code\nline two of untagged code\n```",
        )}
      />,
    );

    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre pre")).toBeNull();
    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toHaveTextContent(
      /line one of untagged code\s+line two of untagged code/,
    );
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).not.toHaveAttribute("node");
  });

  it("treats single-line fenced code as block code instead of inline code", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```\nsingle line of untagged code\n```")}
      />,
    );

    const blockCode = container.querySelector(
      "pre.message-content-code-block code",
    );

    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre pre")).toBeNull();
    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toBeInTheDocument();
    expect(blockCode).toHaveTextContent("single line of untagged code");
    expect(blockCode).not.toHaveClass("border-theme-code-inline-border");
    expect(blockCode).not.toHaveClass("bg-theme-code-inline-bg");
    expect(blockCode).not.toHaveAttribute("node");
  });

  it("switches fenced code blocks to Prism Dark+ in dark mode", () => {
    window.localStorage.setItem(THEME_MODE_LOCAL_STORAGE_KEY, "dark");

    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```javascript\nconst answer = 42;\n```")}
      />,
    );

    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toHaveAttribute(
      "style",
      expect.stringContaining("background: rgb(30, 30, 30);"),
    );
    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toHaveAttribute(
      "style",
      expect.stringContaining("color: rgb(212, 212, 212);"),
    );
  });

  it("uses the same code block contract for raw markdown view", () => {
    const { container } = renderWithTheme(
      <MessageContent content={textContent("`code`")} showRaw />,
    );

    expect(
      container.querySelector("pre.message-content-raw-block"),
    ).toHaveClass("whitespace-pre-wrap");
  });

  it("renders distinct text content parts with paragraph spacing between them", () => {
    renderWithTheme(
      <MessageContent
        content={multipleTextContent("First text part.", "Second text part.")}
      />,
    );

    const paragraphs = screen.getAllByText(/text part\./);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].tagName).toBe("P");
    expect(paragraphs[1].tagName).toBe("P");
  });

  it("can preserve soft line breaks while keeping markdown lists", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("First line\nSecond line\n\n- One\n- Two")}
        preserveSoftLineBreaks
      />,
    );

    expect(container.querySelector("article")).toHaveClass(
      "whitespace-pre-wrap",
    );
    expect(screen.getByText(/First line\s+Second line/).tagName).toBe("P");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("One").tagName).toBe("LI");
    expect(screen.getByText("Two").tagName).toBe("LI");
  });

  it("renders cold-load reasoning behind a 'Thought for' pill that toggles the timeline", () => {
    renderWithTheme(
      <MessageContent
        createdAt="2026-05-07T12:00:00Z"
        updatedAt="2026-05-07T12:00:23Z"
        content={[
          reasoningContent("I checked the input and compared options."),
          { content_type: "text", text: "Final answer." },
        ]}
      />,
    );

    const pill = screen.getByRole("button", { name: /Thought for 23s/ });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Final answer.")).toBeInTheDocument();

    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
  });

  it("labels the cold-load pill 'Stopped after X' when the message has an error", () => {
    renderWithTheme(
      <MessageContent
        createdAt="2026-05-07T12:00:00Z"
        updatedAt="2026-05-07T12:00:05Z"
        hasError
        content={[reasoningContent("Tried to think about it.")]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Stopped after 5s/ }),
    ).toBeInTheDocument();
  });

  it("renders the cold-load pill without a duration when timestamps are missing", () => {
    renderWithTheme(
      <MessageContent content={[reasoningContent("I checked the input.")]} />,
    );

    expect(
      screen.getByRole("button", { name: /^Thought$/ }),
    ).toBeInTheDocument();
  });

  it("prefers trace-part timing over message timestamps", () => {
    renderWithTheme(
      <MessageContent
        createdAt="2026-05-07T12:00:00Z"
        updatedAt="2026-05-07T12:00:30Z"
        content={[
          reasoningContent(
            "I checked the input.",
            "2026-05-07T12:00:00Z",
            "2026-05-07T12:00:01Z",
          ),
          toolUseContent({
            startedAt: "2026-05-07T12:00:10Z",
            endedAt: "2026-05-07T12:00:15Z",
          }),
          { content_type: "text", text: "Final answer." },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Thought for 6s/ }),
    ).toBeInTheDocument();
  });

  it("streams reasoning expanded and collapses it once answer text arrives", () => {
    const { rerender } = renderWithTheme(
      <MessageContent
        isStreaming
        content={[reasoningContent("Inspecting context")]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Inspecting context" }),
    ).toHaveAttribute("aria-expanded", "true");

    rerender(
      <I18nProvider i18n={i18n}>
        <StaticFeatureConfigProvider>
          <ThemeProvider>
            <MessageContent
              isStreaming
              content={[
                reasoningContent("Inspecting context"),
                { content_type: "text", text: "Final answer" },
              ]}
            />
          </ThemeProvider>
        </StaticFeatureConfigProvider>
      </I18nProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Inspecting context" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Final answer/)).toBeInTheDocument();
  });

  it("preserves reasoning and text ordering from content parts", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={[
          { content_type: "text", text: "First answer part." },
          reasoningContent("Second reasoning part."),
          { content_type: "text", text: "Third answer part." },
        ]}
      />,
    );

    const articleText = container.querySelector("article")?.textContent ?? "";
    expect(articleText.indexOf("First answer part.")).toBeLessThan(
      articleText.indexOf("Second reasoning part."),
    );
    expect(articleText.indexOf("Second reasoning part.")).toBeLessThan(
      articleText.indexOf("Third answer part."),
    );
  });

  it("passes PDF page anchors through to the preview callback for erato-file links", () => {
    const onFileLinkPreview = vi.fn();
    const file = makeFile();

    renderWithTheme(
      <MessageContent
        content={textContent("[Link](erato-file://file_123#page=4)")}
        filesById={{ [file.id]: file }}
        onFileLinkPreview={onFileLinkPreview}
      />,
    );

    fireEvent.click(screen.getByText("Link"));

    expect(onFileLinkPreview).toHaveBeenCalledTimes(1);
    expect(onFileLinkPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "file_123",
        preview_url:
          "https://files.example.com/preview/sample-report-compressed.pdf#page=4",
      }),
    );
  });

  it("resolves preview-only erato-file links without requiring a download url", () => {
    const onFileLinkPreview = vi.fn();
    const file = makeFile({
      download_url: "",
    });

    renderWithTheme(
      <MessageContent
        content={textContent("[Link](erato-file://file_123#page=4)")}
        filesById={{ [file.id]: file }}
        onFileLinkPreview={onFileLinkPreview}
      />,
    );

    fireEvent.click(screen.getByText("Link"));

    expect(onFileLinkPreview).toHaveBeenCalledTimes(1);
    expect(onFileLinkPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "file_123",
        download_url: "",
        preview_url:
          "https://files.example.com/preview/sample-report-compressed.pdf#page=4",
      }),
    );
  });

  it("does not use download URLs for erato-file previews", () => {
    const onFileLinkPreview = vi.fn();
    const file = makeFile({
      preview_url: undefined,
    });

    renderWithTheme(
      <MessageContent
        content={textContent("[Link](erato-file://file_123#page=4)")}
        filesById={{ [file.id]: file }}
        onFileLinkPreview={onFileLinkPreview}
      />,
    );

    const link = screen.getByRole("link", { name: "Link" });

    expect(link).toHaveAttribute("href", "erato-file://file_123#page=4");

    fireEvent.click(link);
    expect(onFileLinkPreview).not.toHaveBeenCalled();
  });

  it("keeps inaccessible erato-file links previewable so the modal can explain the permission issue", () => {
    const onFileLinkPreview = vi.fn();
    const file = makeFile({
      download_url: "",
      preview_url: undefined,
      file_contents_unavailable_missing_permissions: true,
    });

    renderWithTheme(
      <MessageContent
        content={textContent("[Link](erato-file://file_123)")}
        filesById={{ [file.id]: file }}
        onFileLinkPreview={onFileLinkPreview}
      />,
    );

    fireEvent.click(screen.getByText("Link"));

    expect(onFileLinkPreview).toHaveBeenCalledTimes(1);
    expect(onFileLinkPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "file_123",
        file_contents_unavailable_missing_permissions: true,
      }),
    );
  });

  it("renders inline markdown image links that point to erato-file URLs", () => {
    const onImageClick = vi.fn();
    const imageFile = makeFile({
      id: "dog_123",
      filename: "dog.png",
      download_url: "https://files.example.com/downloads/dog.png",
      preview_url: "https://files.example.com/preview/dog.png",
      file_capability: FileTypeUtil.createMockFileCapability("dog.png"),
    });

    renderWithTheme(
      <MessageContent
        content={textContent("![Generated dog](erato-file://dog_123)")}
        filesById={{ [imageFile.id]: imageFile }}
        onImageClick={onImageClick}
      />,
    );

    const image = screen.getByRole("img", { name: "Generated dog" });

    expect(image).toHaveAttribute(
      "src",
      "https://files.example.com/preview/dog.png",
    );

    fireEvent.click(image);
    expect(onImageClick).toHaveBeenCalledTimes(1);
    expect(onImageClick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dog_123",
        fileUploadId: "dog_123",
      }),
    );
  });

  it("adds #unresolved-link when an inline erato-file markdown image cannot be resolved", () => {
    renderWithTheme(
      <MessageContent
        content={textContent("![Missing](erato-file://missing_image)")}
        filesById={{}}
      />,
    );

    const unresolvedLink = screen.getByRole("link", { name: "Missing" });

    expect(unresolvedLink).toHaveAttribute(
      "href",
      "erato-file://missing_image#unresolved-link",
    );
  });

  it("keeps external links opening in a new tab", () => {
    renderWithTheme(
      <MessageContent
        content={textContent("[External](https://example.com/docs)")}
      />,
    );

    const link = screen.getByRole("link", { name: "External" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders erato-email code blocks as EratoEmailSuggestion instead of syntax highlighter", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "```erato-email\nHere is a rewritten version of your email.\n```",
        )}
      />,
    );

    // Should NOT render as a syntax-highlighted code block
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toBeNull();

    // Should render the suggestion text
    expect(screen.getByText(/Here is a rewritten version/)).toBeInTheDocument();

    // Should have a Copy button
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
  });

  it("still renders other hyphenated language tags as code blocks", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "```objective-c\n#import <Foundation/Foundation.h>\n```",
        )}
      />,
    );

    expect(
      container.querySelector("pre.message-content-code-block"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toHaveTextContent(/#import/);
  });

  it("treats a drifted email fence as the artifact when an Outlook facet produced the message", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```email\nHere is the rewritten passage.\n```")}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "text",
          renderMode: "body",
        }}
      />,
    );

    // Rendered as the insert/replace artifact, not a syntax-highlighted block.
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toBeNull();
    expect(
      screen.getByText(/Here is the rewritten passage/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
  });

  it("does NOT treat an email-ish fence as the artifact without facet context", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```email\nnot an outlook artifact\n```")}
      />,
    );

    // No facet → stays an ordinary code block, no insert/replace UI.
    // The code block does have its own copy button, but NOT the email artifact UI.
    expect(
      container.querySelector("pre.message-content-code-block"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copy code/ }),
    ).toBeInTheDocument();
  });

  it("renders a drifted email fence as HTML when the facet body_format is html", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```email\n<b>Bold reply</b>\n```")}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "html",
          renderMode: "body",
        }}
      />,
    );

    // body_format drives HTML rendering even though the tag isn't `-html`.
    expect(container.querySelector("b")).toHaveTextContent("Bold reply");
  });

  it("falls back to the whole body as the artifact for an unfenced rewrite_selection response", () => {
    renderWithTheme(
      <MessageContent
        content={textContent(
          "Hallo Frau Berger,\n\nvielen Dank fuer Ihre Nachricht.",
        )}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "text",
          renderMode: "body",
        }}
      />,
    );

    // The unfenced email still gets the insert/replace UI.
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText(/vielen Dank/)).toBeInTheDocument();
  });

  it("renders ONE whole-body artifact from the joined text across multiple text parts", () => {
    renderWithTheme(
      <MessageContent
        content={multipleTextContent(
          "Hallo Frau Berger,",
          "vielen Dank fuer Ihre Nachricht.",
        )}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "text",
          renderMode: "body",
        }}
      />,
    );

    // A single artifact (one Copy button), not one per text part, and it
    // carries the full joined body rather than only the first fragment.
    expect(screen.getAllByRole("button", { name: /Copy/ })).toHaveLength(1);
    expect(screen.getByText(/Hallo Frau Berger/)).toBeInTheDocument();
    expect(screen.getByText(/vielen Dank/)).toBeInTheDocument();
  });

  it("keeps the whole-body artifact fallback fast for newline-heavy unfenced text", () => {
    renderWithTheme(
      <MessageContent
        content={textContent(`Hallo Frau Berger,${"\n".repeat(20_000)}`)}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "text",
          renderMode: "body",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText(/Hallo Frau Berger/)).toBeInTheDocument();
  });

  it("does NOT whole-body-fallback when the response contains an indented markdown fence", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("  ```email\nHere is the rewritten passage.\n```")}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "text",
          renderMode: "body",
        }}
      />,
    );

    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toBeNull();
    expect(
      screen.getByText(/Here is the rewritten passage/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
  });

  it("does NOT whole-body-fallback for review_draft (feedback stays markdown)", () => {
    renderWithTheme(
      <MessageContent
        content={textContent(
          "Your draft looks good. Consider a shorter intro.",
        )}
        outlookArtifact={{
          facetId: "outlook_review_draft",
          bodyFormat: "text",
          renderMode: "suggestions",
        }}
      />,
    );

    // review_draft is feedback, not a single drop-in body — no artifact UI.
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(screen.getByText(/Consider a shorter intro/).tagName).toBe("P");
  });

  it("does NOT whole-body-fallback while the message is still streaming", () => {
    renderWithTheme(
      <MessageContent
        isStreaming
        content={textContent("Hallo Frau Berger, vielen Dank")}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "text",
          renderMode: "body",
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
  });

  it("renders the artifact for an unknown facet id as long as renderMode is body (id-agnostic)", () => {
    renderWithTheme(
      <MessageContent
        content={textContent("Hallo, hier ist die kurze Email.")}
        outlookArtifact={{
          facetId: "compose_email",
          bodyFormat: "text",
          renderMode: "body",
        }}
      />,
    );

    // A facet added only in config (no frontend id allowlist) still renders.
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText(/kurze Email/)).toBeInTheDocument();
  });

  it("does NOT whole-body-fallback for a client-action facet (reply) with no proposed action", () => {
    renderWithTheme(
      <MessageContent
        content={textContent(
          "It is a long thread about several tickets. The latest message is from Jakob.",
        )}
        outlookArtifact={{
          facetId: "outlook_reply_from_read",
          bodyFormat: "html",
          renderMode: "body",
          allowedClientActions: ["outlook.reply", "outlook.reply_all"],
          // The producer (AddinChat) stamps suppression for an ambient reply
          // facet that produced a plain answer (offerable actions but no
          // proposal). The gate reads this single verdict.
          shouldRenderEmailCard: false,
        }}
      />,
    );

    // The reply facet is attached ambiently to every read-mode message; a plain
    // summary (no fence, suppressed by the producer) must NOT become an email card.
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(screen.getByText(/latest message is from Jakob/).tagName).toBe("P");
  });

  it("DOES whole-body-fallback for a reply facet when the model proposed a client action", () => {
    renderWithTheme(
      <MessageContent
        content={textContent(
          "Hallo Herr Wolf-Sebottendorff,\n\nvielen Dank fuer das Update.",
        )}
        outlookArtifact={{
          facetId: "outlook_reply_from_read",
          bodyFormat: "html",
          renderMode: "body",
          allowedClientActions: ["outlook.reply", "outlook.reply_all"],
          proposedClientAction: "outlook.reply",
          // The producer did NOT suppress (the model proposed), so the
          // verdict is absent → the gate defaults to card. The proposal field
          // itself is not read by the gate; it is the producer's reason.
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText(/vielen Dank/)).toBeInTheDocument();
  });

  it("still cards a FENCED reply draft for a client-action facet even without a proposed action", () => {
    renderWithTheme(
      <MessageContent
        content={textContent("```erato-email\nHallo, anbei mein Entwurf.\n```")}
        outlookArtifact={{
          facetId: "outlook_reply_from_read",
          bodyFormat: "html",
          renderMode: "body",
          allowedClientActions: ["outlook.reply", "outlook.reply_all"],
          // Even with the producer's verdict set to SUPPRESS, a fenced draft
          // must still card: the fence path runs ahead of the whole-body gate.
          shouldRenderEmailCard: false,
        }}
      />,
    );

    // A fenced draft routes through the fenced-block path, never the whole-body
    // gate, so the suppression verdict must not reach it.
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText(/anbei mein Entwurf/)).toBeInTheDocument();
  });

  it("treats an empty allowedClientActions list as a non-client-action facet (still cards)", () => {
    renderWithTheme(
      <MessageContent
        content={textContent("Hallo Frau Berger,\n\nvielen Dank.")}
        outlookArtifact={{
          facetId: "outlook_rewrite_selection",
          bodyFormat: "text",
          renderMode: "body",
          allowedClientActions: [],
        }}
      />,
    );

    // A non-suppressed artifact (the producer stamps nothing for a compose /
    // rewrite facet, so the flag is absent → defaults to card).
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText(/vielen Dank/)).toBeInTheDocument();
  });

  describe("showRaw with maskReasoningTraceText", () => {
    it("includes reasoning text in raw view when masking is disabled", () => {
      const { container } = render(
        <StaticFeatureConfigProvider
          config={{ trace: { maskReasoningText: false } }}
        >
          <ThemeProvider>
            <MessageContent
              content={[
                {
                  content_type: "reasoning" as const,
                  text: "secret model reasoning",
                },
                { content_type: "text" as const, text: "Final answer" },
              ]}
              showRaw
            />
          </ThemeProvider>
        </StaticFeatureConfigProvider>,
      );

      const rawBlock = container.querySelector("pre.message-content-raw-block");
      expect(rawBlock).toHaveTextContent("secret model reasoning");
      expect(rawBlock).toHaveTextContent("Final answer");
    });

    it("omits reasoning text in raw view when masking is enabled", () => {
      const { container } = render(
        <StaticFeatureConfigProvider
          config={{ trace: { maskReasoningText: true } }}
        >
          <ThemeProvider>
            <MessageContent
              content={[
                {
                  content_type: "reasoning" as const,
                  text: "secret model reasoning",
                },
                { content_type: "text" as const, text: "Final answer" },
              ]}
              showRaw
            />
          </ThemeProvider>
        </StaticFeatureConfigProvider>,
      );

      const rawBlock = container.querySelector("pre.message-content-raw-block");
      expect(rawBlock).not.toHaveTextContent("secret model reasoning");
      expect(rawBlock).toHaveTextContent("Final answer");
    });
  });
});
