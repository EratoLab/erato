import { Footer, Layout } from "nextra-theme-docs";
import { Banner, Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Dongle } from "next/font/google";
import LanguageDetection from "../components/LanguageDetection.jsx";
import CustomFooter from "../components/CustomFooter.jsx";
import CustomNavbar from "../components/CustomNavbar.jsx";

import "./globals.css";

const dongle = Dongle({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dongle",
});

export const metadata = {
  // Define your metadata here
  // For more information on metadata API, see: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
  icons: {
    icon: [
      {
        url: "/favicon.ico",
        sizes: "any",
      },
      {
        url: "/favicon.svg",
        type: "image/svg+xml",
      },
    ],
  },
};

// const banner = <Banner storageKey="some-key">Nextra 4.0 is released 🎉</Banner>
const navbar = <CustomNavbar />;
const footer = <CustomFooter />;

export default async function RootLayout({ children }) {
  return (
    <html
      // Not required, but good for SEO
      lang="en"
      // Required to be set
      dir="ltr"
      // Suggested by `next-themes` package https://github.com/pacocoursey/next-themes#with-app
      suppressHydrationWarning
      className={`${dongle.variable}`}
    >
      <Head
      // ... Your additional head options
      >
        {/* Favicon links */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {/* Your additional tags should be passed as `children` of `<Head>` element */}
      </Head>
      <body>
        <LanguageDetection>
          <Layout
            navbar={navbar}
            pageMap={await getPageMap()}
            docsRepositoryBase="https://github.com/EratoLab/erato/tree/main/site"
            footer={footer}
            // ... Your additional layout options
          >
            {children}
          </Layout>
        </LanguageDetection>
      </body>
    </html>
  );
}
