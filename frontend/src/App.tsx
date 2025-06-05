import React, { useEffect } from 'react';
import { Routes, Route, Link, Outlet, Navigate } from 'react-router-dom';
import { ClientProviders } from './components/providers/ClientProviders';

// Page Imports
import HomePage from './pages/HomePage';
import NewChatPage from './pages/NewChatPage';
import ChatDetailPage from './pages/ChatDetailPage';

// Layout Imports
import ChatLayout from './layouts/ChatLayout';

// Placeholder for other actual pages/components if needed
const AboutPage = () => <div>About Page <Link to="/">Go Home</Link></div>; // Keep for now or remove if not used
const NotFoundPage = () => <div>404 - Page Not Found <Link to="/">Go Home</Link></div>;

// Main App Shell (Global Layout - for things outside ChatLayout or other specific layouts)
function App() {
  useEffect(() => {
    document.title = "LLM Chat";
  }, []);

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
      <Route element={<App />}> {/* The App component provides the outermost layout context */}
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />

        {/* Chat section with its own nested layout and routes */}
        <Route path="chat" element={<ChatLayout />}>
          <Route index element={<Navigate to="new" replace />} /> {/* Default /chat to /chat/new */}
          <Route path="new" element={<NewChatPage />} />
          <Route path=":id" element={<ChatDetailPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default AppRoutes; 