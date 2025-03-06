import {
  DocumentIcon,
  PhotoIcon,
  DocumentTextIcon,
  DocumentChartBarIcon,
  ArchiveBoxIcon,
  CodeBracketIcon,
  TableCellsIcon,
  MusicalNoteIcon,
  FilmIcon,
  PresentationChartBarIcon,
} from "@heroicons/react/24/solid";

/**
 * Supported file types in the application
 */
export type FileType =
  | "pdf"
  | "image"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "text"
  | "code"
  | "archive"
  | "audio"
  | "video"
  | "other";

/**
 * Interface for file type configuration
 */
export interface FileTypeConfig {
  /** Display name shown in UI */
  displayName: string;
  /** File extensions without dot (e.g. 'pdf', 'jpg') */
  extensions: string[];
  /** Mime type patterns (e.g. 'application/pdf', 'image/*') */
  mimeTypes: string[];
  /** Max allowed file size in bytes */
  maxSize?: number;
  /** Icon component to use for this file type */
  icon: React.ElementType;
  /** Icon color - can be any valid CSS color */
  iconColor: string;
  /** Whether this file type is enabled in the application */
  enabled: boolean;
}

/**
 * Configuration for all supported file types
 */
export const FILE_TYPES: Record<FileType, FileTypeConfig> = {
  pdf: {
    displayName: "PDF",
    extensions: ["pdf"],
    mimeTypes: ["application/pdf"],
    maxSize: 10 * 1024 * 1024, // 10MB
    icon: DocumentChartBarIcon,
    iconColor: "rgb(244, 63, 94)", // rose-500
    enabled: true,
  },
  image: {
    displayName: "Image",
    extensions: [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "svg",
      "bmp",
      "tiff",
      "tif",
    ],
    mimeTypes: ["image/*"],
    maxSize: 5 * 1024 * 1024, // 5MB
    icon: PhotoIcon,
    iconColor: "rgb(59, 130, 246)", // blue-500
    enabled: true,
  },
  document: {
    displayName: "Document",
    extensions: ["doc", "docx", "rtf", "odt"],
    mimeTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/rtf",
      "application/vnd.oasis.opendocument.text",
    ],
    maxSize: 20 * 1024 * 1024, // 20MB
    icon: DocumentTextIcon,
    iconColor: "rgb(79, 70, 229)", // indigo-500
    enabled: true,
  },
  spreadsheet: {
    displayName: "Spreadsheet",
    extensions: ["xls", "xlsx", "csv", "ods"],
    mimeTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/vnd.oasis.opendocument.spreadsheet",
    ],
    maxSize: 20 * 1024 * 1024, // 20MB
    icon: TableCellsIcon,
    iconColor: "rgb(16, 185, 129)", // emerald-500
    enabled: true,
  },
  presentation: {
    displayName: "Presentation",
    extensions: ["ppt", "pptx", "odp"],
    mimeTypes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.oasis.opendocument.presentation",
    ],
    maxSize: 30 * 1024 * 1024, // 30MB
    icon: PresentationChartBarIcon,
    iconColor: "rgb(245, 158, 11)", // amber-500
    enabled: true,
  },
  text: {
    displayName: "Text",
    extensions: ["txt", "md", "markdown"],
    mimeTypes: ["text/plain", "text/markdown"],
    maxSize: 2 * 1024 * 1024, // 2MB
    icon: DocumentTextIcon,
    iconColor: "rgb(107, 114, 128)", // gray-500
    enabled: true,
  },
  code: {
    displayName: "Code",
    extensions: [
      "js",
      "ts",
      "html",
      "css",
      "jsx",
      "tsx",
      "json",
      "py",
      "java",
      "rb",
      "php",
      "c",
      "cpp",
      "h",
      "sh",
    ],
    mimeTypes: ["text/javascript", "application/json", "text/html", "text/css"],
    maxSize: 2 * 1024 * 1024, // 2MB
    icon: CodeBracketIcon,
    iconColor: "rgb(124, 58, 237)", // violet-600
    enabled: true,
  },
  archive: {
    displayName: "Archive",
    extensions: ["zip", "rar", "tar", "gz", "7z"],
    mimeTypes: [
      "application/zip",
      "application/x-rar-compressed",
      "application/x-tar",
      "application/gzip",
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
    icon: ArchiveBoxIcon,
    iconColor: "rgb(202, 138, 4)", // yellow-600
    enabled: true,
  },
  audio: {
    displayName: "Audio",
    extensions: ["mp3", "wav", "ogg", "m4a", "flac"],
    mimeTypes: ["audio/*"],
    maxSize: 30 * 1024 * 1024, // 30MB
    icon: MusicalNoteIcon,
    iconColor: "rgb(219, 39, 119)", // pink-600
    enabled: true,
  },
  video: {
    displayName: "Video",
    extensions: ["mp4", "avi", "mov", "webm", "mkv"],
    mimeTypes: ["video/*"],
    maxSize: 100 * 1024 * 1024, // 100MB
    icon: FilmIcon,
    iconColor: "rgb(220, 38, 38)", // red-600
    enabled: true,
  },
  other: {
    displayName: "File",
    extensions: [],
    mimeTypes: [],
    icon: DocumentIcon,
    iconColor: "rgb(107, 114, 128)", // gray-500
    enabled: true,
  },
};

