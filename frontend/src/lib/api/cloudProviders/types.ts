/**
 * Provider-agnostic types for cloud storage file pickers
 *
 * These types extend the generated API types with provider information
 * Most data types come from the generated schema (@/lib/generated/v1betaApi)
 */

import type {
  Drive,
  DriveItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Supported cloud storage providers
 */
export type CloudProvider = "sharepoint" | "googledrive";

/**
 * A cloud storage drive with provider information
 * Extends the generated Drive type with provider field
 */
export type CloudDrive = Drive & { provider: CloudProvider };

/**
 * A cloud drive item with provider and drive information
 * Extends the generated DriveItem type with provider and drive_id fields
 */
export type CloudItem = DriveItem & {
  provider: CloudProvider;
  drive_id: string;
};

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
 * Navigation breadcrumb segment
 */
export interface BreadcrumbSegment {
  id: string;
  name: string;
  type: "drive" | "folder";
}
