"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Client component that translates search placeholder based on current route
 */
export function useSearchPlaceholder() {
  const pathname = usePathname();
  const isGerman = pathname.startsWith("/de");

  return isGerman ? "Dokumentation durchsuchen…" : "Search documentation…";
}

export default function SearchConfig() {
  const searchPlaceholder = useSearchPlaceholder();

  useEffect(() => {
    // Update the search input placeholder
    const searchInput = document.querySelector('input[type="search"]');
    if (searchInput) {
      searchInput.placeholder = searchPlaceholder;
    }
  }, [searchPlaceholder]);

  return null;
}
