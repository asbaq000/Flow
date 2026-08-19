/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native/WASM database drivers must not be bundled.
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  // The schema is read from disk at runtime, so it must survive tracing.
  outputFileTracingIncludes: { '/**': ['./db/schema.pg.sql'] },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // @xenova/transformers only runs in the browser (voice transcription
      // worker); its Node-only code paths reference these Node built-ins,
      // which webpack must stub out rather than bundle for the client.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        'sharp': false,
        'onnxruntime-node': false,
      };
    }
    return config;
  },
};
export default nextConfig;
