import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Footer, Header } from "@/components/Chrome";
import { SessionProvider } from "@/lib/session";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz", "SOFT"], style: ["normal", "italic"] });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", weight: ["400", "500"] });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex-sans", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Offmap · Borrow off the map",
  description: "Borrow USDC against your crypto on real Morpho liquidity, and nobody can see your loan, your collateral or your liquidation price.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3eee2" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1324" },
  ],
};

const themeScript = `try{var t=localStorage.getItem("offmap.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexMono.variable} ${plexSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="survey-grid min-h-screen">
        <SessionProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
