/* eslint-disable lingui/no-unlocalized-strings */
import { Trans } from "@lingui/react/macro";
import { lazy, Suspense } from "react";
import { Routes, Route, Link, Outlet, Navigate } from "react-router-dom";

import { ClientProviders } from "./components/providers/ClientProviders";
// These logic-only route sentinels must not suspend while a newly created chat
// switches from /chat/new to /chat/:id; doing so hides the optimistic messages.
import ChatDetailPage from "./pages/ChatDetailPage";
import HomePage from "./pages/HomePage";
import NewChatPage from "./pages/NewChatPage";

const AssistantChatLayout = lazy(() => import("./layouts/AssistantChatLayout"));
const AssistantsLayout = lazy(() => import("./layouts/AssistantsLayout"));
const ChatLayout = lazy(() => import("./layouts/ChatLayout"));
const SearchLayout = lazy(() => import("./layouts/SearchLayout"));
const AssistantChatSpacePage = lazy(
  () => import("./pages/AssistantChatSpacePage"),
);
const AssistantCreatePage = lazy(() => import("./pages/AssistantCreatePage"));
const AssistantEditPage = lazy(() => import("./pages/AssistantEditPage"));
const AssistantHubDetailPage = lazy(
  () => import("./pages/AssistantHubDetailPage"),
);
const AssistantHubMyPage = lazy(() => import("./pages/AssistantHubMyPage"));
const AssistantHubReviewPage = lazy(
  () => import("./pages/AssistantHubReviewPage"),
);
const AssistantHubSubmitPage = lazy(
  () => import("./pages/AssistantHubSubmitPage"),
);
const AssistantsPage = lazy(() => import("./pages/AssistantsPage"));
const DesktopSidecarSetupPage = lazy(
  () => import("./pages/DesktopSidecarSetupPage"),
);
const SearchPage = lazy(() => import("./pages/SearchPage"));
const SharedChatPage = lazy(() => import("./pages/SharedChatPage"));

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
  return (
    <ClientProviders>
      <Suspense
        fallback={
          <div
            className="flex min-h-screen items-center justify-center"
            role="status"
          >
            <span className="size-6 animate-spin rounded-full border-2 border-theme-border border-t-theme-fg-primary" />
            <span className="sr-only">
              <Trans id="common.loadingEllipsis">Loading...</Trans>
            </span>
          </div>
        }
      >
        <Outlet />
      </Suspense>
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
        <Route
          path="desktop-sidecar/setup"
          element={<DesktopSidecarSetupPage />}
        />
        {/* Chat section with its own nested layout and routes */}
        <Route path="chat" element={<ChatLayout />}>
          <Route index element={<Navigate to="new" replace />} />{" "}
          {/* Default /chat to /chat/new */}
          <Route path="new" element={<NewChatPage />} />
          <Route path=":id" element={<ChatDetailPage />} />
        </Route>
        <Route path="chat-share/:shareId" element={<SharedChatPage />} />
        {/* Assistant chat space - /a/:assistantId shows assistant welcome + past chats */}
        <Route path="a">
          <Route path=":assistantId" element={<AssistantChatLayout />}>
            <Route index element={<AssistantChatSpacePage />} />
            <Route path=":chatId" element={<AssistantChatSpacePage />} />
          </Route>
        </Route>
        {/* Search section with its own layout */}
        <Route path="search" element={<SearchLayout />}>
          <Route index element={<SearchPage />} />
        </Route>
        {/* Assistants section with its own layout */}
        <Route path="assistants" element={<AssistantsLayout />}>
          <Route index element={<AssistantsPage view="shared_with_user" />} />
          <Route
            path="created"
            element={<AssistantsPage view="owned_by_user" />}
          />
          <Route path="new" element={<AssistantCreatePage />} />
          <Route path=":id/edit" element={<AssistantEditPage />} />
        </Route>
        <Route path="assistant-hub" element={<AssistantsLayout />}>
          <Route index element={<AssistantsPage view="hub" />} />
          <Route path="my" element={<AssistantHubMyPage />} />
          <Route path="my/:versionId" element={<AssistantHubMyPage />} />
          <Route path="review" element={<AssistantHubReviewPage />} />
          <Route
            path="review/:versionId"
            element={<AssistantHubReviewPage />}
          />
          <Route
            path="category/:categoryId"
            element={<AssistantsPage view="hub" />}
          />
          <Route
            path="submit/:sourceAssistantId"
            element={<AssistantHubSubmitPage />}
          />
          <Route path=":hubAssistantId" element={<AssistantHubDetailPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default AppRoutes;
