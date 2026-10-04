import type { ToolDisplayMetadata } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Render the backend's snapshot as inert text, including literal markup. */
export const ToolApprovalDescription = ({
  display,
}: {
  display?: ToolDisplayMetadata | null;
}) =>
  display?.description ? (
    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-theme-fg-secondary">
      {display.description}
      {display.description_truncated ? "…" : null}
    </p>
  ) : null;
