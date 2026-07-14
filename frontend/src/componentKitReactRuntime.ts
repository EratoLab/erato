import { Trans, useLingui } from "@lingui/react";
import React from "react";
import { createPortal } from "react-dom";

import { useTraceFeature } from "./providers/FeatureConfigProvider";

type ComponentKitReactRuntime = typeof React & {
  createPortal: typeof createPortal;
};

type ComponentKitFeatureRuntime = {
  useTraceFeature: typeof useTraceFeature;
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

(
  window as Window & {
    ERATO_FEATURES?: ComponentKitFeatureRuntime;
  }
).ERATO_FEATURES = {
  useTraceFeature,
};
