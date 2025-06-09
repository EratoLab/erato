/* eslint-disable lingui/no-unlocalized-strings */
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import React, { useEffect } from "react";
import { Routes, Route, Link, Outlet, Navigate } from "react-router-dom";

import { ClientProviders } from "./components/providers/ClientProviders";
// Page Imports
import ChatLayout from "./layouts/ChatLayout";
import ChatDetailPage from "./pages/ChatDetailPage";
import HomePage from "./pages/HomePage";
import NewChatPage from "./pages/NewChatPage";

// Layout Imports

// Placeholder for other actual pages/components if needed
const AboutPage = () => (
  <div className="p-8">
    <h1 className="mb-4 text-2xl font-bold">
      <Trans id="about.title">About Page</Trans>
    </h1>
    <Link to="/" className="text-blue-500 underline hover:text-blue-700">
      <Trans id="navigation.goHome">Go Home</Trans>
    </Link>
  </div>
); // Keep for now or remove if not used

const NotFoundPage = () => (
  <div className="flex h-screen items-center justify-center">
    <div className="text-center">
      <h1 className="mb-4 text-4xl font-bold text-gray-800">
        <Trans id="error.404.title">404 - Page Not Found</Trans>
      </h1>
      <Link to="/" className="text-blue-500 underline hover:text-blue-700">
        <Trans id="navigation.goHome">Go Home</Trans>
      </Link>
    </div>
  </div>
);

// Main App Shell (Global Layout - for things outside ChatLayout or other specific layouts)
function App() {
  const { _ } = useLingui();

  useEffect(() => {
    document.title = _(t`LLM Chat`);
  }, [_]);

  return (
    <ClientProviders>
      <Outlet />
    </ClientProviders>
  );
}

// This component defines the routes and uses App as its layout
function AppRoutes() {
  return (
    <Routes>
      <Route element={<App />}>
        {" "}
        {/* The App component provides the outermost layout context */}
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        {/* Chat section with its own nested layout and routes */}
        <Route path="chat" element={<ChatLayout />}>
          <Route index element={<Navigate to="new" replace />} />{" "}
          {/* Default /chat to /chat/new */}
          <Route path="new" element={<NewChatPage />} />
          <Route path=":id" element={<ChatDetailPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default AppRoutes;
