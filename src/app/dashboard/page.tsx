import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import Button, { ButtonLink } from '@/components/button';
import CopyPublicLinkButton from '@/components/copy-public-link-button';
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
  redirect('/dashboard?notice=created');
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
    redirect('/dashboard?notice=demo-exists');
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
  redirect('/dashboard?notice=demo-loaded');
}

async function signOut() {
  'use server';

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await getAuthedUser();
  const { notice } = await searchParams;
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
  const notices: Record<string, string> = {
    created: 'Campaign created.',
    'demo-loaded': 'Demo campaign loaded.',
    'demo-exists': 'The demo campaign is already on your dashboard.',
  };
  const totalCashBalance = campaignRows.reduce((total, campaign) => total + campaign.stats.balance, 0);
  const totalPendingApprovals = campaignRows.reduce((total, campaign) => total + campaign.stats.pendingCount, 0);

  return (
    <main style={{ maxWidth: 1100, margin: '3rem auto', padding: '2rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Dashboard</h1>
          <p style={{ margin: 0 }}>Signed in as {user.email}</p>
        </div>

        <form action={signOut}>
          <Button type="submit" variant="ghost" loadingText="Signing out...">Sign out</Button>
        </form>
      </div>

      {notice && notices[notice] ? (
        <p role="status" aria-live="polite" style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--soft)', color: 'var(--ink)' }}>
          {notices[notice]}
        </p>
      ) : null}

      <section className="dashboard-stats" aria-label="Campaign overview">
        <article className="dashboard-stat">
          <div className="dashboard-stat__label">Total campaigns</div>
          <div className="dashboard-stat__value">{campaignRows.length}</div>
        </article>
        <article className="dashboard-stat">
          <div className="dashboard-stat__label">Total cash balance</div>
          <div className="dashboard-stat__value">{currency.format(totalCashBalance)}</div>
        </article>
        <article className="dashboard-stat">
          <div className="dashboard-stat__label">Total pending approvals</div>
          <div className="dashboard-stat__value">{totalPendingApprovals}</div>
        </article>
      </section>

      <section className="dashboard-create">
        <form id="new-campaign-form" action={createCampaign} className="dashboard-create__form">
          <h2 style={{ margin: 0 }}>New campaign</h2>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Title</span>
            <input name="title" required placeholder="Relief drive" style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Description</span>
            <textarea name="description" rows={3} placeholder="Campaign description" style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </label>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span>Approval limit</span>
            <input name="approval_limit" type="number" min="0" step="100" defaultValue={10000} style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }} />
          </label>
          <Button type="submit" loadingText="Saving...">Create campaign</Button>
        </form>

        {campaignRows.length > 0 ? (
          <form action={loadDemoData} className="dashboard-create__demo">
            <p style={{ marginTop: 0, color: 'var(--muted)' }}>Want to explore with fictional entries?</p>
            <Button type="submit" variant="ghost" loadingText="Loading demo...">Load demo data</Button>
          </form>
        ) : null}
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: '1rem' }}>My campaigns</h2>
        </div>

        {campaignRows.length === 0 ? (
          <div className="dashboard-empty">
            <h3 style={{ marginTop: 0 }}>Your first campaign starts here</h3>
            <p style={{ color: 'var(--muted)' }}>Create a campaign or load the fictional demo ledger to see how Glasspot works.</p>
            <div className="dashboard-empty__actions">
              <ButtonLink href="#new-campaign-form">New campaign</ButtonLink>
              <form action={loadDemoData}>
                <Button type="submit" variant="ghost" loadingText="Loading demo...">Load demo data</Button>
              </form>
            </div>
          </div>
        ) : (
          <div className="dashboard-campaign-list">
            {campaignRows.map((campaign) => (
              <article key={campaign.id} className="campaign-card">
                <div className="campaign-card__header">
                  <div>
                    <h3 style={{ margin: 0 }}>{campaign.title}</h3>
                    <p style={{ margin: '0.3rem 0 0', color: 'var(--muted)' }}>{campaign.description || 'No description'}</p>
                  </div>
                  <span className={`campaign-card__status campaign-card__status--${campaign.status}`}>{campaign.status}</span>
                </div>

                <div className="campaign-card__metrics">
                  <div className="campaign-card__metric">
                    <div className="campaign-card__caption">Cash balance</div>
                    <div className="campaign-card__value">{currency.format(campaign.stats.balance)}</div>
                  </div>
                  <div
                    className="campaign-card__metric campaign-card__metric--pending"
                    data-pending={campaign.stats.pendingCount > 0}
                  >
                    <div className="campaign-card__caption">Waiting for approval</div>
                    <div className="campaign-card__value">{campaign.stats.pendingCount}</div>
                  </div>
                  <div className="campaign-card__metric">
                    <div className="campaign-card__caption">Approval limit</div>
                    <div className="campaign-card__value">{currency.format(Number(campaign.approval_limit))}</div>
                  </div>
                </div>

                <div className="campaign-card__actions">
                  <div className="campaign-action">
                    <ButtonLink href={`/campaigns/${campaign.id}`}>Open organizer view</ButtonLink>
                    <span className="campaign-action__label">Private: edit and approve</span>
                  </div>
                  <div className="campaign-action">
                    <div className="campaign-action__buttons">
                      <ButtonLink
                        href={`/c/${campaign.slug}`}
                        variant="ghost"
                        target="_blank"
                        rel="noreferrer"
                      >
                        View public page
                        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none">
                          <path d="M9 2h5v5M14 2 7 9M12 9v4H3V4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </ButtonLink>
                      <CopyPublicLinkButton slug={campaign.slug} />
                    </div>
                    <span className="campaign-action__label">Public: what donors see</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
