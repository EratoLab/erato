import { useFileCapabilities, useUploadFeature } from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MAX_SLIDE_PICTURES,
  modelTakesSlidePictures,
  renderSelectedSlidePictures,
} from "../utils/powerpointSlidePicture";

import type { SlidePictureRender } from "../utils/powerpointSlidePicture";
import type { ComposerNotice, FileUploadItem } from "@erato/frontend/library";

export const SLIDE_PICTURE_NOTICE_ID = "powerpoint.slidePicture";

/** What the "+" menu row and the presentation chip offer. */
export interface SlidePictureOffer {
  /** Host tier, facet, inclusion and the selected model all allow a picture. */
  available: boolean;
  busy: boolean;
  attach: () => void;
}

export interface UsePowerPointSlidePicturesOptions {
  /** The host can render a slide, the server offers the facet and the presentation is included. */
  enabled: boolean;
  /** The selected model's chat provider id. */
  modelId: string | undefined;
  conversationKey: string;
  /** The composer's own upload path, which checks type, count and size. */
  uploadFiles:
    | ((files: File[]) => Promise<FileUploadItem[] | undefined>)
    | undefined;
  addUploadedFiles: (files: FileUploadItem[]) => void;
  stagedCount: number;
  maxFiles: number;
  announce: (text: string) => void;
}

const renderFailureText = (
  result: Extract<SlidePictureRender, { ok: false }>,
): string => {
  switch (result.reason) {
    case "nothing-selected":
      return t({
        id: "officeAddin.powerpoint.slidePicture.nothingSelected",
        message: "Select a slide in PowerPoint first, then add its picture.",
      });
    case "timeout":
      return t({
        id: "officeAddin.powerpoint.slidePicture.timeout",
        message:
          "PowerPoint took too long to make the slide picture, so nothing was attached. Try again.",
      });
    case "failed":
      return t({
        id: "officeAddin.powerpoint.slidePicture.failed",
        message:
          "PowerPoint couldn't make the slide picture, so nothing was attached. Try again.",
      });
  }
};

export function usePowerPointSlidePictures({
  enabled,
  modelId,
  conversationKey,
  uploadFiles,
  addUploadedFiles,
  stagedCount,
  maxFiles,
  announce,
}: UsePowerPointSlidePicturesOptions): {
  offer: SlidePictureOffer;
  notice: ComposerNotice | null;
  clearNotice: () => void;
} {
  // The composer's own switch for uploads of any kind.
  const { enabled: uploadEnabled } = useUploadFeature();
  const asks = enabled && uploadEnabled && !!modelId;
  const capabilities = useFileCapabilities(
    { queryParams: { model_id: modelId } },
    {
      enabled: asks,
      staleTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  );
  const available = asks && modelTakesSlidePictures(capabilities.data);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  const latest = useRef({
    conversationKey,
    uploadFiles,
    addUploadedFiles,
    stagedCount,
    maxFiles,
    announce,
  });
  latest.current = {
    conversationKey,
    uploadFiles,
    addUploadedFiles,
    stagedCount,
    maxFiles,
    announce,
  };
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lastKeyRef = useRef(conversationKey);
  useEffect(() => {
    if (lastKeyRef.current === conversationKey) return;
    lastKeyRef.current = conversationKey;
    setNotice(null);
  }, [conversationKey]);

  const errorNotice = useCallback(
    (text: string): ComposerNotice => ({
      id: SLIDE_PICTURE_NOTICE_ID,
      tone: "error",
      text,
      onDismiss: () => setNotice(null),
    }),
    [],
  );

  const run = useCallback(async () => {
    const start = latest.current;
    const room = start.maxFiles - start.stagedCount;
    if (room <= 0) {
      setNotice(
        errorNotice(
          t({
            id: "officeAddin.powerpoint.slidePicture.noRoom",
            message:
              "This message has as many files as it can take. Remove one to add a slide picture.",
          }),
        ),
      );
      return;
    }
    const stillHere = () =>
      mountedRef.current &&
      latest.current.conversationKey === start.conversationKey;

    setNotice({
      id: SLIDE_PICTURE_NOTICE_ID,
      tone: "info",
      busy: true,
      text: t({
        id: "officeAddin.powerpoint.slidePicture.rendering",
        message: "Making a picture of the selected slide…",
      }),
    });
    const result = await renderSelectedSlidePictures({
      limit: Math.min(MAX_SLIDE_PICTURES, room),
    });
    if (!stillHere()) return;
    if (!result.ok) {
      console.warn("[PowerPoint] slide picture", result.reason, result.detail);
      setNotice(errorNotice(renderFailureText(result)));
      return;
    }

    const files = result.pictures.map((picture) => picture.file);
    let uploaded: FileUploadItem[] | undefined;
    try {
      uploaded = await start.uploadFiles?.(files);
    } catch (error) {
      console.warn("[PowerPoint] uploading the slide picture failed", error);
    }
    if (!stillHere()) return;
    const attached = uploaded ?? [];
    if (attached.length > 0) latest.current.addUploadedFiles(attached);

    const total = files.length;
    const missing = total - attached.length;
    if (missing > 0) {
      setNotice(
        errorNotice(
          attached.length === 0
            ? t({
                id: "officeAddin.powerpoint.slidePicture.uploadFailed",
                message: plural(total, {
                  one: "The slide picture couldn't be uploaded, so it isn't attached.",
                  other:
                    "The slide pictures couldn't be uploaded, so none is attached.",
                }),
              })
            : t({
                id: "officeAddin.powerpoint.slidePicture.uploadPartly",
                message: `${missing} of ${total} slide pictures couldn't be uploaded. The others are attached.`,
              }),
        ),
      );
      return;
    }

    const attachedCount = attached.length;
    latest.current.announce(
      t({
        id: "officeAddin.powerpoint.slidePicture.attached",
        message: plural(attachedCount, {
          one: "Slide picture attached.",
          other: "# slide pictures attached.",
        }),
      }),
    );
    const selectedCount = result.selectedCount;
    const leftOut = selectedCount - attachedCount;
    setNotice(
      leftOut > 0
        ? {
            id: SLIDE_PICTURE_NOTICE_ID,
            tone: "info",
            text: t({
              id: "officeAddin.powerpoint.slidePicture.leftOut",
              message: plural(leftOut, {
                one: `Attached the first ${attachedCount} of ${selectedCount} selected slides. To add the last one, select it and add again.`,
                other: `Attached the first ${attachedCount} of ${selectedCount} selected slides. To add the other #, select them and add again.`,
              }),
            }),
            onDismiss: () => setNotice(null),
          }
        : null,
    );
  }, [errorNotice]);

  const attach = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void run().finally(() => {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    });
  }, [run]);

  const offer = useMemo(
    () => ({ available, busy, attach }),
    [available, busy, attach],
  );
  return { offer, notice, clearNotice };
}
