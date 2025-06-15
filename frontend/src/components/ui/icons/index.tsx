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
  WarningCircle,
  CheckCircle,
  Code,
  Tools,
  Settings,
  Timer,
  Hourglass,
  Brain,
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

export const Info = ({ className, ...props }: IconProps) => (
  <InfoCircle className={className} {...props} />
);

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
};

// Export the IconProps type for use in other components
export type { IconProps };
