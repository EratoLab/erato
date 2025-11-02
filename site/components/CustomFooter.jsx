"use client";

import { Footer } from "nextra-theme-docs";
import LanguageSwitcher from "./LanguageSwitcher";

export default function CustomFooter() {
  return (
    <div>
      <div className="border-t border-gray-200 dark:border-gray-800 py-4 px-6">
        <LanguageSwitcher />
      </div>
      <Footer />
    </div>
  );
}

