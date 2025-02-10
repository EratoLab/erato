export const messageStyles = {
  container: {
    user: "bg-theme-bg-primary",
    assistant: "bg-theme-bg-secondary",
  },
  avatar: {
    user: "bg-[var(--theme-avatar-user-bg)] text-[var(--theme-avatar-user-fg)]",
    assistant:
      "bg-[var(--theme-avatar-assistant-bg)] text-[var(--theme-avatar-assistant-fg)]",
  },
} as const;
