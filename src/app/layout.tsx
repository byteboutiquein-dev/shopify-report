import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Kuviyal Tracking",
  description: "Kuviyal Shopify sync and courier tracking report."
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
