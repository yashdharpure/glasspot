'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { audit, campaignStats, decideSpend } from '@/lib/glasspot';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';

const TAB_NAMES = ['needs', 'contributions', 'spends', 'audit'];

async function ensureOwnerCampaign(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  const service = createServiceClient();
  const { data: campaign, error: campaignError } = await service
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (campaignError || !campaign || campaign.owner_id !== user.id) {
    redirect('/dashboard');
  }

  return { user, campaign, service };
}

async function updateApprovalLimit(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const limit = Number(formData.get('approval_limit') ?? 0);
  const { campaign, service, user } = await ensureOwnerCampaign(id);
  const previous = Number(campaign.approval_limit ?? 0);

  if (Number.isNaN(limit) || limit < 0) {
    redirect(`/campaigns/${id}?tab=spends`);
  }

  const { error } = await service
    .from('campaigns')
    .update({ approval_limit: limit })
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  await audit(
    id,
    user.email ?? 'Organizer',
    'edit_approval_limit',
    `Approval limit changed from ₹${previous.toLocaleString('en-IN')} to ₹${limit.toLocaleString('en-IN')}`,
    service
  );

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=needs`);
}

async function addNeed(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const item = String(formData.get('item') ?? '').trim();
  const qtyNeeded = Number(formData.get('qty_needed') ?? 0);
  const unit = String(formData.get('unit') ?? 'units').trim() || 'units';
  const location = String(formData.get('location') ?? '').trim();
  const priority = String(formData.get('priority') ?? 'medium');

  if (!item || Number.isNaN(qtyNeeded) || qtyNeeded <= 0) {
    redirect(`/campaigns/${id}?tab=needs`);
  }

  const { user, service } = await ensureOwnerCampaign(id);
  const { data, error } = await service
    .from('needs')
    .insert({
      campaign_id: id,
      item,
      qty_needed: qtyNeeded,
      unit,
      location,
      priority,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Could not add need');
  }

  await audit(
    id,
    user.email ?? 'Organizer',
    'create_need',
    `Added need "${item}" (${qtyNeeded} ${unit})`,
    service
  );

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=needs`);
}

async function updateNeed(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const needId = String(formData.get('id') ?? '');
  const { service, user } = await ensureOwnerCampaign(id);
  const { data: previous, error: previousError } = await service
    .from('needs')
    .select('*')
    .eq('id', needId)
    .single();

  if (previousError || !previous) {
    redirect(`/campaigns/${id}?tab=needs`);
  }

  const item = String(formData.get('item') ?? previous.item).trim();
  const qtyNeeded = Number(formData.get('qty_needed') ?? previous.qty_needed);
  const unit = String(formData.get('unit') ?? previous.unit).trim() || previous.unit;
  const location = String(formData.get('location') ?? previous.location).trim();
  const priority = String(formData.get('priority') ?? previous.priority).trim();

  const { error } = await service
    .from('needs')
    .update({
      item,
      qty_needed: qtyNeeded,
      unit,
      location,
      priority,
    })
    .eq('id', needId);

  if (error) {
    throw new Error(error.message);
  }

  await audit(
    id,
    user.email ?? 'Organizer',
    'edit_need',
    `Need changed from "${previous.item}" (${previous.qty_needed} ${previous.unit}, ${previous.location || 'no location'}) to "${item}" (${qtyNeeded} ${unit}, ${location || 'no location'})`,
    service
  );

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=needs`);
}

async function deleteNeed(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const needId = String(formData.get('id') ?? '');
  const { service, user } = await ensureOwnerCampaign(id);
  const { data: need } = await service.from('needs').select('*').eq('id', needId).single();

  if (need) {
    await audit(id, user.email ?? 'Organizer', 'delete_need', `Deleted need "${need.item}"`, service);
  }

  const { error } = await service.from('needs').delete().eq('id', needId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=needs`);
}

