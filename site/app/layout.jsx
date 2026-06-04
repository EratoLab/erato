import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata = {
  icons: {
    icon: [
      {
        url: "/favicon.svg",
        type: "image/svg+xml",
      },
      {
        url: "/favicon-dark.png",
        media: "(prefers-color-scheme: dark)",
        type: "image/png",
      },
      {
        url: "/favicon-light.png",
        media: "(prefers-color-scheme: light)",
        type: "image/png",
      },
      {
        url: "/favicon-dark.ico",
        media: "(prefers-color-scheme: dark)",
        sizes: "any",
      },
      {
        url: "/favicon.ico",
        media: "(prefers-color-scheme: light)",
        sizes: "any",
      },
    ],
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
