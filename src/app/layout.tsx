import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Shopify Orders Report",
  description: "Local Shopify order reporting app backed by Supabase."
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
