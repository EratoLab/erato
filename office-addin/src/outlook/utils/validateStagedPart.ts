import { FileTypeUtil, getSupportedFileTypes } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

type FileCapabilities = Parameters<typeof getSupportedFileTypes>[0];

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

export function validateStagedPart(
  part: StagedPartMetadata,
  limits: StagedPartLimits,
  typePolicy: StagedPartTypePolicy,
): StagedPartValidation {
  // Until the capabilities have loaded every type passes, as the dropzone does.
  if (!typePolicy.isLoading && typePolicy.capabilities.length > 0) {
    const fileType = FileTypeUtil.getFileTypeFromMetadata(
      part.filename,
      part.mimeType,
    );
    if (!getSupportedFileTypes(typePolicy.capabilities).includes(fileType)) {
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
