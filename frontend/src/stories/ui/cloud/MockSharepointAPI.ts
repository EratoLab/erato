/**
 * Mock Sharepoint API for Storybook
 *
 * Provides a simulated CloudProviderAPI implementation using mock data
 */

import {
  mockDrives,
  getMockItemsByDriveId,
  getMockItemsByFolderId,
  mockEmptyFolderItems,
  mockItemsWithUnsupportedTypes,
} from "./mockCloudData";

import type {
  CloudProviderAPI,
  CloudDrivesResponse,
  CloudItemsResponse,
  CloudItemResponse,
  SelectedCloudFile,
} from "@/lib/api/cloudProviders/types";

export type MockScenario =
  | "default"
  | "empty"
  | "loading"
  | "error"
  | "unsupported-types";

export class MockSharepointAPI implements CloudProviderAPI {
  private scenario: MockScenario;
  private delay: number;

  constructor(scenario: MockScenario = "default", delay: number = 500) {
    this.scenario = scenario;
    this.delay = delay;
  }

  private async simulateDelay(): Promise<void> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
  }

  async getAllDrives(): Promise<CloudDrivesResponse> {
    await this.simulateDelay();

    if (this.scenario === "error") {
      throw new Error("Failed to fetch drives from server");
    }

    if (this.scenario === "empty") {
      return { drives: [] };
    }

    return {
      drives: mockDrives.map((drive) => ({
        ...drive,
        provider: "sharepoint" as const,
      })),
    };
  }

  async getDriveRoot(driveId: string): Promise<CloudItemsResponse> {
    await this.simulateDelay();

    if (this.scenario === "error") {
      throw new Error("Failed to fetch drive items");
    }

    if (this.scenario === "unsupported-types") {
      return {
        items: mockItemsWithUnsupportedTypes.map((item) => ({
          ...item,
          provider: "sharepoint" as const,
          drive_id: driveId,
        })),
      };
    }

    const items = getMockItemsByDriveId(driveId);

    return {
      items: items.map((item) => ({
        ...item,
        provider: "sharepoint" as const,
        drive_id: driveId,
      })),
    };
  }

  async getDriveItem(
    driveId: string,
    itemId: string,
  ): Promise<CloudItemResponse> {
    await this.simulateDelay();

    if (this.scenario === "error") {
      throw new Error("Failed to fetch drive item");
    }

    // For mock purposes, we'll just return a basic item
    return {
      id: itemId,
      name: "Item",
      is_folder: true,
      provider: "sharepoint" as const,
      drive_id: driveId,
    };
  }

  async getDriveItemChildren(
    driveId: string,
    itemId: string,
  ): Promise<CloudItemsResponse> {
    await this.simulateDelay();

    if (this.scenario === "error") {
      throw new Error("Failed to fetch folder children");
    }

    if (this.scenario === "empty") {
      return {
        items: mockEmptyFolderItems.map((item) => ({
          ...item,
          provider: "sharepoint" as const,
          drive_id: driveId,
        })),
      };
    }

    const items = getMockItemsByFolderId(itemId);

    return {
      items: items.map((item) => ({
        ...item,
        provider: "sharepoint" as const,
        drive_id: driveId,
      })),
    };
  }

  async linkFiles(
    files: SelectedCloudFile[],
    _chatId?: string,
  ): Promise<{ id: string; filename: string; download_url: string }[]> {
    await this.simulateDelay();

    if (this.scenario === "error") {
      throw new Error("Failed to link files");
    }

    // Mock successful linking
    return files.map((file, index) => ({
      id: `mock-file-${index}`,
      filename: file.name,
      download_url: `https://mock.sharepoint.com/download/${file.item_id}`,
    }));
  }
}
