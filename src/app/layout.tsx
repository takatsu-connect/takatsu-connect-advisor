import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Takatsu Connect Advisor",
  description: "高津コネクト運営アドバイザー",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
