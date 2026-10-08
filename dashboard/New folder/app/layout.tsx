import "./globals.css";

export const metadata = { title: "TradeLab — Personal Trading Bot", description: "Paper trading and strategy research dashboard" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
