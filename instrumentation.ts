import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from '@/lib/sentry-options'

export function register() {
  Sentry.init(sentryOptions)
}

// Reports errors thrown in server components, route handlers and server actions.
export const onRequestError = Sentry.captureRequestError
