import { createContext, useContext } from "react";

import type { SlidePictureOffer } from "../hooks/usePowerPointSlidePictures";

export interface PowerPointComposerContextValue {
  slidePicture: SlidePictureOffer;
}

export const PowerPointComposerContext =
  createContext<PowerPointComposerContextValue | null>(null);

/** Null outside the PowerPoint composer. */
export const usePowerPointComposer =
  (): PowerPointComposerContextValue | null =>
    useContext(PowerPointComposerContext);
