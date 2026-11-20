import { fetchUploadFile } from "@erato/frontend/library";

import { invalid, slideNotFound } from "./powerpointReads";
import {
  MAX_SLIDE_PICTURES,
  renderSlidePicture,
  SLIDE_PICTURE_TIMEOUT_MS,
} from "./powerpointSlidePicture";

import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  UploadFileVariables,
} from "@erato/frontend/library";

/** Turns and calls remembered; a turn this old has no calls left to make. */
const REMEMBERED = 20;

/** The composer's upload limits, read when a call runs. */
export interface SlidePictureLimits {
  maxFiles: number;
  maxBytes: number;
}

/** Uploads into the chat like any attachment; resolves to the file's id. */
export async function uploadSlidePicture(
  file: File,
  chatId: string,
  signal?: AbortSignal,
): Promise<string> {
  const body = new FormData();
  body.append("file", file, file.name);
  const response = await fetchUploadFile(
    {
      queryParams: { chat_id: chatId },
      body: body as unknown as UploadFileVariables["body"],
    },
    signal,
  );
  const id = response.files.at(0)?.id;
  if (!id) throw new Error("the server took no file");
  return id;
}

/** The files API throws the parsed error body or `{status, payload}`, not an Error. */
export function uploadErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const fields = error as Record<string, unknown>;
    const text = ["message", "error", "detail", "payload"]
      .map((key) => fields[key])
      .find((value): value is string => typeof value === "string");
    const status =
      typeof fields.status === "number" ? `HTTP ${fields.status}` : undefined;
    const parts = [status, text].filter(Boolean);
    if (parts.length > 0) return parts.join(": ");
  }
  return "unknown error";
}

const notMade = (why: string): ClientToolExecutionResult => ({
  ok: false,
  error: `No picture was made: ${why}`,
});

const notAdded = (why: string): ClientToolExecutionResult => ({
  ok: false,
  error: `No picture was added: ${why}`,
});

function remember<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  map.set(key, value);
  while (map.size > REMEMBERED) map.delete(map.keys().next().value!);
}

/**
 * The executor of `powerpoint_view_slide`. Every render attempt counts against the turn's limit,
 * so a slide that keeps failing cannot be retried without end; an unknown id does not count. A
 * replayed call (its result POST failed) gets its first answer back instead of a second upload.
 */
export function slidePictureTool(upload = uploadSlidePicture) {
  const attempts = new Map<string, number>();
  const calls = new Map<string, Promise<ClientToolExecutionResult>>();

  async function view(
    rawInput: unknown,
    { chatId, messageId: turn, signal }: ClientToolCallContext,
    limits: SlidePictureLimits,
  ): Promise<ClientToolExecutionResult> {
    const slideId =
      rawInput && typeof rawInput === "object"
        ? (rawInput as Record<string, unknown>).slideId
        : undefined;
    if (typeof slideId !== "string" || slideId.length === 0)
      return invalid(
        "/slideId",
        "slideId must be a slide id from the overview.",
      );
    if (!chatId) return notMade("this turn has no chat to add it to.");
    if (signal?.aborted) return notMade("the turn was stopped.");
    const max = Math.min(MAX_SLIDE_PICTURES, limits.maxFiles);
    const used = attempts.get(turn) ?? 0;
    if (used >= max)
      return notMade(
        `this turn already asked for ${max} slide ${max === 1 ? "picture" : "pictures"}, the most one turn may ask for.`,
      );
    remember(attempts, turn, used + 1);

    const picture = await renderSlidePicture(slideId, signal);
    if (!picture.ok) {
      switch (picture.reason) {
        case "not-found":
          remember(attempts, turn, Math.max(0, (attempts.get(turn) ?? 0) - 1));
          return slideNotFound(slideId);
        case "stopped":
          return notMade("the turn was stopped.");
        case "timeout":
          return notMade(
            `PowerPoint did not render slide ${slideId} within ${SLIDE_PICTURE_TIMEOUT_MS / 1000} seconds.`,
          );
        case "failed":
          return notMade(
            `PowerPoint could not render slide ${slideId}${picture.detail ? ` (${picture.detail})` : ""}.`,
          );
      }
    }
    if (picture.file.size > limits.maxBytes)
      return notAdded(
        `the picture of slide ${slideId} is larger than the chat's upload limit.`,
      );
    let fileId: string;
    try {
      fileId = await upload(picture.file, chatId, signal);
    } catch (error) {
      return notAdded(
        `the picture of slide ${slideId} could not be uploaded to the chat (${uploadErrorText(error)}).`,
      );
    }
    return {
      ok: true,
      result: {
        slide: {
          id: picture.slideId,
          position: picture.position,
          slideCount: picture.slideCount,
        },
        picture: { fileName: picture.file.name, ...(picture.size ?? {}) },
      },
      fileUploadIds: [fileId],
    };
  }

  return (
    rawInput: unknown,
    context: ClientToolCallContext | undefined,
    limits: SlidePictureLimits,
  ): Promise<ClientToolExecutionResult> => {
    if (!context)
      return Promise.resolve(notMade("this turn has no chat to add it to."));
    const key = `${context.messageId}:${context.toolCallId}`;
    const earlier = calls.get(key);
    if (earlier) return earlier;
    const call = view(rawInput, context, limits);
    remember(calls, key, call);
    return call;
  };
}

export type SlidePictureTool = ReturnType<typeof slidePictureTool>;
