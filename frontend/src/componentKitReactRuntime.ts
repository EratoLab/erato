import { Trans, useLingui } from "@lingui/react";
import React from "react";

(window as Window & { ERATO_REACT?: typeof React }).ERATO_REACT = React;
(
  window as Window & {
    ERATO_LINGUI_REACT?: { Trans: typeof Trans; useLingui: typeof useLingui };
  }
).ERATO_LINGUI_REACT = {
  Trans,
  useLingui,
};
