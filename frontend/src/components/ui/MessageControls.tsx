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
  isUser: boolean;
  showOnHover?: boolean;
  onCopy?: () => void;
  onEdit?: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  onRerun?: () => void;
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
  const buttonClasses = "p-1 hover:bg-theme-bg-accent rounded text-theme-fg-secondary hover:text-theme-fg-primary transition-colors";
  const iconClasses = "w-4 h-4";

  return (
    <div 
      className={clsx(
        showOnHover ? 'opacity-0 group-hover:opacity-100 transition-opacity' : 'opacity-100',
        'absolute top-2 right-2 flex gap-2 rounded bg-theme-bg-secondary px-2 py-1',
        className
      )}
    >
      <button
        onClick={onCopy}
        className={buttonClasses}
        aria-label="Copy message"
      >
        <CopyIcon className={iconClasses} />
      </button>

      {isUser && onEdit && (
        <button
          onClick={onEdit}
          className={buttonClasses}
          aria-label="Edit message"
        >
          <EditIcon className={iconClasses} />
        </button>
      )}

      {!isUser && (
        <>
          <button
            onClick={onLike}
            className={buttonClasses}
            aria-label="Like response"
          >
            <ThumbUpIcon className={iconClasses} />
          </button>
          
          <button
            onClick={onDislike}
            className={buttonClasses}
            aria-label="Dislike response"
          >
            <ThumbDownIcon className={iconClasses} />
          </button>

          <button
            onClick={onRerun}
            className={buttonClasses}
            aria-label="Regenerate response"
          >
            <RerunIcon className={iconClasses} />
          </button>
        </>
      )}
    </div>
  );
}); 