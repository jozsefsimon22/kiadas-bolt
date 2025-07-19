import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/theme-provider';
import { AccentColorProvider } from '@/context/accent-color-context';

export const metadata: Metadata = {
  title: 'Kiadas - Track Your Net Worth',
  description: 'A modern net worth tracker to manage your assets and get AI-powered financial insights.',
};

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AccentColorProvider>
            {children}
            <Toaster />
          </AccentColorProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
