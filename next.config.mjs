/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native/WASM database drivers must not be bundled.
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  // The schema is read from disk at runtime, so it must survive tracing.
  outputFileTracingIncludes: { '/**': ['./db/schema.pg.sql'] },
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
