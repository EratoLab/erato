"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getLocaleFromPath, getPathWithoutLocale, addLocaleToPath, supportedLocales } from "../lib/i18n.js";

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
    <div className="flex gap-2 items-center">
      <span className="text-sm text-gray-600 dark:text-gray-400">Language:</span>
      {supportedLocales.map((locale) => {
        const isActive = locale === currentLocale;
        const href = addLocaleToPath(pathWithoutLocale, locale);
        
        return (
          <Link
            key={locale}
            href={href}
            onClick={() => handleLanguageClick(locale)}
            className={`px-2 py-1 text-sm rounded ${
              isActive
                ? "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 font-semibold"
                : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {languageNames[locale]}
          </Link>
        );
      })}
    </div>
  );
}

