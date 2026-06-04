"use client";

import { useEffect } from "react";

const NEW_WEBSITE_URL = "https://eratolabs.com/";

export default function NewWebsiteRedirect() {
  useEffect(() => {
    window.location.replace(NEW_WEBSITE_URL);
  }, []);

  return (
    <main className="min-h-screen bg-erato-light-background text-neutral-950 dark:bg-neutral-950 dark:text-white">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Redirecting to the new website
        </h1>
        <p className="mt-4 text-base text-neutral-600 dark:text-neutral-300">
          You will be sent to eratolabs.com automatically.
        </p>
        <a
          className="mt-8 inline-flex rounded-md bg-erato-green px-4 py-2 text-sm font-medium text-white transition hover:bg-erato-green-dark"
          href={NEW_WEBSITE_URL}
        >
          Continue to eratolabs.com
        </a>
      </div>
    </main>
  );
}
