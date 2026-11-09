import type { Metadata, Viewport } from "next";
import { Archivo, Azeret_Mono } from "next/font/google";
import "./globals.css";
import { Footer, Header } from "@/components/Chrome";
import { SessionProvider } from "@/lib/session";

/* Archivo across its width axis: expanded for map titles, normal for reading. Azeret Mono for coordinates and figures. */
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", axes: ["wdth"], display: "swap" });
const azeret = Azeret_Mono({ subsets: ["latin"], variable: "--font-azeret", display: "swap" });

export const metadata: Metadata = {
  title: "Offmap · Borrow without becoming a target",
  description: "Borrow USDC against cbBTC or ETH on real Morpho liquidity. Nobody can see your loan, your collateral or your liquidation price.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0c0e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${azeret.variable}`}>
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
