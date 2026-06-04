"use client";

import { usePathname } from "next/navigation";
import NewWebsiteRedirect from "./NewWebsiteRedirect.jsx";

export default function NotFoundRedirect() {
  const pathname = usePathname();

  if (pathname.startsWith("/docs")) {
    return (
      <main className="min-h-screen bg-erato-light-background text-neutral-950 dark:bg-neutral-950 dark:text-white">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
          <h1 className="text-3xl font-semibold sm:text-4xl">
            Documentation page not found
          </h1>
          <a
            className="mt-8 inline-flex rounded-md bg-erato-green px-4 py-2 text-sm font-medium text-white transition hover:bg-erato-green-dark"
            href="/docs"
          >
            Back to documentation
          </a>
        </div>
      </main>
    );
  }

  return <NewWebsiteRedirect />;
}
