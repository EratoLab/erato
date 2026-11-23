import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Servers in the order people read them: by the name they see, ignoring case
 * and accents. The listing arrives sorted by raw id, which puts capitalised ids
 * before every lowercase one.
 */
export function sortMcpServersByName<
  T extends Pick<McpServerStatus, "id" | "display_name">,
>(servers: readonly T[]): T[] {
  return [...servers].sort(
    (a, b) =>
      a.display_name.localeCompare(b.display_name, undefined, {
        sensitivity: "base",
      }) || a.id.localeCompare(b.id),
  );
}
