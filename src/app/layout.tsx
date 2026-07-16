import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Kuviyal Tracking",
  description: "Kuviyal Shopify sync and courier tracking report.",
  icons: {
    icon: [
      {
        type: "image/svg+xml",
        url: "/favicon.svg"
      },
      {
        type: "image/svg+xml",
        url: "/favicon.ico"
      }
    ],
    shortcut: "/favicon.ico"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
