import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

async function findDemoCampaign() {
  const service = createServiceClient();
  const { data, error } = await service
    .from('campaigns')
    .select('title, slug')
    .eq('title', 'Ward 4 Flood Relief')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load the demo campaign link: ${error.message}`);
  }

  return data;
}

export default async function Home() {
  const demoCampaign = await findDemoCampaign();

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <header style={{ maxWidth: 720 }}>
        <p style={{ margin: 0, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Glasspot
        </p>
        <h1 style={{ margin: '0.75rem 0', fontSize: 'clamp(2.5rem, 8vw, 4.5rem)', lineHeight: 1.05 }}>
          Every rupee in plain sight.
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '1.2rem', lineHeight: 1.7 }}>
          A live, public ledger for community campaigns. Track what was needed, what came in, and where it went.
        </p>
        <a
          href="/login"
          style={{ display: 'inline-block', marginTop: '0.75rem', padding: '0.8rem 1.2rem', borderRadius: 9, background: 'var(--blue)', color: 'white', textDecoration: 'none', fontWeight: 700 }}
        >
          Log in
        </a>
        {demoCampaign ? (
          <p style={{ marginTop: '1rem' }}>
            <a href={`/c/${demoCampaign.slug}`}>View the {demoCampaign.title} demo ledger</a>
          </p>
        ) : null}
      </header>

      <section aria-labelledby="how-it-works" style={{ marginTop: '3.5rem' }}>
        <h2 id="how-it-works">How it works</h2>
        <ol style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', padding: 0, listStyle: 'none' }}>
          <li style={{ padding: '1.25rem', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--card)' }}>
            <strong>1. Connect your Claude</strong>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>Give your own Claude account the Glasspot connector URL and describe the campaign.</p>
          </li>
          <li style={{ padding: '1.25rem', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--card)' }}>
            <strong>2. Review the ledger</strong>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>Glasspot records needs, contributions, and spend requests. You control human approvals and edits.</p>
          </li>
          <li style={{ padding: '1.25rem', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--card)' }}>
            <strong>3. Share the public page</strong>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>Donors can follow campaign progress through a live public ledger.</p>
          </li>
        </ol>
      </section>

      <footer style={{ marginTop: '2.5rem', borderTop: '1px solid var(--line)', paddingTop: '1rem', color: 'var(--muted)' }}>
        Payments and accounting export are simulated.
      </footer>
    </main>
  );
}
