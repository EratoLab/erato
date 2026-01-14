/* eslint-disable lingui/no-unlocalized-strings */
/**
 * Why Did You Render - Development Performance Debugging
 *
 * This module patches React to log unnecessary re-renders to the console.
 * Only enabled in development mode.
 *
 * To track a specific component, add:
 *   MyComponent.whyDidYouRender = true;
 *
 * Or for class components:
 *   static whyDidYouRender = true;
 *
 * @see https://github.com/welldone-software/why-did-you-render
 */
import React from "react";

if (process.env.NODE_ENV === "development") {
  void import("@welldone-software/why-did-you-render").then(
    (whyDidYouRender) => {
      whyDidYouRender.default(React, {
        trackAllPureComponents: true,
        trackHooks: true,
        logOnDifferentValues: true,
      });
    },
  );
}
