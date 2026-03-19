import * as Sentry from '@sentry/node'

let inited = false

function ensureInit() {
  if (inited) return
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ''
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  })
  inited = true
}

export function sentryCaptureException(error: unknown, context?: Record<string, any>) {
  try {
    ensureInit()
    const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ''
    if (!dsn) return
    if (context) Sentry.withScope((scope) => {
      Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v as any))
      Sentry.captureException(error)
    })
    else Sentry.captureException(error)
  } catch {
    // ignore sentry failures
  }
}

export function sentryCaptureMessage(message: string, context?: Record<string, any>) {
  try {
    ensureInit()
    const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ''
    if (!dsn) return
    if (context) Sentry.withScope((scope) => {
      Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v as any))
      Sentry.captureMessage(message)
    })
    else Sentry.captureMessage(message)
  } catch {
    // ignore sentry failures
  }
}

