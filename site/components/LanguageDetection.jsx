"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { detectLocale, getValidLocale, getLocaleFromPath } from "../lib/i18n.js";

const LOCALE_STORAGE_KEY = "erato-preferred-locale";

export default function LanguageDetection({ children }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Only detect on root path
    if (pathname !== "/") {
      return;
    }

    // Check if user has explicitly set a language preference
    const savedLocale = typeof window !== "undefined" 
      ? localStorage.getItem(LOCALE_STORAGE_KEY) 
      : null;
    
    if (savedLocale) {
      // User has explicitly chosen a language - respect that choice
      const validSavedLocale = getValidLocale(savedLocale);
      
      // Only redirect if the saved preference is not the default locale (en)
      if (validSavedLocale === "de") {
        router.replace("/de/");
      }
      // If saved locale is "en", we're already on the right page (/)
      return;
    }

    // No saved preference - detect locale from browser
    const detectedLocale = detectLocale(
      typeof navigator !== "undefined" ? navigator.language : "en"
    );
    
    const validLocale = getValidLocale(detectedLocale);
    
    // If German is detected, redirect to /de/
    if (validLocale === "de") {
      router.replace("/de/");
    }
    // Otherwise, stay at root (children will render English content)
  }, [router, pathname]);

  return <>{children}</>;
}

