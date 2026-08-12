import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "配布対象リスト管理",
  description: "アパート・マンションのチラシ配布対象を管理する社内ツール",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
