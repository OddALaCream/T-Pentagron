import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Fija la raíz del proyecto (evita que Turbopack tome lockfiles de carpetas superiores).
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
