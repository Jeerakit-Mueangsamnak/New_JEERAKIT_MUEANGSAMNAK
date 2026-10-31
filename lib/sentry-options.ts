// Shared Sentry options for browser, server and edge. Sentry stays off until
// NEXT_PUBLIC_SENTRY_DSN is set, and never runs in dev or tests.
// Customer data stays out: no IP/cookies (sendDefaultPii false) and no session replay.
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && process.env.NODE_ENV === 'production',
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'production',
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
}
