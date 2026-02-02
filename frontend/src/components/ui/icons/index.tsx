import {
  Copy,
  EditPencil,
  ThumbsUp,
  ThumbsDown,
  Refresh,
  MoreVert,
  InfoCircle,
  Trash as IconoirTrash,
  SidebarExpand,
  LogOut,
  SunLight,
  HalfMoon,
  Computer,
  Plus,
  Check,
  RefreshCircle,
  Xmark,
  WarningTriangle,
  ArrowUp,
  ArrowLeft,
  WarningCircle,
  CheckCircle,
  Code,
  Tools,
  Settings,
  Timer,
  Hourglass,
  Brain,
  Page,
  MediaImage,
  Archive,
  MusicNote,
  MediaVideo,
  MultiplePages,
  Search,
  NavArrowRight,
  Folder,
  ShareAndroid,
} from "iconoir-react";

// Define our own IconProps interface based on common SVG props
interface IconProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  color?: string;
  strokeWidth?: number | string;
}

// Re-export with our current naming convention for backward compatibility
export const CopyIcon = ({ className, ...props }: IconProps) => (
  <Copy className={className} {...props} />
);

export const EditIcon = ({ className, ...props }: IconProps) => (
  <EditPencil className={className} {...props} />
);

export const ThumbUpIcon = ({ className, ...props }: IconProps) => (
  <ThumbsUp className={className} {...props} />
);

export const ThumbDownIcon = ({ className, ...props }: IconProps) => (
  <ThumbsDown className={className} {...props} />
);

export const RerunIcon = ({ className, ...props }: IconProps) => (
  <Refresh className={className} {...props} />
);

export const MoreVertical = ({ className, ...props }: IconProps) => (
  <MoreVert className={className} {...props} />
);

export const InfoIcon = ({ className, ...props }: IconProps) => (
  <InfoCircle className={className} {...props} />
);

// Keep Info for backward compatibility but mark as deprecated
/** @deprecated Use InfoIcon instead for consistency */
export const Info = InfoIcon;

export const Trash = ({ className, ...props }: IconProps) => (
  <IconoirTrash className={className} {...props} />
);

export const SidebarToggleIcon = ({ className, ...props }: IconProps) => (
  <SidebarExpand className={className} {...props} />
);

export const LogOutIcon = ({ className, ...props }: IconProps) => (
  <LogOut className={className} {...props} />
);

export const SunIcon = ({ className, ...props }: IconProps) => (
  <SunLight className={className} {...props} />
);

export const MoonIcon = ({ className, ...props }: IconProps) => (
  <HalfMoon className={className} {...props} />
);

export const ComputerIcon = ({ className, ...props }: IconProps) => (
  <Computer className={className} {...props} />
);

export const PlusIcon = ({ className, ...props }: IconProps) => (
  <Plus className={className} {...props} />
);

export const CheckIcon = ({ className, ...props }: IconProps) => (
  <Check className={className} {...props} />
);

// Additional utility icons for inline SVG replacements
export const LoadingIcon = ({ className, ...props }: IconProps) => (
  <RefreshCircle className={className} {...props} />
);

export const CloseIcon = ({ className, ...props }: IconProps) => (
  <Xmark className={className} {...props} />
);

export const ErrorIcon = ({ className, ...props }: IconProps) => (
  <Xmark className={className} {...props} />
);

export const WarningIcon = ({ className, ...props }: IconProps) => (
  <WarningTriangle className={className} {...props} />
);

// Additional icons for component replacements
export const ArrowUpIcon = ({ className, ...props }: IconProps) => (
  <ArrowUp className={className} {...props} />
);

export const WarningCircleIcon = ({ className, ...props }: IconProps) => (
  <WarningCircle className={className} {...props} />
);

export const CheckCircleIcon = ({ className, ...props }: IconProps) => (
  <CheckCircle className={className} {...props} />
);

export const CodeIcon = ({ className, ...props }: IconProps) => (
  <Code className={className} {...props} />
);

// Emoji replacement icons
export const ToolsIcon = ({ className, ...props }: IconProps) => (
  <Tools className={className} {...props} />
);

export const SettingsIcon = ({ className, ...props }: IconProps) => (
  <Settings className={className} {...props} />
);

export const TimerIcon = ({ className, ...props }: IconProps) => (
  <Timer className={className} {...props} />
);

export const HourglassIcon = ({ className, ...props }: IconProps) => (
  <Hourglass className={className} {...props} />
);

export const BrainIcon = ({ className, ...props }: IconProps) => (
  <Brain className={className} {...props} />
);

// File type icons
export const PageIcon = ({ className, ...props }: IconProps) => (
  <Page className={className} {...props} />
);

export const MediaImageIcon = ({ className, ...props }: IconProps) => (
  <MediaImage className={className} {...props} />
);

export const ArchiveIcon = ({ className, ...props }: IconProps) => (
  <Archive className={className} {...props} />
);

export const MusicNoteIcon = ({ className, ...props }: IconProps) => (
  <MusicNote className={className} {...props} />
);

export const MediaVideoIcon = ({ className, ...props }: IconProps) => (
  <MediaVideo className={className} {...props} />
);

export const MultiplePagesIcon = ({ className, ...props }: IconProps) => (
  <MultiplePages className={className} {...props} />
);

export const SearchIcon = ({ className, ...props }: IconProps) => (
  <Search className={className} {...props} />
);

export const ArrowLeftIcon = ({ className, ...props }: IconProps) => (
  <ArrowLeft className={className} {...props} />
);

export const ChevronRightIcon = ({ className, ...props }: IconProps) => (
  <NavArrowRight className={className} {...props} />
);

export const FolderIcon = ({ className, ...props }: IconProps) => (
  <Folder className={className} {...props} />
);

export const DocumentIcon = ({ className, ...props }: IconProps) => (
  <Page className={className} {...props} />
);

export const SpreadsheetIcon = ({ className, ...props }: IconProps) => (
  <Page className={className} {...props} />
);

export const PresentationIcon = ({ className, ...props }: IconProps) => (
  <MultiplePages className={className} {...props} />
);

export const ImageIcon = ({ className, ...props }: IconProps) => (
  <MediaImage className={className} {...props} />
);

export const FileTextIcon = ({ className, ...props }: IconProps) => (
  <Page className={className} {...props} />
);

export const ShareIcon = ({ className, ...props }: IconProps) => (
  <ShareAndroid className={className} {...props} />
);

// Direct re-exports for convenience (maintaining Iconoir naming)
export {
  Copy,
  EditPencil,
  ThumbsUp,
  ThumbsDown,
  Refresh,
  MoreVert,
  InfoCircle,
  SidebarExpand,
  LogOut,
  SunLight,
  HalfMoon,
  Computer,
  Plus,
  Check,
  RefreshCircle,
  Xmark,
  WarningTriangle,
  ArrowUp,
  WarningCircle,
  CheckCircle,
  Code,
  Page,
  MediaImage,
  Archive,
  MusicNote,
  MediaVideo,
  MultiplePages,
  Search,
};

// Export the IconProps type for use in other components
export type { IconProps };

export { ResolvedIcon } from "./ResolvedIcon";
