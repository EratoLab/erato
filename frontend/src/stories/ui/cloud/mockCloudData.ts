/**
 * Mock data for Cloud File Picker Storybook stories
 *
 * This provides realistic mock data for Sharepoint/OneDrive drives,
 * including various file types and folder structures.
 */

export interface MockDrive {
  id: string;
  name: string;
  drive_type: string;
  owner_name?: string;
}

export interface MockDriveItem {
  id: string;
  name: string;
  is_folder: boolean;
  size?: number;
  mime_type?: string;
  last_modified?: string;
  web_url?: string;
}

// Mock drives
export const mockDrives: MockDrive[] = [
  {
    id: "drive_personal_001",
    name: "My OneDrive",
    drive_type: "personal",
    owner_name: "John Doe",
  },
  {
    id: "drive_shared_001",
    name: "Sales Team Documents",
    drive_type: "documentLibrary",
    owner_name: "Sales Team",
  },
  {
    id: "drive_shared_002",
    name: "Engineering Resources",
    drive_type: "documentLibrary",
    owner_name: "Engineering",
  },
];

// Mock drive items for personal drive root
export const mockPersonalDriveItems: MockDriveItem[] = [
  // Folders first (alphabetical)
  {
    id: "folder_documents",
    name: "Documents",
    is_folder: true,
    last_modified: "2024-12-01T10:30:00Z",
    web_url: "https://onedrive.live.com/folder1",
  },
  {
    id: "folder_photos",
    name: "Photos",
    is_folder: true,
    last_modified: "2024-11-28T15:20:00Z",
    web_url: "https://onedrive.live.com/folder2",
  },
  {
    id: "folder_projects",
    name: "Projects",
    is_folder: true,
    last_modified: "2024-12-05T09:15:00Z",
    web_url: "https://onedrive.live.com/folder3",
  },
  // Files (alphabetical)
  {
    id: "file_budget_2024",
    name: "Budget_2024.xlsx",
    is_folder: false,
    size: 45678,
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    last_modified: "2024-11-30T14:22:00Z",
    web_url: "https://onedrive.live.com/file1",
  },
  {
    id: "file_meeting_notes",
    name: "Meeting Notes.docx",
    is_folder: false,
    size: 23456,
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    last_modified: "2024-12-06T11:45:00Z",
    web_url: "https://onedrive.live.com/file2",
  },
  {
    id: "file_presentation",
    name: "Q4 Presentation.pptx",
    is_folder: false,
    size: 1234567,
    mime_type:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    last_modified: "2024-12-04T16:30:00Z",
    web_url: "https://onedrive.live.com/file3",
  },
  {
    id: "file_readme",
    name: "README.txt",
    is_folder: false,
    size: 1024,
    mime_type: "text/plain",
    last_modified: "2024-11-15T08:00:00Z",
    web_url: "https://onedrive.live.com/file4",
  },
];

// Mock items for Documents folder
export const mockDocumentsFolderItems: MockDriveItem[] = [
  {
    id: "folder_contracts",
    name: "Contracts",
    is_folder: true,
    last_modified: "2024-11-20T10:00:00Z",
    web_url: "https://onedrive.live.com/folder4",
  },
  {
    id: "folder_reports",
    name: "Reports",
    is_folder: true,
    last_modified: "2024-12-01T09:30:00Z",
    web_url: "https://onedrive.live.com/folder5",
  },
  {
    id: "file_annual_report",
    name: "Annual Report 2023.pdf",
    is_folder: false,
    size: 2345678,
    mime_type: "application/pdf",
    last_modified: "2024-01-15T12:00:00Z",
    web_url: "https://onedrive.live.com/file5",
  },
  {
    id: "file_employee_handbook",
    name: "Employee Handbook.pdf",
    is_folder: false,
    size: 987654,
    mime_type: "application/pdf",
    last_modified: "2024-03-10T14:30:00Z",
    web_url: "https://onedrive.live.com/file6",
  },
  {
    id: "file_proposal",
    name: "Project Proposal.docx",
    is_folder: false,
    size: 156789,
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    last_modified: "2024-11-25T16:45:00Z",
    web_url: "https://onedrive.live.com/file7",
  },
];

// Mock items for Reports folder (deep nesting example)
export const mockReportsFolderItems: MockDriveItem[] = [
  {
    id: "file_q1_report",
    name: "Q1 Financial Report.xlsx",
    is_folder: false,
    size: 234567,
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    last_modified: "2024-04-01T10:00:00Z",
    web_url: "https://onedrive.live.com/file8",
  },
  {
    id: "file_q2_report",
    name: "Q2 Financial Report.xlsx",
    is_folder: false,
    size: 245678,
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    last_modified: "2024-07-01T10:00:00Z",
    web_url: "https://onedrive.live.com/file9",
  },
  {
    id: "file_q3_report",
    name: "Q3 Financial Report.xlsx",
    is_folder: false,
    size: 256789,
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    last_modified: "2024-10-01T10:00:00Z",
    web_url: "https://onedrive.live.com/file10",
  },
];

