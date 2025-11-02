"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getLocaleFromPath,
  getPathWithoutLocale,
  addLocaleToPath,
  supportedLocales,
} from "../lib/i18n.js";

const LOCALE_STORAGE_KEY = "erato-preferred-locale";

export default function LanguageSwitcher() {
  const pathname = usePathname();
  const currentLocale = getLocaleFromPath(pathname);
  const pathWithoutLocale = getPathWithoutLocale(pathname);

  const languageNames = {
    en: "English",
    de: "Deutsch",
  };

  const handleLanguageClick = (locale: string) => {
    // Save the user's explicit language choice to localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
  };

  return (
    <ul className="space-y-2">
      {supportedLocales.map((locale) => {
        const isActive = locale === currentLocale;
        const href = addLocaleToPath(pathWithoutLocale, locale);

        return (
          <li key={locale}>
            <Link
              href={href}
              onClick={() => handleLanguageClick(locale)}
              className={`text-sm block transition-colors ${
                isActive
                  ? "text-neutral-900 dark:text-neutral-100 font-semibold"
                  : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              {languageNames[locale]}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
