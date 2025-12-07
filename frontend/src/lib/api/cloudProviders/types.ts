/**
 * Provider-agnostic types for cloud storage file pickers
 *
 * These types provide a common interface for different cloud storage providers
 * (Sharepoint/OneDrive, Google Drive, etc.)
 */

/**
 * Supported cloud storage providers
 */
export type CloudProvider = "sharepoint" | "googledrive";

/**
 * A cloud storage drive (OneDrive, Google Drive, Sharepoint Document Library, etc.)
 */
export interface CloudDrive {
  id: string;
  name: string;
  drive_type: string; // "personal", "documentLibrary", "shared", etc.
  owner_name?: string;
  provider: CloudProvider;
}

/**
 * An item in a cloud drive (file or folder)
 */
export interface CloudItem {
  id: string;
  name: string;
  is_folder: boolean;
  size?: number; // bytes, for files only
  mime_type?: string; // for files only
  last_modified?: string; // ISO date-time
  web_url?: string;
  provider: CloudProvider;
  drive_id: string; // The drive this item belongs to
}

/**
 * Response from all-drives endpoint
 */
export interface CloudDrivesResponse {
  drives: CloudDrive[];
}

/**
 * Response from drive items endpoints
 */
export interface CloudItemsResponse {
  items: CloudItem[];
}

/**
 * Response for a single drive item
 */
export interface CloudItemResponse extends CloudItem {
  drive_id: string;
}

/**
 * Selected file metadata for file linking
 */
export interface SelectedCloudFile {
  drive_id: string;
  item_id: string;
  name: string;
  mime_type?: string;
  size?: number;
  provider: CloudProvider;
}

/**
 * Request to link a cloud file
 */
export interface LinkCloudFileRequest {
  source: CloudProvider;
  chat_id?: string;
  provider_metadata: {
    drive_id: string;
    item_id: string;
  };
}

/**
 * Navigation breadcrumb segment
 */
export interface BreadcrumbSegment {
  id: string;
  name: string;
  type: "drive" | "folder";
}

/**
 * Cloud provider API interface
 */
export interface CloudProviderAPI {
  /**
   * Get all drives accessible to the user
   */
  getAllDrives(): Promise<CloudDrivesResponse>;

  /**
   * Get root items of a specific drive
   */
  getDriveRoot(driveId: string): Promise<CloudItemsResponse>;

  /**
   * Get details of a specific drive item
   */
  getDriveItem(driveId: string, itemId: string): Promise<CloudItemResponse>;

  /**
   * Get children of a folder
   */
  getDriveItemChildren(
    driveId: string,
    itemId: string,
  ): Promise<CloudItemsResponse>;

  /**
   * Link selected files to create file upload records
   */
  linkFiles(
    files: SelectedCloudFile[],
    chatId?: string,
  ): Promise<{ id: string; filename: string; download_url: string }[]>;
}
