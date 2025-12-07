/**
 * Sharepoint/OneDrive API client
 *
 * Provider-specific implementation of the CloudProviderAPI interface
 */

import type {
  CloudProvider,
  CloudProviderAPI,
  CloudDrivesResponse,
  CloudItemsResponse,
  CloudItemResponse,
  SelectedCloudFile,
} from "./types";

/**
 * Sharepoint/OneDrive specific types from backend
 */
interface SharepointDrive {
  id: string;
  name: string;
  drive_type: string;
  owner_name?: string;
}

interface SharepointDriveItem {
  id: string;
  name: string;
  is_folder: boolean;
  size?: number;
  mime_type?: string;
  last_modified?: string;
  web_url?: string;
}

interface SharepointAllDrivesResponse {
  drives: SharepointDrive[];
}

interface SharepointDriveItemsResponse {
  items: SharepointDriveItem[];
}

interface SharepointDriveItemResponse extends SharepointDriveItem {
  drive_id: string;
}

/**
 * Sharepoint API client implementation
 */
export class SharepointAPI implements CloudProviderAPI {
  private readonly provider: CloudProvider = "sharepoint";
  private readonly baseUrl: string;

  constructor(
    // eslint-disable-next-line lingui/no-unlocalized-strings
    baseUrl: string = "/api/v1beta/integrations/sharepoint",
  ) {
    this.baseUrl = baseUrl;
  }

  async getAllDrives(): Promise<CloudDrivesResponse> {
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const response = await fetch(`${this.baseUrl}/all-drives`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch drives: ${response.statusText}`);
    }

    const data: SharepointAllDrivesResponse = await response.json();

    return {
      drives: data.drives.map((drive) => ({
        ...drive,
        provider: this.provider,
      })),
    };
  }

  async getDriveRoot(driveId: string): Promise<CloudItemsResponse> {
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const response = await fetch(`${this.baseUrl}/drives/${driveId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch drive root: ${response.statusText}`);
    }

    const data: SharepointDriveItemsResponse = await response.json();

    return {
      items: data.items.map((item) => ({
        ...item,
        provider: this.provider,
        drive_id: driveId,
      })),
    };
  }

  async getDriveItem(
    driveId: string,
    itemId: string,
  ): Promise<CloudItemResponse> {
    const response = await fetch(
      // eslint-disable-next-line lingui/no-unlocalized-strings
      `${this.baseUrl}/drives/${driveId}/items/${itemId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch drive item: ${response.statusText}`);
    }

    const data: SharepointDriveItemResponse = await response.json();

    return {
      ...data,
      provider: this.provider,
    };
  }

  async getDriveItemChildren(
    driveId: string,
    itemId: string,
  ): Promise<CloudItemsResponse> {
    const response = await fetch(
      // eslint-disable-next-line lingui/no-unlocalized-strings
      `${this.baseUrl}/drives/${driveId}/items/${itemId}/children`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch folder children: ${response.statusText}`,
      );
    }

    const data: SharepointDriveItemsResponse = await response.json();

    return {
      items: data.items.map((item) => ({
        ...item,
        provider: this.provider,
        drive_id: driveId,
      })),
    };
  }

  async linkFiles(
    files: SelectedCloudFile[],
    chatId?: string,
  ): Promise<{ id: string; filename: string; download_url: string }[]> {
    const results = [];

    for (const file of files) {
      // eslint-disable-next-line lingui/no-unlocalized-strings
      const response = await fetch("/api/v1beta/me/files/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          source: "sharepoint",
          chat_id: chatId,
          provider_metadata: {
            drive_id: file.drive_id,
            item_id: file.item_id,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to link file ${file.name}: ${response.statusText}`,
        );
      }

      const data: {
        files: { id: string; filename: string; download_url: string }[];
      } = await response.json();

      results.push(...data.files);
    }

    return results;
  }
}
