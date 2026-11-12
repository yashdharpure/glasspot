import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

import { audit, createSpend, slugify } from '@/lib/glasspot';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ token: string }>;
};

type Campaign = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  slug: string;
  approval_limit: number;
  status: string;
  is_public: boolean;
};

const campaignInput = z.string().trim().min(1).max(200).describe('Campaign slug or id');
const priorityInput = z.enum(['low', 'medium', 'high']).optional();

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : 'The request could not be completed.';
  return toolResult({ error: message }, true);
}

async function findOwnedCampaign(
  service: ReturnType<typeof createServiceClient>,
  ownerId: string,
  reference: string
): Promise<Campaign> {
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
  const { data, error } = await service
    .from('campaigns')
    .select('id, owner_id, title, description, slug, approval_limit, status, is_public')
    .eq('owner_id', ownerId)
    .eq(isId ? 'id' : 'slug', reference)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not look up campaign: ${error.message}`);
  }

  if (!data) {
    throw new Error('Campaign not found for this connector. Check the campaign slug or id.');
  }

  return data as Campaign;
}

function createServer(ownerId: string, origin: string) {
  const server = new McpServer({ name: 'glasspot', version: '1.0.0' });
  const service = createServiceClient();

  server.registerTool(
    'list_campaigns',
    {
      description: 'List campaigns owned by this Glasspot connector, including their public URLs.',
      inputSchema: {},
    },
    async () => {
      try {
        const { data, error } = await service
          .from('campaigns')
          .select('title, slug, status, approval_limit, is_public')
          .eq('owner_id', ownerId)
          .order('created_at', { ascending: false });

        if (error) {
          throw new Error(`Could not list campaigns: ${error.message}`);
        }

        return toolResult(
          (data ?? []).map((campaign) => ({
            ...campaign,
            public_url: campaign.is_public ? new URL(`/c/${campaign.slug}`, origin).toString() : null,
          }))
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'create_campaign',
    {
      description: 'Create a campaign for this organizer. The public URL is returned when the campaign is public.',
      inputSchema: {
        title: z.string().trim().min(1).max(200).describe('Campaign title'),
        description: z.string().trim().max(5000).optional().describe('Campaign description'),
        approval_limit: z.number().finite().nonnegative().default(10000).describe('Maximum spend auto-approval amount in rupees'),
      },
    },
    async ({ title, description, approval_limit }) => {
      try {
        const slug = await slugify(title, service);
        const { data: campaign, error } = await service
          .from('campaigns')
          .insert({
            owner_id: ownerId,
            title,
            description: description ?? '',
            slug,
            approval_limit,
          })
          .select('id, slug, title, is_public')
          .single();

        if (error || !campaign) {
          throw new Error(`Could not create campaign: ${error?.message ?? 'No campaign was returned.'}`);
        }

        await audit(campaign.id, 'Claude', 'create_campaign', `Created campaign "${title}"`, service);

        return toolResult({
          title: campaign.title,
          slug: campaign.slug,
          public_url: campaign.is_public ? new URL(`/c/${campaign.slug}`, origin).toString() : null,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'add_needs',
    {
      description: 'Add multiple needs to an owned campaign. Existing item names are skipped case-insensitively.',
      inputSchema: {
        campaign: campaignInput,
        needs: z.array(
          z.object({
            item: z.string().trim().min(1).max(200),
            qty_needed: z.number().finite().positive(),
            unit: z.string().trim().min(1).max(80).optional(),
            location: z.string().trim().max(200).optional(),
            priority: priorityInput,
          })
        ).min(1).max(100),
      },
    },
    async ({ campaign: reference, needs }) => {
      try {
        const campaign = await findOwnedCampaign(service, ownerId, reference);
        const { data: existingNeeds, error: existingError } = await service
          .from('needs')
          .select('item')
          .eq('campaign_id', campaign.id);

        if (existingError) {
          throw new Error(`Could not check existing needs: ${existingError.message}`);
        }

        const knownItems = new Set((existingNeeds ?? []).map((need) => need.item.toLocaleLowerCase()));
        const added: string[] = [];
        const skipped: Array<{ item: string; message: string }> = [];

        for (const need of needs) {
          const normalizedItem = need.item.toLocaleLowerCase();
          if (knownItems.has(normalizedItem)) {
            skipped.push({ item: need.item, message: 'A need with this item name already exists.' });
            continue;
          }

          const { data: inserted, error } = await service
            .from('needs')
            .insert({
              campaign_id: campaign.id,
              item: need.item,
              qty_needed: need.qty_needed,
              unit: need.unit ?? 'units',
              location: need.location ?? '',
              priority: need.priority ?? 'medium',
            })
            .select('id')
            .single();

          if (error || !inserted) {
            throw new Error(`Could not add need "${need.item}": ${error?.message ?? 'No row was returned.'}`);
          }

          await audit(
            campaign.id,
            'Claude',
            'create_need',
            `Added need "${need.item}" (${need.qty_needed} ${need.unit ?? 'units'})`,
            service
          );
          knownItems.add(normalizedItem);
          added.push(need.item);
        }

        return toolResult({ added, skipped });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'log_contributions',
    {
      description: 'Record contributions for an owned campaign, matching need names when possible and warning on duplicates or unmatched needs.',
      inputSchema: {
        campaign: campaignInput,
        contributions: z.array(
          z.object({
            donor_name: z.string().trim().min(1).max(200),
            type: z.enum(['cash', 'goods', 'hours']),
            amount: z.number().finite().positive(),
            need_item: z.string().trim().min(1).max(200).optional(),
            status: z.enum(['pledged', 'received']).default('pledged'),
          })
        ).min(1).max(100),
        allow_duplicate: z.boolean().default(false).describe('Set true to record entries matching contributions from the last 10 minutes'),
      },
    },
    async ({ campaign: reference, contributions, allow_duplicate }) => {
      try {
        const campaign = await findOwnedCampaign(service, ownerId, reference);
        const { data: campaignNeeds, error: needsError } = await service
          .from('needs')
          .select('id, item')
          .eq('campaign_id', campaign.id);

        if (needsError) {
          throw new Error(`Could not load campaign needs: ${needsError.message}`);
        }

        const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const added: Array<{ donor_name: string; amount: number; type: string }> = [];
        const skipped: Array<{ donor_name: string; amount: number; type: string; message: string }> = [];
        const warnings: string[] = [];

        for (const contribution of contributions) {
          const need = contribution.need_item
            ? (campaignNeeds ?? []).find(
                (row) => row.item.toLocaleLowerCase() === contribution.need_item?.toLocaleLowerCase()
              )
            : undefined;

          if (contribution.need_item && !need) {
            warnings.push(`No need named "${contribution.need_item}" was found; contribution was recorded without a linked need.`);
          }

          if (!allow_duplicate) {
            const { data: duplicate, error: duplicateError } = await service
              .from('contributions')
              .select('id')
              .eq('campaign_id', campaign.id)
              .eq('donor_name', contribution.donor_name)
              .eq('type', contribution.type)
              .eq('amount', contribution.amount)
              .gte('created_at', cutoff)
              .limit(1)
              .maybeSingle();

            if (duplicateError) {
              throw new Error(`Could not check for duplicate contributions: ${duplicateError.message}`);
            }

            if (duplicate) {
              skipped.push({
                donor_name: contribution.donor_name,
                amount: contribution.amount,
                type: contribution.type,
                message: 'A matching contribution was recorded in the last 10 minutes. Set allow_duplicate to true to record it anyway.',
              });
              continue;
            }
          }

          const { data: inserted, error } = await service
            .from('contributions')
            .insert({
              campaign_id: campaign.id,
              donor_name: contribution.donor_name,
              type: contribution.type,
              amount: contribution.amount,
              need_id: need?.id ?? null,
              status: contribution.status,
            })
            .select('id')
            .single();

          if (error || !inserted) {
            throw new Error(`Could not log contribution from "${contribution.donor_name}": ${error?.message ?? 'No row was returned.'}`);
          }

          await audit(
            campaign.id,
            'Claude',
            'log_contribution',
            `Logged ${contribution.type} contribution of ${contribution.amount} from ${contribution.donor_name}${need ? ` for ${need.item}` : ''} (${contribution.status})`,
            service
          );
          added.push({
            donor_name: contribution.donor_name,
            amount: contribution.amount,
            type: contribution.type,
          });
        }

        return toolResult({ added, skipped, warnings });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'request_spend',
    {
      description: 'Record a spend request. Amounts at or below the campaign limit are auto-approved; above-limit requests must be approved by a human in Glasspot.',
      inputSchema: {
        campaign: campaignInput,
        payee: z.string().trim().min(1).max(200),
        amount: z.number().finite().positive(),
        purpose: z.string().trim().max(2000).optional(),
        need_item: z.string().trim().min(1).max(200).optional(),
      },
    },
    async ({ campaign: reference, payee, amount, purpose, need_item }) => {
      try {
        const campaign = await findOwnedCampaign(service, ownerId, reference);
        let needId: string | null = null;
        const warnings: string[] = [];

        if (need_item) {
          const { data: needs, error } = await service
            .from('needs')
            .select('id, item')
            .eq('campaign_id', campaign.id);

          if (error) {
            throw new Error(`Could not find the requested need: ${error.message}`);
          }

          const need = (needs ?? []).find((row) => row.item.toLocaleLowerCase() === need_item.toLocaleLowerCase());
          if (need) {
            needId = need.id;
          } else {
            warnings.push(`No need named "${need_item}" was found; the spend was recorded without a linked need.`);
          }
        }

        const result = await createSpend({
          campaignId: campaign.id,
          payee,
          amount,
          purpose: purpose ?? '',
          needId,
          actor: 'Claude',
          client: service,
        });

        return toolResult({
          spend: result.spend,
          auto_approved: result.autoApproved,
          message: result.message,
          warnings,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'get_campaign_status',
    {
      description: 'Read fresh needs, contributions, spending, pending spends, balance, and recent audit history for an owned campaign.',
      inputSchema: { campaign: campaignInput },
    },
    async ({ campaign: reference }) => {
      try {
        const campaign = await findOwnedCampaign(service, ownerId, reference);
        const [
          { data: needs, error: needsError },
          { data: contributions, error: contributionsError },
          { data: spends, error: spendsError },
          { data: auditEntries, error: auditError },
        ] = await Promise.all([
          service.from('needs').select('id, item, unit, qty_needed').eq('campaign_id', campaign.id).order('created_at'),
          service.from('contributions').select('need_id, type, amount, status').eq('campaign_id', campaign.id),
          service.from('spends').select('id, payee, amount, purpose, status, created_at').eq('campaign_id', campaign.id),
          service.from('audit_log').select('actor, action, detail, created_at').eq('campaign_id', campaign.id).order('created_at', { ascending: false }).limit(10),
        ]);

        if (needsError || contributionsError || spendsError || auditError) {
          const message = needsError?.message ?? contributionsError?.message ?? spendsError?.message ?? auditError?.message;
          throw new Error(`Could not load campaign status: ${message}`);
        }

        const allContributions = contributions ?? [];
        const allSpends = spends ?? [];
        const needStatus = (needs ?? []).map((need) => {
          const linked = allContributions.filter((contribution) => contribution.need_id === need.id && contribution.type !== 'cash');
          const received = linked
            .filter((contribution) => contribution.status === 'received')
            .reduce((total, contribution) => total + Number(contribution.amount), 0);
          const pledged = linked
            .filter((contribution) => contribution.status === 'pledged')
            .reduce((total, contribution) => total + Number(contribution.amount), 0);

          return {
            item: need.item,
            unit: need.unit,
            qty_needed: Number(need.qty_needed),
            received,
            pledged,
            remaining: Number(need.qty_needed) - received,
          };
        });
        const cashReceived = allContributions
          .filter((contribution) => contribution.type === 'cash' && contribution.status === 'received')
          .reduce((total, contribution) => total + Number(contribution.amount), 0);
        const approvedSpend = allSpends
          .filter((spend) => spend.status === 'approved')
          .reduce((total, spend) => total + Number(spend.amount), 0);

        return toolResult({
          campaign: {
            title: campaign.title,
            slug: campaign.slug,
            status: campaign.status,
          },
          needs: needStatus,
          cash_received: cashReceived,
          approved_spend: approvedSpend,
          balance: cashReceived - approvedSpend,
          pending_spends: allSpends.filter((spend) => spend.status === 'pending'),
          recent_audit: auditEntries ?? [],
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

async function handleMcpRequest(request: Request, { params }: RouteContext) {
  const { token } = await params;
  const service = createServiceClient();
  const { data: profile, error } = await service
    .from('profiles')
    .select('id')
    .eq('mcp_token', token)
    .maybeSingle();

  if (error) {
    return Response.json({ error: 'Could not verify connector token.' }, { status: 500 });
  }

  if (!profile) {
    return Response.json({ error: 'Unknown MCP token. Check the connector URL or regenerate your token in Glasspot settings.' }, { status: 401 });
  }

  const server = createServer(profile.id, new URL(request.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function POST(request: Request, context: RouteContext) {
  return handleMcpRequest(request, context);
}

export async function GET(request: Request, context: RouteContext) {
  return handleMcpRequest(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleMcpRequest(request, context);
}
