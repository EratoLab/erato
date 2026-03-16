export const messageStyles = {
  container: {
    user: "bg-[var(--theme-message-user)]",
    assistant: "bg-[var(--theme-message-assistant)]",
  },
  avatar: {
    user: "bg-[var(--theme-avatar-user-bg)] text-[var(--theme-avatar-user-fg)]",
    assistant:
      "bg-[var(--theme-avatar-assistant-bg)] text-[var(--theme-avatar-assistant-fg)]",
  },
  hover: "hover:bg-[var(--theme-message-hover)]",
} as const;