// Mock items for Photos folder
export const mockPhotosFolderItems: MockDriveItem[] = [
  {
    id: "folder_vacation_2024",
    name: "Vacation 2024",
    is_folder: true,
    last_modified: "2024-08-15T12:00:00Z",
    web_url: "https://onedrive.live.com/folder6",
  },
  {
    id: "file_photo1",
    name: "team_photo.jpg",
    is_folder: false,
    size: 3456789,
    mime_type: "image/jpeg",
    last_modified: "2024-11-10T14:20:00Z",
    web_url: "https://onedrive.live.com/file11",
  },
  {
    id: "file_photo2",
    name: "office_view.png",
    is_folder: false,
    size: 2345678,
    mime_type: "image/png",
    last_modified: "2024-10-22T09:30:00Z",
    web_url: "https://onedrive.live.com/file12",
  },
];

// Mock items with unsupported file types
export const mockItemsWithUnsupportedTypes: MockDriveItem[] = [
  {
    id: "file_supported_pdf",
    name: "Supported Document.pdf",
    is_folder: false,
    size: 123456,
    mime_type: "application/pdf",
    last_modified: "2024-12-01T10:00:00Z",
    web_url: "https://onedrive.live.com/file13",
  },
  {
    id: "file_unsupported_exe",
    name: "installer.exe",
    is_folder: false,
    size: 5678901,
    mime_type: "application/x-msdownload",
    last_modified: "2024-11-20T15:30:00Z",
    web_url: "https://onedrive.live.com/file14",
  },
  {
    id: "file_unsupported_zip",
    name: "archive.zip",
    is_folder: false,
    size: 9876543,
    mime_type: "application/zip",
    last_modified: "2024-11-25T11:15:00Z",
    web_url: "https://onedrive.live.com/file15",
  },
  {
    id: "file_unsupported_dmg",
    name: "app_installer.dmg",
    is_folder: false,
    size: 12345678,
    mime_type: "application/x-apple-diskimage",
    last_modified: "2024-10-30T14:45:00Z",
    web_url: "https://onedrive.live.com/file16",
  },
  {
    id: "file_supported_docx",
    name: "Supported Report.docx",
    is_folder: false,
    size: 234567,
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    last_modified: "2024-12-05T09:20:00Z",
    web_url: "https://onedrive.live.com/file17",
  },
];

// Empty folder
export const mockEmptyFolderItems: MockDriveItem[] = [];

// Mock items for shared drive
export const mockSharedDriveItems: MockDriveItem[] = [
  {
    id: "folder_proposals",
    name: "Proposals",
    is_folder: true,
    last_modified: "2024-11-15T10:00:00Z",
    web_url: "https://sharepoint.com/folder1",
  },
  {
    id: "folder_client_files",
    name: "Client Files",
    is_folder: true,
    last_modified: "2024-12-03T14:20:00Z",
    web_url: "https://sharepoint.com/folder2",
  },
  {
    id: "file_sales_deck",
    name: "Sales Deck 2024.pptx",
    is_folder: false,
    size: 3456789,
    mime_type:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    last_modified: "2024-11-28T16:00:00Z",
    web_url: "https://sharepoint.com/file1",
  },
  {
    id: "file_pricing",
    name: "Pricing Matrix.xlsx",
    is_folder: false,
    size: 67890,
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    last_modified: "2024-12-01T11:30:00Z",
    web_url: "https://sharepoint.com/file2",
  },
];

/**
 * Helper to get mock items by folder ID
 */
export function getMockItemsByFolderId(folderId: string): MockDriveItem[] {
  const folderItemMap: Record<string, MockDriveItem[] | undefined> = {
    folder_documents: mockDocumentsFolderItems,
    folder_reports: mockReportsFolderItems,
    folder_photos: mockPhotosFolderItems,
    folder_vacation_2024: [],
    folder_contracts: [],
    folder_proposals: [],
    folder_client_files: [],
  };

  return folderItemMap[folderId] ?? [];
}

/**
 * Helper to get mock items by drive ID (root level)
 */
export function getMockItemsByDriveId(driveId: string): MockDriveItem[] {
  const driveItemMap: Record<string, MockDriveItem[] | undefined> = {
    drive_personal_001: mockPersonalDriveItems,
    drive_shared_001: mockSharedDriveItems,
    drive_shared_002: [],
  };

  return driveItemMap[driveId] ?? [];
}

/**
 * Helper to format file size for display
 */
export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== "number" || bytes === 0) return "-";

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Helper to format date for display
 */
export function formatDate(isoDate?: string): string {
  if (typeof isoDate !== "string" || isoDate === "") return "-";

  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;

  return date.toLocaleDateString();
}
