// @sentry/nextjs loads as CommonJS here, so take the helper off the default export.
import sentryNext from '@sentry/nextjs';

const { withSentryConfig } = sentryNext;

/** @type {import('next').NextConfig} */
// Phase 0 remediation (2026-08-10):
// Removed eslint.ignoreDuringBuilds and typescript.ignoreBuildErrors
// so that TypeScript and ESLint errors are surfaced during builds.
// Audit items: Item 1 (ignoreBuildErrors) and Item 2 (ignoreDuringBuilds)
const nextConfig = {
  // Playwright starts its own dev server with NEXT_DIST_DIR=.next-e2e so it never
  // shares .next with the normal dev server on port 3000.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Page protection (owner 2026-11-12, audit follow-up). No other site may show these pages inside a frame
  // (a hidden POS screen under a fake button); no page address is sent to other sites; the camera (ID card scan)
  // is allowed for this site only. HSTS and a full Content-Security-Policy come with the real domain + HTTPS.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

// Sentry source-map upload (readable stack traces) runs only when SENTRY_AUTH_TOKEN is set,
// so local builds never call sentry.io.
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
