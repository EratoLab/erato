import type {
  Trans as LinguiTrans,
  useLingui as useHostLingui,
} from "@lingui/react";
import type * as ReactModule from "react";

type HostReact = typeof ReactModule & {
  createPortal?: unknown;
};

declare global {
  interface Window {
    ERATO_REACT?: HostReact;
    ERATO_LINGUI_REACT?: {
      Trans: typeof LinguiTrans;
      useLingui: typeof useHostLingui;
    };
  }
}

const hostReact = window.ERATO_REACT;
if (!hostReact) {
  throw new Error("ERATO_REACT is not available for component kits");
}

export const h = hostReact.createElement.bind(
  hostReact,
) as typeof ReactModule.createElement;

const hostLinguiReact = window.ERATO_LINGUI_REACT;
if (!hostLinguiReact) {
  throw new Error("ERATO_LINGUI_REACT is not available for component kits");
}

export const Trans: typeof LinguiTrans = hostLinguiReact.Trans;
export const useLingui: typeof useHostLingui = hostLinguiReact.useLingui;
