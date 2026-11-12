'use client';

import Button from '@/components/button';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main role="alert" style={{ maxWidth: 680, margin: '4rem auto', padding: '2rem' }}>
      <h1>We couldn’t load this page</h1>
      <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
        Glasspot could not complete that request or load this page. Refresh and check the current data before trying again.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button type="button" variant="primary" onClick={reset}>Try again</Button>
        <a href="/dashboard">Go to dashboard</a>
      </div>
    </main>
  );
}
