import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#191919' },
  ],
};

// Applied before paint so a dark-mode reload never flashes white.
const THEME_BOOTSTRAP = `
(function () {
  try {
    // Dark is the product default; only an explicit choice moves off it.
    var stored = localStorage.getItem('flow-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
