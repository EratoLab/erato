import { useEffect, useState } from "react";

import { SpinnerIcon } from "./SpinnerIcon";

/** Measured from the page load: a start faster than this shows no spinner. */
const SPINNER_AFTER_MS = 1000;

const spinnerDue = () => window.performance.now() >= SPINNER_AFTER_MS;

/**
 * What the app shows until it can draw a page: the theme's page colour and
 * nothing else, plus a spinner once the page is older than a second. Every
 * step of a start shows this same screen, so a person sees one calm screen
 * and then the app. It has no words: it shows before the translations load.
 * Later in the page's life (a page loading its code) the spinner shows at once.
 */
export function StartScreen() {
  const [showSpinner, setShowSpinner] = useState(spinnerDue);

  useEffect(() => {
    if (showSpinner) return;
    const timer = setTimeout(
      () => setShowSpinner(true),
      SPINNER_AFTER_MS - window.performance.now(),
    );
    return () => clearTimeout(timer);
  }, [showSpinner]);

  return (
    <div
      className="flex size-full items-center justify-center"
      aria-busy="true"
      data-ui="start-screen"
      data-testid="start-screen"
    >
      {showSpinner && <SpinnerIcon size="lg" srText="" aria-hidden />}
    </div>
  );
}
