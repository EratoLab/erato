import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messageAttachmentFileIds } from "@/components/ui/Chat/messageAttachmentFileIds";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { MessageContent } from "../MessageContent";

import type {
  ContentPart,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { Messages } from "@lingui/core";
import type { ComponentProps } from "react";

// The view itself is covered by its own tests; here it shows on a click.
vi.mock("@/components/ui/ToolCall/McpAppView", () => ({
  McpAppView: ({ onShown }: { onShown?: () => void }) => (
    <button type="button" data-testid="mcp-app-view" onClick={onShown}>
      show the view
    </button>
  ),
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const CHART_ID = "0b5d6c1e-1f7a-4c55-9d7e-2b8f3a1c4d5e";

const chart: FileUploadItem = {
  id: CHART_ID,
  filename: "chart.png",
  download_url: "https://files.example.com/downloads/chart.png",
  preview_url: "https://files.example.com/preview/chart.png",
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  file_capability: FileTypeUtil.createMockFileCapability("chart.png"),
};

/** A call with a view whose stored output names the chart it returned. */
const callWithView = (withView = true): ContentPart =>
  ({
    content_type: "tool_use",
    tool_call_id: "call-chart",
    tool_name: "render_chart",
    status: "success",
    input: {},
    output: {
      success: true,
      files: [
        { file_name: "chart.png", data_base64: `erato-file://${CHART_ID}` },
      ],
    },
    result_details: withView
      ? { view: { server_id: "charts", uri: "ui://chart/view.html" } }
      : undefined,
  }) as unknown as ContentPart;

const CSV_ID = "5e2a9c71-3d4b-4f8e-a6c0-7b1d2e3f4a5b";

const rows: FileUploadItem = {
  id: CSV_ID,
  filename: "rows.csv",
  download_url: "https://files.example.com/downloads/rows.csv",
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  file_capability: FileTypeUtil.createMockFileCapability("rows.csv"),
};

const chartImage: ContentPart = {
  content_type: "image_file_pointer",
  file_upload_id: CHART_ID,
  preview_url: chart.preview_url,
  download_url: chart.download_url,
};

const ui = (props: Partial<ComponentProps<typeof MessageContent>> = {}) => (
  <I18nProvider i18n={i18n}>
    <StaticFeatureConfigProvider>
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider enableCustomTheme={false}>
          <MessageContent
            messageId="m1"
            content={[
              callWithView(),
              chartImage,
              { content_type: "text", text: "Here is the chart." },
            ]}
            filesById={{ [CHART_ID]: chart }}
            {...props}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </StaticFeatureConfigProvider>
  </I18nProvider>
);

const fullImage = () =>
  document.querySelector(`img[src="${chart.preview_url}"]`);

describe("MessageContent with a tool call's view", () => {
  it("shows the call's files as they are until the view shows, then as file chips instead of a second full image", () => {
    const onFileLinkPreview = vi.fn();
    render(ui({ onFileLinkPreview }));

    expect(fullImage()).not.toBeNull();
    expect(screen.queryByText("chart.png")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-app-view"));

    expect(fullImage()).toBeNull();
    const chip = screen.getByRole("button", { name: /chart\.png/ });
    fireEvent.click(chip);
    expect(onFileLinkPreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHART_ID }),
    );
  });

  it("chips only the call's images: another file it returned stays in the message's attachments alone", () => {
    const call = callWithView() as ContentPart & {
      output: { files: unknown[] };
    };
    call.output.files.push({
      file_name: "rows.csv",
      data_base64: `erato-file://${CSV_ID}`,
    });
    const content: ContentPart[] = [
      call,
      chartImage,
      { content_type: "text_file_pointer", file_upload_id: CSV_ID },
      { content_type: "text", text: "Here is the chart." },
    ];
    render(ui({ content, filesById: { [CHART_ID]: chart, [CSV_ID]: rows } }));

    fireEvent.click(screen.getByTestId("mcp-app-view"));

    expect(fullImage()).toBeNull();
    expect(screen.getByText("chart.png")).toBeInTheDocument();
    expect(screen.queryByText("rows.csv")).not.toBeInTheDocument();
    expect(
      messageAttachmentFileIds({
        role: "assistant",
        content,
      } as UiChatMessage),
    ).toEqual([CSV_ID]);
  });

  it("shows an image of the call's file in the answer as the same chip once the view shows", () => {
    const onFileLinkPreview = vi.fn();
    render(
      ui({
        content: [
          callWithView(),
          chartImage,
          {
            content_type: "text",
            text: `Here is the chart.\n\n![Revenue chart](erato-file://${CHART_ID})`,
          },
        ],
        onFileLinkPreview,
      }),
    );

    expect(
      document.querySelectorAll(`img[src="${chart.preview_url}"]`),
    ).toHaveLength(1);

    fireEvent.click(screen.getByTestId("mcp-app-view"));

    expect(fullImage()).toBeNull();
    const chips = screen.getAllByRole("button", { name: /chart\.png/ });
    // One under the view, one where the answer placed the image.
    expect(chips).toHaveLength(2);
    expect(chips[1].closest("p")).toBeNull();
    fireEvent.click(chips[1]);
    expect(onFileLinkPreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHART_ID }),
    );
  });

  it("keeps an image of the call's file in the answer full while no view shows", () => {
    const answer: ContentPart = {
      content_type: "text",
      text: `Here is the chart.\n\n![Revenue chart](erato-file://${CHART_ID})`,
    };
    render(ui({ content: [callWithView(false), chartImage, answer] }));

    expect(fullImage()).not.toBeNull();
    expect(screen.queryByText("chart.png")).not.toBeInTheDocument();
  });

  it("keeps the full image for a call without a view", () => {
    render(
      ui({
        content: [
          callWithView(false),
          chartImage,
          { content_type: "text", text: "Here is the chart." },
        ],
      }),
    );

    expect(screen.queryByTestId("mcp-app-view")).not.toBeInTheDocument();
    expect(fullImage()).not.toBeNull();
  });
});