/**
 * Utility class for file type operations
 */
export class FileTypeUtil {
  /**
   * Determine the file type based on the file's extension and mime type
   * @param file - The file to identify
   * @returns The identified file type
   */
  static getFileType(file: File): FileType {
    const extension = this.getExtension(file.name).toLowerCase();
    const mimeType = file.type.toLowerCase();

    // Check each file type for matching extension or mime type
    for (const [type, config] of Object.entries(FILE_TYPES)) {
      if (!config.enabled) continue;

      // Check extensions
      if (config.extensions.includes(extension)) {
        return type as FileType;
      }

      // Check mime types (including wildcards like 'image/*')
      for (const pattern of config.mimeTypes) {
        if (this.matchesMimeType(mimeType, pattern)) {
          return type as FileType;
        }
      }
    }

    return "other";
  }

  /**
   * Validate if a file is allowed based on its type and size
   * @param file - The file to validate
   * @returns Validation result object
   */
  static validateFile(file: File): {
    valid: boolean;
    error?: string;
    fileType: FileType;
  } {
    const fileType = this.getFileType(file);
    const config = FILE_TYPES[fileType];

    // Check if file type is enabled
    if (!config.enabled) {
      return {
        valid: false,
        error: `File type ${config.displayName} is not supported`,
        fileType,
      };
    }

    // Check file size if max size is specified
    if (config.maxSize && file.size > config.maxSize) {
      const maxSizeMB = Math.round(config.maxSize / (1024 * 1024));
      return {
        valid: false,
        error: `File exceeds maximum size of ${maxSizeMB}MB`,
        fileType,
      };
    }

    return { valid: true, fileType };
  }

  /**
   * Get file extension without the dot
   * @param filename - Name of the file
   * @returns The file extension or empty string if no extension
   */
  private static getExtension(filename: string): string {
    return filename.split(".").pop() ?? "";
  }

  /**
   * Check if a mime type matches a pattern (including wildcards)
   * @param mimeType - The actual mime type
   * @param pattern - The pattern to match against (can include wildcards)
   * @returns True if matches, false otherwise
   */
  private static matchesMimeType(mimeType: string, pattern: string): boolean {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.replace("/*", "");
      return mimeType.startsWith(prefix);
    }
    return mimeType === pattern;
  }

  /**
   * Get the formatted size of a file
   * @param sizeInBytes - Size in bytes
   * @returns Formatted file size (e.g., "2.5 MB")
   */
  static formatFileSize(sizeInBytes: number): string {
    if (sizeInBytes < 1024) {
      return `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    } else if (sizeInBytes < 1024 * 1024 * 1024) {
      return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
  }

  /**
   * Generate the accepted file types string for file input
   * @param fileTypes - Array of file types to accept, or empty for all
   * @returns String formatted for the accept attribute
   */
  static getAcceptString(fileTypes?: FileType[]): string {
    if (!fileTypes || fileTypes.length === 0) {
      // Get all enabled file types
      fileTypes = Object.entries(FILE_TYPES)

        .filter(([_, config]) => config.enabled)
        .map(([type]) => type as FileType);
    }

    const mimeTypes = new Set<string>();
    const extensions = new Set<string>();

    fileTypes.forEach((type) => {
      const config = FILE_TYPES[type];
      if (config.enabled) {
        config.mimeTypes.forEach((mime) => mimeTypes.add(mime));
        config.extensions.forEach((ext) => extensions.add(`.${ext}`));
      }
    });

    return [...Array.from(mimeTypes), ...Array.from(extensions)].join(",");
  }
}
