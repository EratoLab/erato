/** A mouse or trackpad, which can rest over a control without pressing it. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS media query, not user-facing
export const HOVERING_POINTER = "(hover: hover) and (pointer: fine)";

/** Any pointer that cannot rest over a control without pressing it. */
export const NO_HOVERING_POINTER = `not all and ${HOVERING_POINTER}`;

/** Below Tailwind's `sm` breakpoint, as `belowQuery("sm")` builds it. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS media query, not user-facing
export const NARROW_SCREEN = "(max-width: 639.98px)";

/** A finger as the main pointer: typing goes through an on-screen keyboard. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS media query, not user-facing
export const TOUCH_POINTER = "(pointer: coarse)";
