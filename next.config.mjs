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
