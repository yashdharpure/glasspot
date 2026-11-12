import { notFound } from 'next/navigation';

import { createServiceClient } from '@/lib/supabase/service';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

async function getPublicCampaign(slug: string) {
  const service = createServiceClient();

  const { data: campaign, error } = await service
    .from('campaigns')
    .select('*')
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load this campaign: ${error.message}`);
  }

  if (!campaign) {
    return null;
  }

  const [needsResult, contributionsResult, spendsResult] = await Promise.all([
    service.from('needs').select('*').eq('campaign_id', campaign.id).order('created_at', { ascending: true }),
    service.from('contributions').select('*').eq('campaign_id', campaign.id).order('created_at', { ascending: true }),
    service.from('spends').select('*').eq('campaign_id', campaign.id).order('created_at', { ascending: true }),
  ]);

  const readError = needsResult.error ?? contributionsResult.error ?? spendsResult.error;
  if (readError) {
    throw new Error(`Could not load campaign details: ${readError.message}`);
  }

  return {
    campaign,
    needs: needsResult.data ?? [],
    contributions: contributionsResult.data ?? [],
    spends: spendsResult.data ?? [],
  };
}

export default async function PublicCampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const publicCampaign = await getPublicCampaign(slug);

  if (!publicCampaign) {
    notFound();
  }

  const { campaign, needs, contributions, spends } = publicCampaign;

  const cashReceived = contributions
    .filter((row) => row.type === 'cash' && row.status === 'received')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const spentSoFar = spends
    .filter((row) => row.status === 'approved' || row.status === 'rejected')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem 3rem', background: '#EEF3F2', color: '#14272E' }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #D5DFDD', borderRadius: 18, padding: '1.5rem', boxShadow: '0 8px 26px rgba(20,39,46,0.04)' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, color: '#5B6E74', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 12 }}>Live and public</p>
          <h1 style={{ margin: '0.35rem 0 0', fontSize: '2.2rem' }}>{campaign.title}</h1>
          <p style={{ marginTop: '0.75rem', color: '#5B6E74', lineHeight: 1.6 }}>{campaign.description || 'Campaign details updated live.'}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ background: '#E3EEF1', border: '1px solid #D5DFDD', borderRadius: 14, padding: '1rem' }}>
            <div style={{ color: '#5B6E74', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 12 }}>Cash received</div>
            <div style={{ marginTop: '0.5rem', fontSize: '1.8rem', fontWeight: 700 }}>{currency.format(cashReceived)}</div>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #D5DFDD', borderRadius: 14, padding: '1rem' }}>
            <div style={{ color: '#5B6E74', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 12 }}>Spent so far</div>
            <div style={{ marginTop: '0.5rem', fontSize: '1.8rem', fontWeight: 700 }}>{currency.format(spentSoFar)}</div>
          </div>
        </div>

        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>What is needed</h2>
          <div style={{ display: 'grid', gap: '1rem' }}>
            {needs.length === 0 ? (
              <p style={{ color: '#5B6E74' }}>No needs have been listed yet.</p>
            ) : needs.map((need) => {
              const linkedContributions = contributions.filter((row) => row.need_id === need.id);
              const received = linkedContributions
                .filter((row) => row.type !== 'cash' && row.status === 'received')
                .reduce((sum, row) => sum + Number(row.amount || 0), 0);
              const pledged = linkedContributions
                .filter((row) => row.type !== 'cash' && row.status === 'pledged')
                .reduce((sum, row) => sum + Number(row.amount || 0), 0);
              const total = Math.max(1, Number(need.qty_needed));
              const receivedPct = Math.min(100, (received / total) * 100);
              const pledgedPct = Math.min(100, ((received + pledged) / total) * 100);

              return (
                <div key={need.id} style={{ background: '#FFFFFF', border: '1px solid #D5DFDD', borderRadius: 12, padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <div>
                      <strong>{need.item}</strong>
                      <div style={{ color: '#5B6E74', fontSize: 13 }}>Need: {need.qty_needed} {need.unit}</div>
                    </div>
                    <div style={{ color: '#5B6E74', fontSize: 13 }}>Location: {need.location || 'General'}</div>
                  </div>
                  <div style={{ height: 12, borderRadius: 99, overflow: 'hidden', background: '#E3EEF1', display: 'flex' }}>
                    <div style={{ width: `${receivedPct}%`, background: '#2E8B57' }} />
                    <div style={{ width: `${Math.max(0, pledgedPct - receivedPct)}%`, background: '#F2A900' }} />
                  </div>
                  <div style={{ marginTop: '0.6rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', color: '#5B6E74', fontSize: 13 }}>
                    <span>Received: {received}</span>
                    <span>Pledged: {pledged}</span>
                    <span>Remaining: {Math.max(0, Number(need.qty_needed) - received)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Who gave</h2>
          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #D5DFDD', background: '#FFFFFF' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead style={{ background: '#E3EEF1' }}>
                <tr>
                  <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left' }}>Donor</th>
                  <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left' }}>Amount / qty</th>
                  <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {contributions.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: '1rem', color: '#5B6E74' }}>No contributions have been recorded yet.</td></tr>
                ) : contributions.map((row) => (
                  <tr key={row.id}>
                    <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{row.donor_name}</td>
                    <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                      {row.type === 'cash' ? currency.format(Number(row.amount)) : `${row.amount} ${row.type === 'goods' ? 'goods' : 'hours'}`}
                    </td>
                    <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                      <span style={{ display: 'inline-block', padding: '0.35rem 0.65rem', borderRadius: 999, background: row.status === 'received' ? '#E3F5EA' : '#FFF1D6', color: row.status === 'received' ? '#2E8B57' : '#C68B00', fontWeight: 700 }}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 style={{ marginBottom: '1rem' }}>Where it went</h2>
          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #D5DFDD', background: '#FFFFFF' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead style={{ background: '#E3EEF1' }}>
                <tr>
                  <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left' }}>Payee</th>
                  <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left' }}>Purpose</th>
                  <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {spends.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: '1rem', color: '#5B6E74' }}>No spend activity has been recorded yet.</td></tr>
                ) : spends.map((row) => (
                  <tr key={row.id}>
                    <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{row.payee}</td>
                    <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                      {row.status === 'pending' ? 'awaiting approval' : row.status === 'rejected' ? 'rejected' : row.purpose || '—'}
                    </td>
                    <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                      {row.status === 'pending' ? '—' : currency.format(Number(row.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer style={{ marginTop: '2rem', borderTop: '1px solid #D5DFDD', paddingTop: '1rem', textAlign: 'center', color: '#5B6E74' }}>
          Powered by Glasspot. Every rupee in plain sight.
        </footer>
      </div>
    </main>
  );
}
