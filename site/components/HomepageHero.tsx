"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getLocaleFromPath, addLocaleToPath } from "../lib/i18n.js";

export default function HomepageHero() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);

  // Translations
  const translations = {
    en: {
      oneLiner: "The Open Source AI Platform",
      tagline:
        "Erato brings the productivity of modern LLMs into your infrastructure – on-premise, compliant, open-source — on your terms.",
      tagline2: null,
      cta: "GET STARTED",
    },
    // TODO: German variant
    de: {
      oneLiner: "Die Open Source AI Platform",
      tagline: "Der KI-Chat für On-Premise",
      tagline2: "und passend für die Bedürfnisse Ihrer Organisation.",
      cta: "LOSLEGEN",
    },
  };

  const t = translations[locale] || translations.en;
  const docsPath = addLocaleToPath("/docs", locale);

  return (
    <div className="flex flex-col md:flex-col max-w-[60rem] mx-auto px-6 py-10">
      <div className="w-full">
        <div className="text-8xl font-black text-center">{t.oneLiner}</div>
        <div className="text-lg pt-2 text-center">
          {t.tagline}
          <br /> {t.tagline2}
        </div>
      </div>
      <div className="flex flex-col mt-4 md:mt-8 gap-4 justify-center font-bold text-center">
        <Link
          href={docsPath}
          role="button"
          className="inline-block py-3 px-12 rounded-md bg-erato-green dark:bg-[#10b981] hover:bg-[#059669] dark:hover:bg-[#059669] active:bg-[#047857] dark:active:bg-[#047857] text-white dark:text-black transition-colors duration-200 ease-in-out shadow-md hover:shadow-lg"
        >
          {t.cta}
        </Link>
      </div>
    </div>
  );
}
