import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { StartScreen } from "@/components/ui/Feedback/StartScreen";
import { useStartingAssistant } from "@/lib/generated/v1betaApi/v1betaApiComponents";

/**
 * How long to wait for the starting-assistant resolution before falling back
 * to the welcome screen. Landing somewhere must not block on a slow backend.
 */
const STARTING_ASSISTANT_TIMEOUT_MS = 3000;

export default function HomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  // The backend returns one decided answer; `retry: false` keeps the error
  // path well inside the fallback timeout below.
  const { data, error, isLoading } = useStartingAssistant({}, { retry: false });
  const [timedOut, setTimedOut] = useState(false);
  const hasNavigated = useRef(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setTimedOut(true),
      STARTING_ASSISTANT_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hasNavigated.current) return;
    // Wait only while the resolution is pending AND inside the timeout budget.
    if (isLoading && !timedOut) return;
    const assistantId = error
      ? undefined
      : data?.starting_assistant?.assistant_id;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- route paths, not user-facing copy
    const target = assistantId ? `/a/${assistantId}` : "/chat/new";
    hasNavigated.current = true;
    navigate(`${target}${location.search}${location.hash}`, { replace: true });
  }, [
    data,
    error,
    isLoading,
    timedOut,
    location.search,
    location.hash,
    navigate,
  ]);

  useEffect(() => {
    document.title = t({
      id: "branding.page_title_suffix",
      message: "LLM Chat",
    });
  }, []);
  // The answer is usually fetched during the start already (StartPreload),
  // so this shows for a frame at most, looking like the start before it.
  return <StartScreen />;
}
