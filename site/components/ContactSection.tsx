"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { getLocaleFromPath } from "../lib/i18n.js";

interface ContactSectionProps {
  backgroundColor?: "white" | "gray";
}

export default function ContactSection({
  backgroundColor = "white",
}: ContactSectionProps) {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);

  // Translations
  const translations = {
    en: {
      title: "Get in touch",
      subtitle: "Reach out for requests, feedback or partnerships",
      contactUs: "Contact Us",
      email: "Email",
      repository: "Repository",
    },
    de: {
      title: "Kontakt aufnehmen",
      subtitle:
        "Kontaktieren Sie uns bei Fragen, Feedback oder für Partnerschaften",
      contactUs: "Kontaktieren Sie uns",
      email: "E-Mail",
      repository: "Repository",
    },
  };

  const t = translations[locale] || translations.en;

  const bgClasses =
    backgroundColor === "white" ? "section-bg-primary" : "section-bg-secondary";

  const boxClasses =
    backgroundColor === "white" ? "section-bg-secondary" : "section-bg-primary";

  return (
    <div className={`${bgClasses} py-16 sm:py-24`}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-none">
          <div className="grid grid-cols-1 gap-10 py-16 lg:grid-cols-3">
            <div>
              <h2 className="text-4xl font-semibold tracking-tight text-pretty section-text-heading">
                {t.title}
              </h2>
              <p className="mt-4 text-base leading-7 section-text-body">
                {t.subtitle}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:col-span-2 lg:gap-8">
              <div className={`rounded-2xl p-10 ${boxClasses}`}>
                <div className="flex items-center gap-3">
                  <svg
                    className="h-6 w-6 section-text-accent"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
                    />
                  </svg>
                  <h3 className="text-base leading-7 font-semibold section-text-heading">
                    {t.contactUs}
                  </h3>
                </div>
                <dl className="mt-3 space-y-1 text-sm leading-6 section-text-body-muted">
                  <div>
                    <dt className="sr-only">{t.email}</dt>
                    <dd>
                      <a
                        href="mailto:contact@eratolabs.com"
                        className="font-semibold section-text-accent hover:underline"
                      >
                        contact@eratolabs.com
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
              <div className={`rounded-2xl p-10 ${boxClasses}`}>
                <div className="flex items-center gap-3">
                  <svg
                    className="h-6 w-6 section-text-accent"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <h3 className="text-base leading-7 font-semibold section-text-heading">
                    GitHub
                  </h3>
                </div>
                <dl className="mt-3 space-y-1 text-sm leading-6 section-text-body-muted">
                  <div>
                    <dt className="sr-only">{t.repository}</dt>
                    <dd>
                      <a
                        href="https://github.com/EratoLab/erato"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold section-text-accent hover:underline"
                      >
                        github.com/EratoLab/erato
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
