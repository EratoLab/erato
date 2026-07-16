// FROZEN — do not add to this file or to the ERATO_* window surface.
// Host modules are shared with kits via the import map (see
// shared-modules.config.ts); new host surface = a src/shared/ expose entry.
// The globals below exist only for kit bundles built before the import-map
// contract and go away once no deployed kit reads them.
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
