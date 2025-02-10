import React, { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import {
  PlusIcon,
  ArrowUpIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { Button } from "./Button";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onNewChat?: () => void;
  onRegenerate?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  showControls?: boolean;
}

export const ChatInput = ({
  onSendMessage,
  onNewChat,
  onRegenerate,
  isLoading = false,
  disabled = false,
  className = "",
  placeholder = "Type a message...",
  maxLength = 2000,
  showControls = true,
}: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading && !disabled) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  return (
    <form onSubmit={handleSubmit}>
      <div
        className={clsx(
          "w-full rounded-2xl bg-theme-bg-primary",
          "p-3",
          "shadow-[0_0_15px_rgba(0,0,0,0.1)]",
          "border border-theme-border",
          "flex flex-col gap-3",
          className,
        )}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={1}
          disabled={isLoading || disabled}
          className={clsx(
            "w-full resize-none overflow-hidden",
            "px-3 py-2",
            "bg-transparent",
            "text-gray-900 placeholder:text-gray-500",
            "focus:outline-none",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "min-h-[24px] max-h-[200px]",
          )}
        />

        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {showControls && (
              <>
                <Button
                  onClick={onNewChat}
                  icon={<PlusIcon />}
                  size="sm"
                  aria-label="New chat"
                />
                <Button
                  onClick={onRegenerate}
                  icon={<ArrowPathIcon />}
                  size="sm"
                  aria-label="Regenerate response"
                />
              </>
            )}
          </div>

          <Button
            type="submit"
            disabled={!message.trim() || isLoading || disabled}
            icon={<ArrowUpIcon />}
            size="sm"
            aria-label="Send message"
          />
        </div>
      </div>
    </form>
  );
};
