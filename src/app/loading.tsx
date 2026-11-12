export default function Loading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{ maxWidth: 960, margin: '3rem auto', padding: '2rem' }}
    >
      <p style={{ color: 'var(--muted)' }}>Loading Glasspot...</p>
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ height: 72, borderRadius: 12, background: 'var(--soft)' }} />
        <div style={{ height: 180, borderRadius: 12, background: 'var(--card)', border: '1px solid var(--line)' }} />
      </div>
    </main>
  );
}
