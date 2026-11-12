import type { SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '@/lib/supabase/service';

export type NeedSummary = {
  id: string;
  item: string;
  qty_needed: number;
  received: number;
  pledged: number;
  remaining: number;
};

export type CampaignStats = {
  cashReceived: number;
  approvedSpendTotal: number;
  balance: number;
  pendingCount: number;
  needs: NeedSummary[];
};

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export async function slugify(
  title: string,
  client: SupabaseClient = createServiceClient()
): Promise<string> {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  const safeBase = base || 'campaign';
  let candidate = safeBase;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await client.from('campaigns').select('id').eq('slug', candidate).maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return candidate;
    }

    candidate = `${safeBase}-${randomSuffix()}`;
  }

  return `${safeBase}-${randomSuffix()}`;
}

export async function audit(
  campaignId: string,
  actor: string,
  action: string,
  detail: string,
  client: SupabaseClient = createServiceClient()
) {
  const { error } = await client.from('audit_log').insert({
    campaign_id: campaignId,
    actor,
    action,
    detail,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function campaignStats(
  campaignId: string,
  client: SupabaseClient = createServiceClient()
): Promise<CampaignStats> {
  const { data: needs, error: needsError } = await client
    .from('needs')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  if (needsError) {
    throw new Error(needsError.message);
  }

  const { data: contributions, error: contributionsError } = await client
    .from('contributions')
    .select('*')
    .eq('campaign_id', campaignId);

  if (contributionsError) {
    throw new Error(contributionsError.message);
  }

  const { data: spends, error: spendsError } = await client
    .from('spends')
    .select('*')
    .eq('campaign_id', campaignId);

  if (spendsError) {
    throw new Error(spendsError.message);
  }

  const needSummaries: NeedSummary[] = (needs ?? []).map((need) => {
    const linked = (contributions ?? []).filter((row) => row.need_id === need.id);
    const received = linked
      .filter((row) => row.type !== 'cash' && row.status === 'received')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const pledged = linked
      .filter((row) => row.type !== 'cash' && row.status === 'pledged')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    return {
      id: need.id,
      item: need.item,
      qty_needed: Number(need.qty_needed),
      received,
      pledged,
      remaining: Number(need.qty_needed) - received,
    };
  });

  const cashReceived = (contributions ?? [])
    .filter((row) => row.type === 'cash' && row.status === 'received')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const approvedSpendTotal = (spends ?? [])
    .filter((row) => row.status === 'approved')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const pendingCount = (spends ?? []).filter((row) => row.status === 'pending').length;

  return {
    cashReceived,
    approvedSpendTotal,
    balance: cashReceived - approvedSpendTotal,
    pendingCount,
    needs: needSummaries,
  };
}

export async function createSpend({
  campaignId,
  payee,
  amount,
  purpose = '',
  needId = null,
  actor = 'Claude',
  client = createServiceClient(),
}: {
  campaignId: string;
  payee: string;
  amount: number;
  purpose?: string;
  needId?: string | null;
  actor?: string;
  client?: SupabaseClient;
}): Promise<{ spend: any; autoApproved: boolean; message: string }> {
  const { data: campaign, error: campaignError } = await client
    .from('campaigns')
    .select('approval_limit')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    throw new Error(campaignError?.message ?? 'Campaign not found');
  }

  const approvalLimit = Number(campaign.approval_limit || 0);
  const autoApproved = Number(amount) <= approvalLimit;
  const payload = {
    campaign_id: campaignId,
    payee,
    amount,
    purpose,
    need_id: needId,
    status: autoApproved ? 'approved' : 'pending',
    decided_by: autoApproved ? 'auto (under limit)' : null,
    decided_at: autoApproved ? new Date().toISOString() : null,
    paid_simulated: false,
  };

  const { data: spend, error: insertError } = await client.from('spends').insert(payload).select().single();

  if (insertError || !spend) {
    throw new Error(insertError?.message ?? 'Could not create spend');
  }

  await audit(
    campaignId,
    actor,
    autoApproved ? 'auto_approve_spend' : 'create_spend_pending',
    `${payee} spend ${Number(amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })}${autoApproved ? ' auto-approved' : ' queued for human approval'}${purpose ? ` for ${purpose}` : ''}`,
    client
  );

  return {
    spend,
    autoApproved,
    message: autoApproved
      ? 'Spend approved automatically under the campaign limit.'
      : 'Waiting for a human to approve in Glasspot. Claude cannot approve this.',
  };
}

export async function decideSpend({
  id,
  decision,
  actor,
  client = createServiceClient(),
}: {
  id: string;
  decision: 'approve' | 'reject';
  actor: string;
  client?: SupabaseClient;
}) {
  const { data: spend, error: spendError } = await client
    .from('spends')
    .select('*, campaigns!inner(id, owner_id)')
    .eq('id', id)
    .single();

  if (spendError || !spend) {
    throw new Error(spendError?.message ?? 'Spend not found');
  }

  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';

  const { data, error } = await client
    .from('spends')
    .update({
      status: nextStatus,
      decided_by: actor,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Could not update spend status');
  }

  await audit(
    spend.campaign_id,
    actor,
    `human_${nextStatus}_spend`,
    `${decision === 'approve' ? 'Approved' : 'Rejected'} spend ${spend.payee} for ${Number(spend.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })}`,
    client
  );

  return data;
}