async function addContribution(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const donorName = String(formData.get('donor_name') ?? '').trim();
  const type = String(formData.get('type') ?? 'cash');
  const amount = Number(formData.get('amount') ?? 0);
  const status = String(formData.get('status') ?? 'pledged');
  const needId = String(formData.get('need_id') ?? '') || null;

  if (!donorName || Number.isNaN(amount) || amount <= 0) {
    redirect(`/campaigns/${id}?tab=contributions`);
  }

  const { user, service } = await ensureOwnerCampaign(id);

  const { data, error } = await service
    .from('contributions')
    .insert({
      campaign_id: id,
      donor_name: donorName,
      type,
      amount,
      need_id: needId,
      status,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Could not add contribution');
  }

  await audit(
    id,
    user.email ?? 'Organizer',
    'create_contribution',
    `Added ${type} contribution from ${donorName} for ${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
    service
  );

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=contributions`);
}

async function updateContribution(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const contributionId = String(formData.get('id') ?? '');
  const { service, user } = await ensureOwnerCampaign(id);
  const { data: previous } = await service
    .from('contributions')
    .select('*')
    .eq('id', contributionId)
    .single();

  const donorName = String(formData.get('donor_name') ?? previous?.donor_name ?? '').trim();
  const type = String(formData.get('type') ?? previous?.type ?? 'cash');
  const amount = Number(formData.get('amount') ?? previous?.amount ?? 0);
  const status = String(formData.get('status') ?? previous?.status ?? 'pledged');
  const needId = String(formData.get('need_id') ?? '') || null;

  if (!donorName || Number.isNaN(amount) || amount <= 0) {
    redirect(`/campaigns/${id}?tab=contributions`);
  }

  const { error } = await service
    .from('contributions')
    .update({
      donor_name: donorName,
      type,
      amount,
      status,
      need_id: needId,
    })
    .eq('id', contributionId);

  if (error) {
    throw new Error(error.message);
  }

  await audit(
    id,
    user.email ?? 'Organizer',
    'edit_contribution',
    `Contribution updated from ${previous?.donor_name ?? 'unknown'} (${previous?.amount ?? 0}) to ${donorName} (${amount})`,
    service
  );

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=contributions`);
}

async function deleteContribution(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const contributionId = String(formData.get('id') ?? '');
  const { service, user } = await ensureOwnerCampaign(id);
  const { data: contribution } = await service.from('contributions').select('*').eq('id', contributionId).single();

  if (contribution) {
    await audit(id, user.email ?? 'Organizer', 'delete_contribution', `Deleted contribution from ${contribution.donor_name}`, service);
  }

  const { error } = await service.from('contributions').delete().eq('id', contributionId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=contributions`);
}

async function decideHumanSpend(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const spendId = String(formData.get('spend_id') ?? '');
  const decision = String(formData.get('decision') ?? 'reject') as 'approve' | 'reject';
  const { user, service } = await ensureOwnerCampaign(id);

  const spend = await decideSpend({
    id: spendId,
    decision,
    actor: user.email ?? 'Organizer',
    client: service,
  });

  if (spend) {
    revalidatePath(`/campaigns/${id}`);
    redirect(`/campaigns/${id}?tab=spends`);
  }
}

