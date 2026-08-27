import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadTooLargeError } from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { messages as enMessages } from "@/locales/en/messages.json";

import { FileUploadWithTokenCheck } from "../FileUploadWithTokenCheck";

import type { Messages } from "@lingui/core";

const uploadError = new UploadTooLargeError("50 MB");

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useCloudProvidersFeature: () => ({ availableProviders: [] }),
  useUploadFeature: () => ({
    maxSizeBytes: 50 * 1024 * 1024,
    maxSizeFormatted: "50 MB",
  }),
  useErrorReportFeature: () => ({
    showVerboseAssistantErrors: false,
    showCopyErrorReport: false,
    errorReportTemplate: "",
    environment: "test",
    platform: "web",
  }),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useCreateChat: () => ({ mutateAsync: vi.fn() }),
  useLinkFile: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/files/useFileUploadWithTokenCheck", () => ({
  useFileUploadWithTokenCheck: () => ({
    uploadFiles: vi.fn(),
    isUploading: false,
    isEstimating: false,
    uploadError,
    exceedsTokenLimit: false,
  }),
}));

describe("FileUploadWithTokenCheck", () => {
  beforeEach(() => {
    useFileUploadStore.getState().setError(uploadError);
  });

  it("keeps the file picker usable while an upload error is pending", async () => {
    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");

    const { container } = render(
      <I18nProvider i18n={i18n}>
        <FileUploadWithTokenCheck message="" />
      </I18nProvider>,
    );

    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Upload Files" })).toBeEnabled();
    expect(screen.queryByText(uploadError.message)).toBeNull();
  });
});
