import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ExtensionNoiseGuard } from "@/components/ExtensionNoiseGuard";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Marketing OS",
  description: "Personal marketing command center for apps and brand.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <head>
        {/* Theme flash prevention — applies .dark before paint from localStorage / system. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("mos_theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})();`,
          }}
        />
        {/* Runs before React / wallet extensions so Next overlay ignores ethereum redefine noise */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){function n(m,s){m=m||"";s=s||"";return/chrome-extension:\\/\\//i.test(s)||/moz-extension:\\/\\//i.test(s)||/Cannot redefine property:\\s*ethereum/i.test(m)||/evmAsk\\.js/i.test(s+m)}window.addEventListener("error",function(e){if(n(e.message,e.filename)){e.preventDefault();e.stopImmediatePropagation()}},true);window.addEventListener("unhandledrejection",function(e){var r=e.reason,m=typeof r==="string"?r:r&&r.message?r.message:String(r||"");if(n(m)){e.preventDefault();e.stopImmediatePropagation()}},true)})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ExtensionNoiseGuard />
        {children}
      </body>
    </html>
  );
}
