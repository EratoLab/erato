import { Trans, useLingui } from "@lingui/react";
import React from "react";
import { createPortal } from "react-dom";

type ComponentKitReactRuntime = typeof React & {
  createPortal: typeof createPortal;
};

const componentKitReactRuntime: ComponentKitReactRuntime = {
  ...React,
  createPortal,
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
