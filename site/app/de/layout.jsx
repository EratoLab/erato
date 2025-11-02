/**
 * German locale layout for routes like /de/*
 *
 * NOTE: This is a nested layout under the root layout.
 * It should NOT include <html>, <body>, or duplicate the full Layout component.
 * The root layout already provides the HTML structure and Nextra Layout.
 *
 * This layout only exists to provide locale-specific metadata.
 */

export async function generateMetadata() {
  // You can add German-specific metadata here if needed
  return {
    // Inherit from parent layout
  };
}

export default function DeLayout({ children }) {
  // This layout just passes through the children
  // The locale (de) is already being handled by the page component
  return <>{children}</>;
}
