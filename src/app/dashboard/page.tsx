import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { campaignStats, createSpend, slugify, audit } from '@/lib/glasspot';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  return user;
}

async function createCampaign(formData: FormData) {
  'use server';

  const user = await getAuthedUser();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const approvalLimit = Number(formData.get('approval_limit') ?? 10000);

  if (!title) {
    redirect('/dashboard');
  }

  const service = createServiceClient();
  const slug = await slugify(title, service);

  const { data: campaign, error } = await service
    .from('campaigns')
    .insert({
      owner_id: user.id,
      title,
      description,
      slug,
      approval_limit: approvalLimit,
      is_public: true,
      status: 'active',
    })
    .select()
    .single();

  if (error || !campaign) {
    throw new Error(error?.message ?? 'Could not create campaign');
  }

  await audit(campaign.id, user.email ?? 'Organizer', 'create_campaign', `Created campaign "${title}"`);

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

async function loadDemoData() {
  'use server';

  const user = await getAuthedUser();
  const service = createServiceClient();

  const { data: existingCampaign, error: existingCampaignError } = await service
    .from('campaigns')
    .select('id')
    .eq('owner_id', user.id)
    .ilike('title', 'Ward 4 Flood Relief')
    .maybeSingle();

  if (existingCampaignError) {
    throw new Error(`Could not check for existing demo data: ${existingCampaignError.message}`);
  }

  if (existingCampaign) {
    revalidatePath('/dashboard');
    redirect('/dashboard');
  }

  const title = 'Ward 4 Flood Relief';
  const slug = await slugify(title, service);

  const { data: campaign, error: campaignError } = await service
    .from('campaigns')
    .insert({
      owner_id: user.id,
      title,
      description: 'Emergency relief and clean water support for Ward 4 residents.',
      slug,
      approval_limit: 10000,
      is_public: true,
      status: 'active',
    })
    .select()
    .single();

  if (campaignError || !campaign) {
    throw new Error(campaignError?.message ?? 'Could not create demo campaign');
  }

  await audit(campaign.id, user.email ?? 'Organizer', 'load_demo_data', 'Loaded fictional demo data for the review script');

  const { data: foodNeed, error: foodNeedError } = await service
    .from('needs')
    .insert({
      campaign_id: campaign.id,
      item: 'Food packets',
      qty_needed: 200,
      unit: 'packets',
      location: 'Ward 4',
      priority: 'high',
    })
    .select()
    .single();

  if (foodNeedError || !foodNeed) {
    throw new Error(foodNeedError?.message ?? 'Could not create demo food need');
  }

  const { data: waterNeed, error: waterNeedError } = await service
    .from('needs')
    .insert({
      campaign_id: campaign.id,
      item: 'Drinking water',
      qty_needed: 500,
      unit: 'litres',
      location: 'Ward 2',
      priority: 'high',
    })
    .select()
    .single();

  if (waterNeedError || !waterNeed) {
    throw new Error(waterNeedError?.message ?? 'Could not create demo water need');
  }

  const { error: cashError } = await service.from('contributions').insert({
    campaign_id: campaign.id,
    donor_name: 'Meera S.',
    type: 'cash',
    amount: 12000,
    status: 'received',
  });

  if (cashError) {
    throw new Error(cashError.message);
  }

  const { error: goodsError } = await service.from('contributions').insert({
    campaign_id: campaign.id,
    donor_name: 'Imran K.',
    type: 'goods',
    amount: 80,
    need_id: foodNeed.id,
    status: 'received',
  });

  if (goodsError) {
    throw new Error(goodsError.message);
  }

  await createSpend({
    campaignId: campaign.id,
    payee: 'Local water supplier',
    amount: 3500,
    purpose: 'Water cans, Ward 2',
    needId: waterNeed.id,
    actor: user.email ?? 'Organizer',
    client: service,
  });

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

async function signOut() {
  'use server';

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export default async function DashboardPage() {
  const user = await getAuthedUser();
  const service = createServiceClient();

  const { data: campaigns, error: campaignsError } = await service
    .from('campaigns')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (campaignsError) {
    throw new Error(`Could not load your campaigns: ${campaignsError.message}`);
  }

  const campaignRows = await Promise.all(
    (campaigns ?? []).map(async (campaign) => ({
      ...campaign,
      stats: await campaignStats(campaign.id, service),
    }))
  );

  const currency = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });

  return (
    <main style={{ maxWidth: 1100, margin: '3rem auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Dashboard</h1>
          <p style={{ margin: 0 }}>Signed in as {user.email}</p>
        </div>

        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>

      <section style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <form action={createCampaign} style={{ display: 'grid', gap: '0.75rem', padding: '1rem', border: '1px solid #d5dfdd', borderRadius: 12, minWidth: 320 }}>
          <h2 style={{ margin: 0 }}>New campaign</h2>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Title</span>
            <input name="title" required placeholder="Relief drive" style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid #d5dfdd' }} />
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Description</span>
            <textarea name="description" rows={3} placeholder="Campaign description" style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid #d5dfdd' }} />
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Approval limit</span>
            <input name="approval_limit" type="number" min="0" step="100" defaultValue={10000} style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid #d5dfdd' }} />
          </label>
          <button type="submit">Create campaign</button>
        </form>

        <form action={loadDemoData} style={{ display: 'flex', alignItems: 'end', padding: '1rem', border: '1px solid #d5dfdd', borderRadius: 12, minHeight: 170 }}>
          <button type="submit">Load demo data</button>
        </form>
      </section>

      <section>
        <h2 style={{ marginBottom: '1rem' }}>My campaigns</h2>

        {campaignRows.length === 0 ? (
          <div style={{ padding: '1.25rem', border: '1px dashed #9AACA9', borderRadius: 12, background: '#FFFFFF' }}>
            <h3 style={{ marginTop: 0 }}>Your ledger is ready to start</h3>
            <p style={{ color: '#5B6E74' }}>Create a campaign above, or load fictional demo data to explore Glasspot.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {campaignRows.map((campaign) => (
              <article key={campaign.id} style={{ border: '1px solid #d5dfdd', borderRadius: 12, padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{campaign.title}</h3>
                    <p style={{ margin: '0.25rem 0 0' }}>{campaign.description || 'No description'}</p>
                  </div>
                  <div style={{ display: 'grid', gap: '0.25rem', textAlign: 'right' }}>
                    <strong>{campaign.status}</strong>
                    <a href={`/c/${campaign.slug}`} target="_blank" rel="noreferrer">Public page</a>
                    <a href={`/campaigns/${campaign.id}`}>Open editor</a>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <div><strong>Cash balance:</strong> {currency.format(campaign.stats.balance)}</div>
                  <div><strong>Pending approval:</strong> {campaign.stats.pendingCount}</div>
                  <div><strong>Approval limit:</strong> {currency.format(Number(campaign.approval_limit))}</div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
