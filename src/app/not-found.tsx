import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ maxWidth: 680, margin: '4rem auto', padding: '2rem' }}>
      <h1>We couldn’t find that page</h1>
      <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
        The link may be incorrect, or this campaign may not be public.
      </p>
      <Link href="/">Return to Glasspot</Link>
    </main>
  );
}
