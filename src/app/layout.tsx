import type { Metadata, Viewport } from "next";
import "./globals.css";
import { OWNER_CONFIG, SITE_CONFIG } from "@/config";
import { absoluteUrl } from "@/utils/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.origin),
  title: {
    default: SITE_CONFIG.title,
    template: `%s | ${SITE_CONFIG.brand}`,
  },
  description: SITE_CONFIG.description,
  keywords: SITE_CONFIG.keywords,
  applicationName: SITE_CONFIG.brand,
  authors: [{ name: OWNER_CONFIG.name, url: OWNER_CONFIG.url }],
  creator: OWNER_CONFIG.name,
  publisher: OWNER_CONFIG.name,
  category: "technology",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: `${SITE_CONFIG.basePath}/favicon.svg`,
    shortcut: `${SITE_CONFIG.basePath}/favicon.svg`,
  },
  openGraph: {
    type: "website",
    locale: SITE_CONFIG.locale,
    url: "/",
    siteName: SITE_CONFIG.brand,
    title: SITE_CONFIG.title,
    description: SITE_CONFIG.description,
  },
  twitter: {
    card: "summary",
    title: SITE_CONFIG.title,
    description: SITE_CONFIG.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5c94fc" },
    { media: "(prefers-color-scheme: dark)", color: "#050806" },
  ],
};

// CSS 中的 url() 不会自动加上 basePath，这里通过 CSS 变量注入带 basePath 的地址
const bodyStyle = {
  "--clouds-url": `url('${SITE_CONFIG.basePath}/clouds.svg')`,
  "--digital-rain-url": `url('${SITE_CONFIG.basePath}/digital-rain.svg')`,
} as React.CSSProperties;

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_CONFIG.brand,
  alternateName: SITE_CONFIG.title,
  url: absoluteUrl("/"),
  description: SITE_CONFIG.description,
  inLanguage: "zh-CN",
  publisher: {
    "@type": "Person",
    name: OWNER_CONFIG.name,
    url: OWNER_CONFIG.url,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body style={bodyStyle}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
