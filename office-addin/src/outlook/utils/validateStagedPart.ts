import {
  findCapabilityByExtension,
  hasSupportedOperations,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

type FileCapabilities = Parameters<typeof findCapabilityByExtension>[1];
type FileCapability = FileCapabilities[number];

export interface StagedPartMetadata {
  filename: string;
  mimeType: string;
  size: number;
}

export interface StagedPartLimits {
  /** The backend's global upload cap; `0` disables the size check. */
  maxBytes: number;
  maxFormatted: string;
}

export interface StagedPartTypePolicy {
  capabilities: FileCapabilities;
  isLoading: boolean;
}

/**
 * `too-large` keeps its checkbox: the user can leave the part out and send
 * the rest. `unsupported` is left out for them and renders read-only.
 */
export type StagedPartValidation =
  | { ok: true }
  | { ok: false; verdict: "unsupported" | "too-large"; reason: string };

export function isPolicyExcluded(validation: StagedPartValidation): boolean {
  return !validation.ok && validation.verdict === "unsupported";
}

function matchesMimePattern(mimeType: string, pattern: string): boolean {
  if (pattern === "*/*") return true;
  if (pattern.endsWith("/*")) {
    return mimeType.startsWith(pattern.slice(0, -1));
  }
  return mimeType === pattern;
}

// Extension-less parts fall back to the capability claiming their MIME type.
function findCapability(
  part: StagedPartMetadata,
  capabilities: FileCapabilities,
): FileCapability | null {
  const byExtension = findCapabilityByExtension(part.filename, capabilities);
  if (byExtension) return byExtension;
  const mimeType = part.mimeType.trim().toLowerCase();
  if (!mimeType) return null;
  return (
    capabilities.find((capability) =>
      capability.mime_types.some((pattern) =>
        matchesMimePattern(mimeType, pattern.toLowerCase()),
      ),
    ) ?? null
  );
}

export function validateStagedPart(
  part: StagedPartMetadata,
  limits: StagedPartLimits,
  typePolicy: StagedPartTypePolicy,
): StagedPartValidation {
  // Until the capabilities have loaded every type passes, as the dropzone does.
  if (!typePolicy.isLoading && typePolicy.capabilities.length > 0) {
    const capability = findCapability(part, typePolicy.capabilities);
    if (!capability || !hasSupportedOperations(capability)) {
      return {
        ok: false,
        verdict: "unsupported",
        reason: t({
          id: "officeAddin.chatInput.validation.unsupported",
          message: "Won't be read by the AI",
        }),
      };
    }
  }
  if (limits.maxBytes > 0 && part.size > limits.maxBytes) {
    const globalMaxFormatted = limits.maxFormatted;
    return {
      ok: false,
      verdict: "too-large",
      reason: t({
        id: "officeAddin.chatInput.validation.tooLarge",
        message: `File exceeds the server limit of ${globalMaxFormatted}`,
      }),
    };
  }
  return { ok: true };
}
