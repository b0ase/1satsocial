import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { AccountButton } from "@/components/account-button";
import { getSession } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "1satsocial: holder-only chat for 1Sat Ordinals",
  description:
    "Every BSV-21 token, BSV-20 tick and 1Sat Ordinals collection gets its own group chat. Only holders get in. Sign in with Yours Wallet.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-[11px] font-bold text-black">1</span>
              <span>
                1sat<span className="text-gold">social</span>
              </span>
            </Link>
            <nav className="ml-auto mr-4 flex items-center gap-5 text-sm text-muted">
              <Link href="/market" className="hover:text-text">
                Market
              </Link>
            </nav>
            <AccountButton session={session ? { userId: session.userId, name: session.name, wallet: session.wallet, addresses: session.addresses.length } : null} />
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
