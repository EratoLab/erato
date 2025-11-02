import { useLingui } from "@lingui/react";
import { useEffect, useState } from "react";

import type { Locale } from "date-fns";

/**
 * Hook to get the date-fns locale object based on the current Lingui locale
 * This ensures that date formatting (especially relative times) matches the user's language
 */
export function useDateFnsLocale(): Locale | undefined {
  const { i18n } = useLingui();
  const [dateFnsLocale, setDateFnsLocale] = useState<Locale | undefined>(
    undefined,
  );

  useEffect(() => {
    const loadLocale = async () => {
      const currentLocale = i18n.locale;

      try {
        let locale: Locale;

        // Map Lingui locale codes to date-fns locale imports
        // Locale codes and import paths are technical identifiers, not user-facing text
        /* eslint-disable lingui/no-unlocalized-strings */
        switch (currentLocale) {
          case "de":
            locale = (await import("date-fns/locale/de")).de;
            break;
          case "fr":
            locale = (await import("date-fns/locale/fr")).fr;
            break;
          case "pl":
            locale = (await import("date-fns/locale/pl")).pl;
            break;
          case "es":
            locale = (await import("date-fns/locale/es")).es;
            break;
          case "en":
          default:
            // English (US) is the default locale in date-fns, so we can use undefined
            // or explicitly load it if needed
            locale = (await import("date-fns/locale/en-US")).enUS;
            break;
        }
        /* eslint-enable lingui/no-unlocalized-strings */

        setDateFnsLocale(locale);
      } catch (error) {
        console.error(
          `Failed to load date-fns locale for ${currentLocale}:`,
          error,
        );
        // Fall back to undefined (which uses English)
        setDateFnsLocale(undefined);
      }
    };

    void loadLocale();
  }, [i18n.locale]);

  return dateFnsLocale;
}
