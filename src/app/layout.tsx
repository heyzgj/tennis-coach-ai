import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css"; // Your global styles

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI Tennis Coach",
  description: "Get real-time feedback on your tennis swing, powered by Gemini.",
};

export default function RootLayout({
    children,
  }: Readonly<{
    children: React.ReactNode;
  }>) {
    return (
      <html lang="en" className="dark">
        <body className={inter.className}>{children}</body>
      </html>
    );
  }