async function markSpendPaid(formData: FormData) {
  'use server';
  const id = String(formData.get('campaign_id') ?? '');
  const spendId = String(formData.get('spend_id') ?? '');
  const { user, service } = await ensureOwnerCampaign(id);
  const { data: previous } = await service.from('spends').select('*').eq('id', spendId).single();

  const { error } = await service
    .from('spends')
    .update({ paid_simulated: true })
    .eq('id', spendId);

  if (error) {
    throw new Error(error.message);
  }

  await audit(
    id,
    user.email ?? 'Organizer',
    'pay_spend_simulated',
    `Marked spend ${previous?.payee ?? 'unknown'} as paid via simulated Volopay`,
    service
  );

  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?tab=spends`);
}

export default async function CampaignEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { campaign, service } = await ensureOwnerCampaign(id);
  const paramsMap = (await searchParams) ?? {};
  const activeTab = String(paramsMap.tab ?? 'needs');

  const [needsResult, contributionsResult, spendsResult, auditResult, stats] = await Promise.all([
    service.from('needs').select('*').eq('campaign_id', id).order('created_at', { ascending: true }),
    service.from('contributions').select('*').eq('campaign_id', id).order('created_at', { ascending: true }),
    service.from('spends').select('*').eq('campaign_id', id).order('created_at', { ascending: true }),
    service.from('audit_log').select('*').eq('campaign_id', id).order('created_at', { ascending: false }).limit(30),
    campaignStats(id, service),
  ]);

  const readError =
    needsResult.error ??
    contributionsResult.error ??
    spendsResult.error ??
    auditResult.error;

  if (readError) {
    throw new Error(`Could not load campaign records: ${readError.message}`);
  }

  const needs = needsResult.data ?? [];
  const contributions = contributionsResult.data ?? [];
  const spends = spendsResult.data ?? [];
  const auditEntries = auditResult.data ?? [];

  const needOptions = needs.map((need) => ({
    value: need.id,
    label: `${need.item} (${need.qty_needed} ${need.unit})`,
  }));

  const csvRows = [
    ['Type', 'Name', 'Amount', 'Status', 'Location', 'Purpose'],
    ...needs.map((need) => ['Need', need.item, String(need.qty_needed), need.priority, need.location, '']),
    ...contributions.map((contribution) => ['Contribution', contribution.donor_name, String(contribution.amount), contribution.status, '', '']),
    ...spends.map((spend) => ['Spend', spend.payee, String(spend.amount), spend.status, '', spend.purpose]),
  ];

  const csvText = csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvText)}`;

  const currency = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });

  return (
    <main style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1rem 3rem', color: '#14272E', background: '#EEF3F2' }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #D5DFDD', borderRadius: 18, padding: '1.5rem', boxShadow: '0 8px 28px rgba(20,39,46,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <p style={{ margin: 0, color: '#5B6E74', fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Campaign editor</p>
            <h1 style={{ margin: '0.35rem 0 0', fontSize: '2rem' }}>{campaign.title}</h1>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <a href={`/c/${campaign.slug}`} target="_blank" rel="noreferrer" style={{ color: '#1F6F8B', fontWeight: 600 }}>Open public page</a>
            <a href="/dashboard" style={{ color: '#1F6F8B', fontWeight: 600 }}>Back to dashboard</a>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ background: '#E3EEF1', border: '1px solid #D5DFDD', borderRadius: 14, padding: '1rem' }}>
            <div style={{ color: '#5B6E74', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cash balance</div>
            <div style={{ marginTop: '0.5rem', fontSize: '1.6rem', fontWeight: 700 }}>{currency.format(stats.balance)}</div>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #D5DFDD', borderRadius: 14, padding: '1rem' }}>
            <div style={{ color: '#5B6E74', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Waiting for approval</div>
            <div style={{ marginTop: '0.5rem', fontSize: '1.6rem', fontWeight: 700 }}>{stats.pendingCount}</div>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #D5DFDD', borderRadius: 14, padding: '1rem' }}>
            <div style={{ color: '#5B6E74', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Approval limit</div>
            <form action={updateApprovalLimit} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <input
                type="number"
                name="approval_limit"
                defaultValue={Number(campaign.approval_limit)}
                min={0}
                step={100}
                style={{ width: '140px', padding: '0.6rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }}
              />
              <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.65rem 0.9rem', fontWeight: 600 }}>Save</button>
            </form>
          </div>
        </div>

        <div style={{ borderBottom: '1px solid #D5DFDD', marginBottom: '1.25rem' }}>
          <nav style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {TAB_NAMES.map((tab) => {
              const selected = tab === activeTab;
              return (
                <a
                  key={tab}
                  href={`/campaigns/${id}?tab=${tab}`}
                  style={{
                    padding: '0.85rem 1rem',
                    borderRadius: 10,
                    border: selected ? '1px solid #1F6F8B' : '1px solid transparent',
                    background: selected ? '#E3EEF1' : 'transparent',
                    color: selected ? '#14272E' : '#5B6E74',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}
                >
                  {tab}
                </a>
              );
            })}
          </nav>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <a
            href={csvHref}
            download="glasspot-accounting-export.csv"
            style={{
              display: 'inline-block',
              padding: '0.8rem 1rem',
              background: '#F2A900',
              color: '#14272E',
              borderRadius: 10,
              textDecoration: 'none',
              fontWeight: 700,
            }}
          >
            Accounting export (simulated)
          </a>
        </div>

        {activeTab === 'needs' && (
          <section>
            <form action={addNeed} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem', padding: '1rem', border: '1px solid #D5DFDD', borderRadius: 12, background: '#FFFFFF' }}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Item</span>
                <input name="item" required style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Qty needed</span>
                <input name="qty_needed" type="number" min={0} step={1} required style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Unit</span>
                <input name="unit" defaultValue="units" style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Location</span>
                <input name="location" style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Priority</span>
                <select name="priority" defaultValue="medium" style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.75rem 1rem', fontWeight: 700 }}>Add need</button>
              </div>
            </form>

            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #D5DFDD', background: '#FFFFFF' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead style={{ background: '#E3EEF1' }}>
                  <tr>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Item</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Qty needed</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Unit</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Location</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Priority</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Progress</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {needs.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '1rem', color: '#5B6E74' }}>No needs yet. Add the first need using the form above.</td>
                    </tr>
                  ) : needs.map((need) => {
                    const needStats = stats.needs.find((row) => row.id === need.id) ?? { received: 0, pledged: 0, qty_needed: Number(need.qty_needed) };
                    const totalReceived = Number(needStats.received ?? 0) + Number(needStats.pledged ?? 0);
                    const progressPct = Math.min(100, (totalReceived / Math.max(1, Number(need.qty_needed))) * 100);
                    return (
                      <tr key={need.id}>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <form action={updateNeed} style={{ display: 'grid', gap: '0.5rem' }}>
                            <input type="hidden" name="campaign_id" value={campaign.id} />
                            <input type="hidden" name="id" value={need.id} />
                            <input name="item" defaultValue={need.item} style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
                            <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Save</button>
                          </form>
                        </td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <input name="qty_needed" form={`need-${need.id}`} defaultValue={need.qty_needed} type="number" min={0} step={1} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
                        </td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <input name="unit" form={`need-${need.id}`} defaultValue={need.unit} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
                        </td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <input name="location" form={`need-${need.id}`} defaultValue={need.location} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
                        </td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <select name="priority" form={`need-${need.id}`} defaultValue={need.priority} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <div style={{ minWidth: 180 }}>
                            <div style={{ height: 10, borderRadius: 99, background: '#E3EEF1', overflow: 'hidden' }}>
                              <div style={{ width: `${progressPct}%`, height: '100%', background: '#2E8B57' }} />
                            </div>
                            <div style={{ fontSize: 12, color: '#5B6E74', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                              <span>Received {Number(needStats.received)}</span>
                              <span>Pledged {Number(needStats.pledged)}</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <form id={`need-${need.id}`} action={updateNeed} style={{ display: 'grid', gap: '0.5rem' }}>
                            <input type="hidden" name="campaign_id" value={campaign.id} />
                            <input type="hidden" name="id" value={need.id} />
                            <input type="hidden" name="item" defaultValue={need.item} />
                            <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Save</button>
                          </form>
                          <form action={deleteNeed} style={{ marginTop: '0.5rem' }}>
                            <input type="hidden" name="campaign_id" value={campaign.id} />
                            <input type="hidden" name="id" value={need.id} />
                            <button type="submit" style={{ background: '#C4432F', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Delete</button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'contributions' && (
          <section>
            <form action={addContribution} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem', padding: '1rem', border: '1px solid #D5DFDD', borderRadius: 12, background: '#FFFFFF' }}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Donor</span>
                <input name="donor_name" required style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Type</span>
                <select name="type" defaultValue="cash" style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                  <option value="cash">Cash</option>
                  <option value="goods">Goods</option>
                  <option value="hours">Hours</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Amount / qty</span>
                <input name="amount" type="number" min={1} step={1} required style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Status</span>
                <select name="status" defaultValue="pledged" style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                  <option value="pledged">Pledged</option>
                  <option value="received">Received</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Linked need</span>
                <select name="need_id" defaultValue="" style={{ padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                  <option value="">Unlinked</option>
                  {needOptions.map((need) => (
                    <option key={need.value} value={need.value}>{need.label}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.75rem 1rem', fontWeight: 700 }}>Add contribution</button>
              </div>
            </form>

            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #D5DFDD', background: '#FFFFFF' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead style={{ background: '#E3EEF1' }}>
                  <tr>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Donor</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Type</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Amount</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Status</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Need</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contributions.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '1rem', color: '#5B6E74' }}>No contributions yet. New entries will appear here.</td>
                    </tr>
                  ) : contributions.map((contribution) => (
                    <tr key={contribution.id}>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                        <form action={updateContribution} style={{ display: 'grid', gap: '0.5rem' }}>
                          <input type="hidden" name="campaign_id" value={campaign.id} />
                          <input type="hidden" name="id" value={contribution.id} />
                          <input name="donor_name" defaultValue={contribution.donor_name} style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
                          <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Save</button>
                        </form>
                      </td>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                        <select name="type" form={`contribution-${contribution.id}`} defaultValue={contribution.type} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                          <option value="cash">Cash</option>
                          <option value="goods">Goods</option>
                          <option value="hours">Hours</option>
                        </select>
                      </td>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                        <input name="amount" form={`contribution-${contribution.id}`} defaultValue={contribution.amount} type="number" min={1} step={1} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }} />
                      </td>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                        <select name="status" form={`contribution-${contribution.id}`} defaultValue={contribution.status} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                          <option value="pledged">Pledged</option>
                          <option value="received">Received</option>
                        </select>
                      </td>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                        <select name="need_id" form={`contribution-${contribution.id}`} defaultValue={contribution.need_id ?? ''} style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #D5DFDD' }}>
                          <option value="">Unlinked</option>
                          {needOptions.map((need) => (
                            <option key={need.value} value={need.value}>{need.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                        <form id={`contribution-${contribution.id}`} action={updateContribution} style={{ display: 'grid', gap: '0.5rem' }}>
                          <input type="hidden" name="campaign_id" value={campaign.id} />
                          <input type="hidden" name="id" value={contribution.id} />
                          <input type="hidden" name="donor_name" defaultValue={contribution.donor_name} />
                          <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Save</button>
                        </form>
                        <form action={deleteContribution} style={{ marginTop: '0.5rem' }}>
                          <input type="hidden" name="campaign_id" value={campaign.id} />
                          <input type="hidden" name="id" value={contribution.id} />
                          <button type="submit" style={{ background: '#C4432F', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Delete</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'spends' && (
          <section>
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #D5DFDD', background: '#FFFFFF' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead style={{ background: '#E3EEF1' }}>
                  <tr>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Payee</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Amount</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Purpose</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Status</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {spends.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '1rem', color: '#5B6E74' }}>No spend requests yet.</td>
                    </tr>
                  ) : spends.map((spend) => {
                    const statusColor = spend.status === 'approved' ? '#2E8B57' : spend.status === 'rejected' ? '#C4432F' : '#F2A900';
                    return (
                      <tr key={spend.id}>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{spend.payee}</td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{currency.format(Number(spend.amount))}</td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{spend.purpose || '—'}</td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          <span style={{ display: 'inline-block', padding: '0.3rem 0.6rem', borderRadius: 999, background: `${statusColor}22`, color: statusColor, fontWeight: 700 }}>{spend.status}</span>
                        </td>
                        <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>
                          {spend.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <form action={decideHumanSpend}>
                                <input type="hidden" name="campaign_id" value={campaign.id} />
                                <input type="hidden" name="spend_id" value={spend.id} />
                                <input type="hidden" name="decision" value="approve" />
                                <button type="submit" style={{ background: '#2E8B57', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Approve</button>
                              </form>
                              <form action={decideHumanSpend}>
                                <input type="hidden" name="campaign_id" value={campaign.id} />
                                <input type="hidden" name="spend_id" value={spend.id} />
                                <input type="hidden" name="decision" value="reject" />
                                <button type="submit" style={{ background: '#C4432F', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>Reject</button>
                              </form>
                            </div>
                          ) : spend.status === 'approved' && !spend.paid_simulated ? (
                            <form action={markSpendPaid}>
                              <input type="hidden" name="campaign_id" value={campaign.id} />
                              <input type="hidden" name="spend_id" value={spend.id} />
                              <button type="submit" style={{ background: '#1F6F8B', color: '#FFF', border: 'none', borderRadius: 8, padding: '0.5rem 0.7rem' }}>
                                Pay via Volopay <span style={{ fontWeight: 700, marginLeft: 6 }}>Simulated</span>
                              </button>
                            </form>
                          ) : (
                            <span style={{ color: '#2E8B57', fontWeight: 700 }}>Paid via Volopay (Simulated)</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'audit' && (
          <section>
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #D5DFDD', background: '#FFFFFF' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead style={{ background: '#E3EEF1' }}>
                  <tr>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Time</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>Who</th>
                    <th style={{ padding: '0.8rem 0.9rem', textAlign: 'left', borderBottom: '1px solid #D5DFDD' }}>What changed</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: '1rem', color: '#5B6E74' }}>No audit entries yet. Changes will be recorded here.</td>
                    </tr>
                  ) : auditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{new Date(entry.created_at).toLocaleString('en-IN')}</td>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{entry.actor}</td>
                      <td style={{ padding: '0.8rem 0.9rem', borderBottom: '1px solid #D5DFDD' }}>{entry.detail || entry.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
