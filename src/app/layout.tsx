import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// serif leggero per la scritta gigante MUSIC in hover
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300"],
});

export const metadata: Metadata = {
  title: {
    default: "Collettivo Bistro — Music & Media",
    template: "%s · Collettivo Bistro",
  },
  description:
    "Collettivo Bistro è una cooperativa autogestita che unisce creatività, produzione e cultura, attiva tra Romagna e Lombardia. Produzione, mix e recordings · music videos & photo sessions · live events & culture.",
  keywords: [
    "Collettivo Bistro",
    "Bistro Lab",
    "produzione musicale",
    "recording",
    "mixing",
    "music video",
    "photoshoot",
    "eventi live",
    "Romagna",
    "Lombardia",
  ],
  openGraph: {
    title: "Collettivo Bistro — Music & Media",
    description:
      "Cooperativa autogestita tra Romagna e Lombardia: produzione musicale, video, foto, eventi e cultura.",
    type: "website",
    locale: "it_IT",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
