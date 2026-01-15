import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ReduxTC WiFi",
  description: "MSP-friendly UniFi external captive portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}
