import { Trans, useLingui } from "@lingui/react";
import React from "react";
import { createPortal, flushSync } from "react-dom";

type ComponentKitReactRuntime = typeof React & {
  createPortal: typeof createPortal;
  flushSync: typeof flushSync;
};

const componentKitReactRuntime: ComponentKitReactRuntime = {
  ...React,
  createPortal,
  flushSync,
};

(window as Window & { ERATO_REACT?: ComponentKitReactRuntime }).ERATO_REACT =
  componentKitReactRuntime;
(
  window as Window & {
    ERATO_LINGUI_REACT?: { Trans: typeof Trans; useLingui: typeof useLingui };
  }
).ERATO_LINGUI_REACT = {
  Trans,
  useLingui,
};
