import { userEvent, within } from "@storybook/test";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { distributionQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import DesktopSidecarSetupPage from "@/pages/DesktopSidecarSetupPage";

import type {
  DesktopSidecarDistributionFileResponse,
  DesktopSidecarDistributionResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

function artifact(
  id: string,
  kind: string,
  filename: string,
): DesktopSidecarDistributionFileResponse {
  return {
    id,
    kind,
    download_filename: filename,
    media_type: "application/octet-stream",
    size: 25 * 1024 * 1024,
  };
}

const distribution: DesktopSidecarDistributionResponse = {
  targets: [
    {
      id: "windows-x86_64",
      platform: { os: "windows", architecture: "x86_64", abi: "msvc" },
      default_file: "installer",
      files: [
        artifact(
          "installer",
          "installer",
          "erato-desktop-sidecar-windows-x86_64.exe",
        ),
        artifact(
          "msi",
          "installer",
          "erato-desktop-sidecar-windows-x86_64.msi",
        ),
        artifact(
          "intunewin",
          "intunewin",
          "erato-desktop-sidecar-windows-x86_64.intunewin",
        ),
      ],
    },
    ...["aarch64", "x86_64"].map((architecture) => ({
      id: `macos-${architecture}`,
      platform: { os: "macos", architecture, abi: "darwin" },
      default_file: "application",
      files: [
        artifact(
          "application",
          "application_archive",
          `erato-desktop-sidecar-macos-${architecture}.app.zip`,
        ),
        artifact(
          "dmg",
          "installer",
          `erato-desktop-sidecar-macos-${architecture}.dmg`,
        ),
        artifact(
          "pkg",
          "installer",
          `erato-desktop-sidecar-macos-${architecture}.pkg`,
        ),
      ],
    })),
    {
      id: "linux-x86_64",
      platform: { os: "linux", architecture: "x86_64", abi: "gnu" },
      default_file: "archive",
      files: [
        artifact(
          "archive",
          "archive",
          "erato-desktop-sidecar-linux-x86_64.tar.gz",
        ),
        artifact(
          "executable",
          "executable",
          "erato-desktop-sidecar-linux-x86_64",
        ),
      ],
    },
  ],
};

function SeedDistribution({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useState(() => {
    queryClient.setQueryData(distributionQuery({}).queryKey, distribution);
  });
  return <>{children}</>;
}

const meta = {
  title: "Pages/DesktopSidecarSetup",
  component: DesktopSidecarSetupPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <SeedDistribution>
        <Story />
      </SeedDistribution>
    ),
  ],
} satisfies Meta<typeof DesktopSidecarSetupPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Windows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Windows" }),
    );
  },
};

export const MacOS: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "macOS" }));
  },
};

export const Linux: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Linux" }));
  },
};
