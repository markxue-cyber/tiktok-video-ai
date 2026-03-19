import * as Sentry from '@sentry/react'

const dsn = (import.meta as any)?.env?.VITE_SENTRY_DSN || ''

if (dsn) {
  Sentry.init({
    dsn,
    environment: (import.meta as any)?.env?.MODE || 'production',
    tracesSampleRate: Number((import.meta as any)?.env?.VITE_SENTRY_TRACES_SAMPLE_RATE || 0),
  })
}

export { Sentry }

