import React, { memo } from "react";
import clsx from "clsx";
import { messageStyles } from "./styles/chatMessageStyles";

interface AvatarProps {
  role: "user" | "assistant";
  isUser: boolean;
}

export const Avatar = memo(function Avatar({ role, isUser }: AvatarProps) {
  return (
    <div
      className={clsx(
        "w-8 h-8 rounded-full flex items-center justify-center",
        messageStyles.avatar[role],
      )}
      aria-label={`${isUser ? "User" : "Assistant"} avatar`}
      role="img"
    >
      {isUser ? "U" : "A"}
    </div>
  );
});
