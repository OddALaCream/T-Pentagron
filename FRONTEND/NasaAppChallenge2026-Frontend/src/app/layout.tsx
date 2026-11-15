import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { brand } from '@/config/brand';
import './globals.css';

const sans = localFont({
  src: './fonts/instrument-sans.woff2',
  variable: '--font-sans',
  weight: '400 700',
  display: 'swap',
});

const mono = localFont({
  src: './fonts/ibm-plex-mono.woff2',
  variable: '--font-mono',
  weight: '400 600',
  display: 'swap',
});

export const metadata: Metadata = {
  title: `${brand.name} · ${brand.tagline}`,
  description: `${brand.fullName}: exploración 3D de la actividad térmica observada por MODIS y VIIRS, armonización y pronóstico experimental. ${brand.event}.`,
  applicationName: brand.name,
};

export const viewport: Viewport = {
  themeColor: '#010309',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
