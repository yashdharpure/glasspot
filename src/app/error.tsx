'use client';

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
        Something went wrong while loading Glasspot. Please try again. If the problem continues, return to your dashboard later.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={reset}>Try again</button>
        <a href="/dashboard">Go to dashboard</a>
      </div>
    </main>
  );
}
