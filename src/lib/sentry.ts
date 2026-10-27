// Client-side error monitoring. Sentry is only loaded (and initialized) when
// VITE_SENTRY_DSN is configured, so it never ships/loads for builds without it.
const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export async function initSentry(): Promise<void> {
  if (!DSN) return;
  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.MODE,
      // Errors only - no session replay / performance tracing of user content.
      tracesSampleRate: 0,
    });
  } catch {
    // Monitoring must never break the app
  }
}

export function captureException(error: unknown): void {
  if (!DSN) return;
  import('@sentry/react')
    .then((Sentry) => Sentry.captureException(error))
    .catch(() => {});
}
