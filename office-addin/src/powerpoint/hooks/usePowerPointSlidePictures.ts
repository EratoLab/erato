import { useFileUploadStore, useUploadFeature } from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useModelTakesSlidePictures } from "./useModelTakesSlidePictures";
import {
  MAX_SLIDE_PICTURES,
  renderSelectedSlidePictures,
} from "../utils/powerpointSlidePicture";

import type {
  SlidePicture,
  SlidePictureRender,
} from "../utils/powerpointSlidePicture";
import type { ComposerNotice, FileUploadItem } from "@erato/frontend/library";

export const SLIDE_PICTURE_NOTICE_ID = "powerpoint.slidePicture";
export const SLIDE_PICTURE_MODEL_NOTICE_ID = "powerpoint.slidePicture.model";

/** What the "+" menu row and the presentation chip offer. */
export interface SlidePictureOffer {
  /** Host tier, facet, inclusion and the selected model all allow a picture. */
  available: boolean;
  /** Available, and nothing holds the composer: no lock, no render, no other upload. */
  canAttach: boolean;
  busy: boolean;
  attach: () => void;
}

type PictureSlide = Pick<SlidePicture, "slideId" | "slideNumber">;

export interface UsePowerPointSlidePicturesOptions {
  /** The host can render a slide, the server offers the facet and the presentation is included. */
  enabled: boolean;
  /** The chat's own composer lock: archived, or a delegated run still writing. */
  locked: boolean;
  /** The selected model's chat provider id. */
  modelId: string | undefined;
  conversationKey: string;
  /** The composer's own upload path, which checks type, count and size. */
  uploadFiles:
    | ((files: File[]) => Promise<FileUploadItem[] | undefined>)
    | undefined;
  addUploadedFiles: (files: FileUploadItem[]) => void;
  stagedFiles: readonly FileUploadItem[];
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

const roomIn = (composer: {
  maxFiles: number;
  stagedFiles: readonly unknown[];
}) => composer.maxFiles - composer.stagedFiles.length;

const slideLabel = ({ slideId, slideNumber }: PictureSlide) =>
  `slide ${slideNumber ?? "?"} (id ${slideId})`;

/**
 * For the model, in the facet's selection text: a picture's file name gives only the slide's
 * position, and the selection is read at send time, so this is where a picture is tied to its slide.
 */
export function describeSlidePictures(
  slides: readonly PictureSlide[],
): string | null {
  if (slides.length === 0) return null;
  if (slides.length === 1)
    return `The attached slide picture shows ${slideLabel(slides[0])} as it looked when attached.`;
  return `The attached slide pictures show, in attachment order, ${slides
    .map(slideLabel)
    .join(", ")}, each as it looked when attached.`;
}

export function usePowerPointSlidePictures({
  enabled,
  locked,
  modelId,
  conversationKey,
  uploadFiles,
  addUploadedFiles,
  stagedFiles,
  maxFiles,
  announce,
}: UsePowerPointSlidePicturesOptions): {
  offer: SlidePictureOffer;
  notice: ComposerNotice | null;
  clearNotice: () => void;
  /** The selection-text line for the slide pictures among `fileIds`, or null. */
  describeFiles: (fileIds: readonly string[] | undefined) => string | null;
} {
  // The composer's own switch for uploads of any kind.
  const { enabled: uploadEnabled } = useUploadFeature();
  const otherUpload = useFileUploadStore((state) => state.isUploading);

  const [pictures, setPictures] = useState<ReadonlyMap<string, PictureSlide>>(
    () => new Map(),
  );
  const stagedPictures = stagedFiles.filter((file) => pictures.has(file.id));

  // A staged picture keeps the check alive after the offer itself is gone, e.g. on a model switch.
  const checksModel =
    uploadEnabled && !!modelId && (enabled || stagedPictures.length > 0);
  const { takes: modelTakes, known: modelKnown } = useModelTakesSlidePictures(
    modelId,
    checksModel,
  );
  const available = enabled && checksModel && modelTakes;
  // The composer keeps staged files across a model switch and sends them all the same.
  const modelCannotRead =
    checksModel && stagedPictures.length > 0 && modelKnown && !modelTakes;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  const latest = useRef({
    conversationKey,
    uploadFiles,
    addUploadedFiles,
    stagedFiles,
    maxFiles,
    announce,
    locked,
  });
  latest.current = {
    conversationKey,
    uploadFiles,
    addUploadedFiles,
    stagedFiles,
    maxFiles,
    announce,
    locked,
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
  const noRoomNotice = useCallback(
    () =>
      errorNotice(
        t({
          id: "officeAddin.powerpoint.slidePicture.noRoom",
          message:
            "This message has as many files as it can take. Remove one to add a slide picture.",
        }),
      ),
    [errorNotice],
  );
  const run = useCallback(async () => {
    const start = latest.current;
    const room = roomIn(latest.current);
    if (room <= 0) {
      setNotice(noRoomNotice());
      return;
    }
    const sameChat = () =>
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
    // Nothing is uploaded yet, so a chat switch leaves nothing behind.
    if (!mountedRef.current || !sameChat()) return;
    if (!result.ok) {
      console.warn("[PowerPoint] slide picture", result.reason, result.detail);
      setNotice(errorNotice(renderFailureText(result)));
      return;
    }

    // Counted again here: uploading what cannot be staged would leave uploads no message carries.
    const roomForUpload = roomIn(latest.current);
    if (roomForUpload <= 0) {
      setNotice(noRoomNotice());
      return;
    }
    const rendered = result.pictures.slice(0, roomForUpload);
    const files = rendered.map((picture) => picture.file);
    let uploaded: FileUploadItem[] | undefined;
    try {
      uploaded = await start.uploadFiles?.(files);
    } catch (error) {
      console.warn("[PowerPoint] uploading the slide picture failed", error);
    }
    if (!mountedRef.current) return;
    if (!sameChat()) {
      const uploadedCount = uploaded?.length ?? 0;
      if (uploadedCount > 0)
        setNotice(
          errorNotice(
            t({
              id: "officeAddin.powerpoint.slidePicture.chatSwitched",
              message: plural(uploadedCount, {
                one: "The slide picture finished after you switched chats, so it isn't attached here. Add it again if you need it.",
                other:
                  "The slide pictures finished after you switched chats, so they aren't attached here. Add them again if you need them.",
              }),
            }),
          ),
        );
      return;
    }

    const attached = (uploaded ?? []).slice(
      0,
      Math.max(0, roomIn(latest.current)),
    );
    if (attached.length > 0) {
      const slides = new Map(
        rendered.map((picture) => [picture.file.name, picture]),
      );
      setPictures((previous) => {
        const next = new Map(previous);
        for (const item of attached) {
          const slide = slides.get(item.filename);
          if (slide)
            next.set(item.id, {
              slideId: slide.slideId,
              slideNumber: slide.slideNumber,
            });
        }
        return next;
      });
      latest.current.addUploadedFiles(attached);
    }

    const total = files.length;
    const missing = total - attached.length;
    if (missing > 0) {
      // The composer shows its own upload error with the reason; a second message would repeat it.
      if (useFileUploadStore.getState().error) {
        setNotice(null);
      } else {
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
      }
      if (attached.length === 0) return;
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
    if (missing > 0) return;
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
  }, [errorNotice, noRoomNotice]);

  const attach = useCallback(() => {
    if (busyRef.current || latest.current.locked) return;
    if (useFileUploadStore.getState().isUploading) return;
    busyRef.current = true;
    setBusy(true);
    void run().finally(() => {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    });
  }, [run]);

  const canAttach = available && !locked && !busy && !otherUpload;
  const offer = useMemo(
    () => ({ available, canAttach, busy, attach }),
    [available, canAttach, busy, attach],
  );

  const stagedPictureCount = stagedPictures.length;
  const modelNotice = useMemo<ComposerNotice | null>(
    () =>
      modelCannotRead
        ? {
            id: SLIDE_PICTURE_MODEL_NOTICE_ID,
            tone: "warning",
            text: t({
              id: "officeAddin.powerpoint.slidePicture.modelCannotRead",
              message: plural(stagedPictureCount, {
                one: "The selected model can't see pictures, so it won't read the attached slide picture. Pick another model or remove the picture.",
                other:
                  "The selected model can't see pictures, so it won't read the # attached slide pictures. Pick another model or remove the pictures.",
              }),
            }),
          }
        : null,
    [modelCannotRead, stagedPictureCount],
  );

  const describeFiles = useCallback(
    (fileIds: readonly string[] | undefined) =>
      describeSlidePictures(
        (fileIds ?? []).flatMap((id) => {
          const slide = pictures.get(id);
          return slide ? [slide] : [];
        }),
      ),
    [pictures],
  );

  return {
    offer,
    notice: busy ? notice : (modelNotice ?? notice),
    clearNotice,
    describeFiles,
  };
}
