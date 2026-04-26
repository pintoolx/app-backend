import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  // BFF talks to the Nest backend over server-side fetch only; no rewrites
  // needed (we proxy explicitly through /api/admin/proxy/[...path]).
};

export default withNextIntl(nextConfig);
