import React, { memo } from 'react';
import clsx from 'clsx';
import { 
  CopyIcon, 
  EditIcon, 
  ThumbUpIcon, 
  ThumbDownIcon, 
  RerunIcon 
} from './icons';

interface MessageControlsProps {
  /** Whether the message is from the user */
  isUser: boolean;
  /** Whether to show controls only on hover */
  showOnHover?: boolean;
  /** Callback when copy button is clicked */
  onCopy?: () => void;
  /** Callback when edit button is clicked (user messages only) */
  onEdit?: () => void;
  /** Callback when like button is clicked (assistant messages only) */
  onLike?: () => void;
  /** Callback when dislike button is clicked (assistant messages only) */
  onDislike?: () => void;
  /** Callback when regenerate button is clicked (assistant messages only) */
  onRerun?: () => void;
  /** Additional CSS classes */
  className?: string;
}

export const MessageControls = memo(function MessageControls({
  isUser,
  showOnHover = true,
  onCopy,
  onEdit,
  onLike,
  onDislike,
  onRerun,
  className
}: MessageControlsProps) {
  // Extract common styles to constants
  const buttonClasses = clsx(
    "p-1 hover:bg-theme-bg-accent rounded",
    "text-theme-fg-secondary hover:text-theme-fg-primary",
    "transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed"
  );
  
  const iconClasses = "w-4 h-4";

  // Helper to render a control button
  const ControlButton = ({
    onClick,
    label,
    icon: Icon,
    disabled = !onClick,
  }: {
    onClick?: () => void,
    label: string,
    icon: React.ComponentType<{ className?: string }>,
    disabled?: boolean,
  }) => (
    <button
      onClick={onClick}
      className={buttonClasses}
      aria-label={label}
      disabled={disabled}
    >
      <Icon className={iconClasses} />
    </button>
  );

  return (
    <div 
      className={clsx(
        showOnHover ? 'opacity-0 group-hover:opacity-100 transition-opacity' : 'opacity-100',
        'absolute top-2 right-2 flex gap-2 rounded',
        'bg-theme-bg-secondary px-2 py-1',
        'shadow-sm',
        className
      )}
      role="toolbar"
      aria-label="Message controls"
    >
      <ControlButton
        onClick={onCopy}
        label="Copy message"
        icon={CopyIcon}
      />

      {isUser && (
        <ControlButton
          onClick={onEdit}
          label="Edit message"
          icon={EditIcon}
        />
      )}

      {!isUser && (
        <>
          <ControlButton
            onClick={onLike}
            label="Like response"
            icon={ThumbUpIcon}
          />
          
          <ControlButton
            onClick={onDislike}
            label="Dislike response"
            icon={ThumbDownIcon}
          />

          <ControlButton
            onClick={onRerun}
            label="Regenerate response"
            icon={RerunIcon}
          />
        </>
      )}
    </div>
  );
});

MessageControls.displayName = 'MessageControls'; 