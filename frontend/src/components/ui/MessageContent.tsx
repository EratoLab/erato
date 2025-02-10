import React, { memo } from "react";

interface MessageContentProps {
  content: string;
}

export const MessageContent = memo(function MessageContent({
  content,
}: MessageContentProps) {
  return (
    <article className="prose prose-slate max-w-none">
      <p className="whitespace-pre-wrap break-words text-theme-fg-secondary">
        {content}
      </p>
    </article>
  );
});
