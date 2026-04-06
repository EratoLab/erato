import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function HomePage() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to the new chat page
    navigate(`/chat/new${location.search}`, { replace: true });
  }, [location.search, navigate]);
  useEffect(() => {
    document.title = t({
      id: "branding.page_title_suffix",
      message: "LLM Chat",
    });
  }, []);
  return (
    <>
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-lg">
          <Trans id="home.redirecting">Redirecting to chat...</Trans>
        </div>
      </div>
    </>
  );
}
