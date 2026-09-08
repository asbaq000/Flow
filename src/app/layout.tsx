import type { Metadata, Viewport } from 'next';
import { Outfit, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/*
 * Self-hosted by next/font at build time, so there is no request to Google at
 * runtime and no flash of a fallback face.
 */
const sans = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

/* Data only — ticket numbers, counts, percentages — so columns line up. */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Flow — Task Manager',
  description: 'A Notion-style task manager with an Employee → Team Lead → Dev workflow.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Users can still pinch-zoom; this only stops iOS auto-zooming on inputs.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f9' },
    { media: '(prefers-color-scheme: dark)', color: '#12121a' },
  ],
};

// Applied before paint so a dark-mode reload never flashes white.
const THEME_BOOTSTRAP = `
(function () {
  try {
    // Light is the product default; only an explicit choice moves off it.
    var stored = localStorage.getItem('flow-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
