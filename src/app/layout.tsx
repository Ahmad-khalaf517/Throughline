import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { MotionProvider } from '@/components/marketing/motion/motion-provider';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://throughline-mauve-three.vercel.app',
  ),
  title: 'Throughline',
  description: 'AI-assisted project scaffolding with deterministic lineage tracking.',
  openGraph: {
    title: 'Throughline — Every decision keeps its lineage',
    description: 'From brief to backlog, connected.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
      style={{ colorScheme: 'light' }}
    >
      <body className="bg-surface text-on-surface flex min-h-full flex-col">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
