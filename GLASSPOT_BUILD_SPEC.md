# Glasspot: build spec for the coding agent

Tagline: **Every rupee in plain sight.**

Read this whole file before writing any code. Work in the order given in section 12. Stop and ask me only where section 14 says to.

## 1. What we are building

Glasspot is a web app that gives any group effort (relief drive, festival committee, school fundraiser, NGO campaign) a live, public, auditable page showing what was needed, what came in, and where it went.

The organizer connects **their own Claude** to Glasspot through an **MCP server**. Claude reads messy messages and calls Glasspot's tools. Glasspot stores, edits, enforces approvals, and keeps the public page live.

This is a 24-hour assignment for Volopay (Founder's Office, Product & Growth). The judges will:
1. Connect the MCP link to Claude and type a request.
2. Open the web app and see what Claude created.
3. Edit it.
4. Open the public page.

## 2. Hard rules (never break these)

1. **No AI inside the app.** No OpenAI, Anthropic, Google AI or any other AI SDK, API key, or HTTP call to an AI service anywhere in the code or env vars. The app only stores, edits and serves. Do not add an "AI summary" feature. Do not install any AI SDK as a dependency. (The MCP SDK is not an AI SDK; it is a protocol library, and it is allowed.)
2. **Claude can never approve a spend.** No MCP tool may set a spend to `approved` unless it is at or below the campaign's approval limit (auto-approval). Above the limit, only a logged-in human using the web app can approve or reject.
3. **No real money moves.** Glasspot records pledges, receipts and spends only. The "Pay via Volopay" button is a labelled mock.
4. **Privacy.** Store only names, quantities, amounts and general locations. No ID numbers, no addresses of vulnerable people, no phone numbers in v1. The public page must never show emails or internal notes.
5. **Secrets.** Never hardcode keys. Never print them. Never commit `.env*`. Never ask me to paste secrets into chat. Read them from `process.env`.
6. **Keep it small.** One thing that works well beats many things half-working. Do not add features that are not in this file.

## 3. Stack

- Next.js (App Router, TypeScript, `src/` directory). The project already exists in this folder (`create-next-app` was run; dependencies are installed; it is on GitHub and deployed on Vercel).
- Supabase: Postgres and email/password auth.
- `@supabase/supabase-js` and `@supabase/ssr` for auth in Next.js.
- MCP server as a Next.js route handler, using the official `@modelcontextprotocol/sdk` (TypeScript), or Vercel's `mcp-handler` package if it is simpler. **Check the current documentation for whichever you use. Do not rely on memory for the API.** Use the Streamable HTTP transport in **stateless** mode (new server instance per request), because Vercel is serverless.
- `zod` for input validation.
- Styling: plain CSS or Tailwind (whichever the scaffold already has). No component library needed.
- Hosting: Vercel. Windows development machine (PowerShell or the VS Code terminal).

## 4. Environment variables

These three exist in `.env.local` and in Vercel. Do not add others unless truly needed, and never add an AI key.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never import it into client components or expose it with a `NEXT_PUBLIC_` prefix.

## 5. Data model

Create `supabase/schema.sql` with the following (adjust syntax if needed), and tell me to run it in the Supabase SQL editor. Do not try to run it yourself.

```sql
create extension if not exists pgcrypto;

-- One profile per signed-up organizer. mcp_token is what goes in the MCP URL.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Organizer',
  mcp_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  slug text not null unique,
  approval_limit numeric(12,2) not null default 10000 check (approval_limit >= 0),
  is_public boolean not null default true,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);

create table needs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  item text not null,
  unit text not null default 'units',
  qty_needed numeric(12,2) not null check (qty_needed > 0),
  location text not null default '',
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  created_at timestamptz not null default now()
);

create table contributions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  donor_name text not null,
  type text not null check (type in ('cash','goods','hours')),
  amount numeric(12,2) not null check (amount > 0), -- rupees for cash, quantity for goods/hours
  need_id uuid references needs(id) on delete set null,
  status text not null default 'pledged' check (status in ('pledged','received')),
  created_at timestamptz not null default now()
);

create table spends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  payee text not null,
  amount numeric(12,2) not null check (amount > 0),
  purpose text not null default '',
  need_id uuid references needs(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text,            -- 'auto (under limit)' or the human's name/email
  decided_at timestamptz,
  paid_simulated boolean not null default false,
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  actor text not null,        -- 'Claude' or the human's display name
  action text not null,       -- e.g. 'create_need', 'edit_qty_needed', 'approve_spend'
  detail text not null default '',  -- old and new values in plain words
  created_at timestamptz not null default now()
);

create index on campaigns(owner_id);
create index on needs(campaign_id);
create index on contributions(campaign_id);
create index on spends(campaign_id);
create index on audit_log(campaign_id, created_at desc);

-- Auto-create a profile when someone signs up.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Organizer'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Row level security: organizers only touch their own data from the browser.
alter table profiles enable row level security;
alter table campaigns enable row level security;
alter table needs enable row level security;
alter table contributions enable row level security;
alter table spends enable row level security;
alter table audit_log enable row level security;

create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own campaigns" on campaigns for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "own needs" on needs for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
create policy "own contributions" on contributions for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
create policy "own spends" on spends for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
create policy "own audit" on audit_log for select
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
-- audit_log is written only by server code (service role), so no insert policy for browsers.
```

Notes:
- The **public page** and the **MCP server** both run on the server with the service-role client. They must apply their own scoping: the public page filters by `slug` and `is_public = true` and returns only safe fields; the MCP server resolves the token to one profile and scopes **every** query by `owner_id`.
- If any statement is wrong for the current Supabase version, fix it and tell me what you changed.

## 6. Pages and screens

Match the look of the approved prototype (design tokens in section 11).

| Route | Access | Purpose |
|---|---|---|
| `/login` | public | Email and password sign in and sign up on one page. No email confirmation step. |
| `/dashboard` | login | List my campaigns with balance and pending-approval count. "New campaign" form. "Load demo data" button. |
| `/campaigns/[id]` | login, owner only | The editor (below). |
| `/c/[slug]` | public, read-only | The public page (below). |
| `/settings` | login | Shows my MCP URL with a Copy button, a "Regenerate token" button, and the 5-step connection instructions. |

### Campaign editor (`/campaigns/[id]`)
- Header stats: **Cash balance** (received cash minus approved spends), **Waiting for approval** (count), **Approval limit** (editable number).
- Tabs: **Needs**, **Contributions**, **Spends**, **Audit log**.
- **Needs tab:** table with editable item, qty needed, unit, location, priority; a progress bar (green = received, gold = pledged); "Add need" and delete.
- **Contributions tab:** editable donor, amount or qty, status (pledged/received); "which need" dropdown; add and delete.
- **Spends tab:** payee, amount, purpose, status tag. Pending rows have **Approve** and **Reject**. Approved, unpaid rows have **Pay via Volopay** with a visible "Simulated" label; clicking sets `paid_simulated = true`.
- **Audit log tab:** time, who, what changed.
- Every edit made in the web app writes an `audit_log` row with the human's display name and old and new values.
- Export: a **Download CSV** button (needs, contributions, spends) labelled "Accounting export (simulated)".
- Use optimistic or simple refresh updates; do not over-engineer.

### Public page (`/c/[slug]`)
- Title and description, "Live and public".
- Stats: cash received, spent so far.
- **What is needed:** each need with received and pledged progress.
- **Who gave:** donor name, amount or quantity, status tag (no emails).
- **Where it went:** payee, purpose, amount; pending spends shown as "awaiting approval"; rejected shown as rejected.
- Footer: "Powered by Glasspot. Every rupee in plain sight."
- Return a friendly 404 if the slug does not exist or the campaign is not public.
- Server-render it, with `revalidate` of 0 or a few seconds, so it is always fresh.

## 7. MCP server

**Endpoint:** `/api/mcp/[token]` (Streamable HTTP, stateless). Support POST (and GET/DELETE as the library requires). The token in the URL maps to `profiles.mcp_token`. An unknown token returns 401 with a clear message. Never log the token.

Server name: `glasspot`. Give every tool a clear description so Claude knows when to use it. Validate all inputs with zod. On bad input, return a helpful error message (not a stack trace) that Claude can read and fix.

All tools accept `campaign` as either the campaign **slug** or its **id**, and must verify the campaign belongs to the token's owner.

| Tool | Input | Behaviour |
|---|---|---|
| `list_campaigns` | none | Returns the owner's campaigns: title, slug, status, approval limit, public URL. |
| `create_campaign` | `title`, `description?`, `approval_limit?` (default 10000) | Creates the campaign with a unique slug derived from the title. Returns slug and public URL. Audit: `create_campaign` by Claude. |
| `add_needs` | `campaign`, `needs[]` of `{item, qty_needed, unit?, location?, priority?}` | Inserts several needs at once. If a need with the same item name (case-insensitive) already exists, do not duplicate; return it under `skipped` with a message. Audit each. |
| `log_contributions` | `campaign`, `contributions[]` of `{donor_name, type, amount, need_item?, status?}` | `type` is cash, goods or hours. Match `need_item` to an existing need by case-insensitive name; if no match, store unlinked and add a warning. Default status is `pledged`. Duplicate guard: same donor, type, amount and campaign within the last 10 minutes returns a warning and is skipped unless `allow_duplicate: true`. Audit each. |
| `request_spend` | `campaign`, `payee`, `amount`, `purpose?`, `need_item?` | Creates a spend. If `amount <= approval_limit`, status is `approved` with `decided_by = 'auto (under limit)'`. Otherwise status is `pending` and the response says clearly: "Waiting for a human to approve in Glasspot. Claude cannot approve this." Audit it. |
| `get_campaign_status` | `campaign` | Reads **fresh data including human edits**: each need with qty needed, received, pledged and remaining; cash received, approved spend and balance; pending spends; the last 10 audit entries. This is the read-back that proves the two-way loop. |

There is deliberately **no** `approve_spend`, `delete_*` or `edit_*` tool in v1.

Every write made through MCP writes an `audit_log` row with `actor = 'Claude'`.

Test the server with `npx @modelcontextprotocol/inspector` against `http://localhost:3000/api/mcp/<token>` before testing with Claude.

## 8. Business logic to centralise (in `src/lib/`)

- `slugify(title)` with a random 4-character suffix on collision.
- `campaignStats(campaignId)`: per-need received and pledged (sum of linked goods or hours contributions by status), cash received, approved spend total, balance, pending count.
- `createSpend(...)`: the one place that decides auto-approve versus pending. Used by MCP.
- `decideSpend(id, decision, actor)`: the only path to approve or reject above the limit. Used only by the authenticated web app (server action or route), which must verify the logged-in user owns the campaign.
- `audit(campaignId, actor, action, detail)`.

## 9. Demo data

A **"Load demo data"** button on the dashboard creates one campaign, "Ward 4 Flood Relief", with approval limit 10000, plus:
- Needs: Food packets 200 packets (Ward 4, high), Drinking water 500 litres (Ward 2, high).
- Contributions: Meera S. cash 12000 received; Imran K. goods 80 packets received (linked to Food packets).
- Spend: Local water supplier 3500 "Water cans, Ward 2", approved (auto).

All sample data must be fictional.

## 10. Reviewer experience

- Create a test account (I will do it manually) and show its email and password on the `/login` page in a small box labelled "Reviewer test account", **only if** the env var `NEXT_PUBLIC_SHOW_TEST_LOGIN=true` is set. If that is too fiddly, skip it and I will put the credentials in the submission form.
- `/settings` shows the MCP URL and these exact connection steps:
  1. Copy your MCP URL.
  2. In Claude, open Settings, then Connectors.
  3. Click Add custom connector.
  4. Paste the URL and save.
  5. In a new chat, type: "Create a relief campaign called Ward 4 Flood Relief, then add these needs and donations: ..."
- Anyone who opens the root `/` sees a short landing page: tagline, a 3-step explanation, "Log in", and a link to the demo public page if one exists.

## 11. Look and feel

Match the approved prototype: ledger style, teal ink, gold accent, tabular numbers.

```
Light:  bg #EEF3F2  card #FFFFFF  ink #14272E  muted #5B6E74  line #D5DFDD
        blue #1F6F8B  gold #F2A900  green #2E8B57  red #C4432F  soft #E3EEF1
Dark:   bg #0F1C21  card #16282F  ink #E7F0EE  muted #93A8AE  line #2A4048
        blue #5BB5D2  gold #F2B73A  green #5CBF8A  red #E8806E  soft #1D3640
Font:   Schibsted Grotesk (Google Fonts) with system-ui fallback; font-variant-numeric: tabular-nums
```

- Support light and dark via `prefers-color-scheme`.
- Indian number format for rupees (`en-IN`, for example ₹1,00,000).
- Responsive: tables scroll horizontally inside their own container on mobile.
- Accessible: visible focus rings, labelled inputs, buttons not colour-only.
- Show a small banner in the web app and README: "Payments and accounting export are simulated."

## 12. Build order

Do these in order. After each step, tell me what you built, what to test, and wait for me only where step notes say so.

1. **Cleanup and structure.** Remove the default starter page. Add folders: `src/lib`, `src/app/api/mcp/[token]`, `supabase`. Install: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, and the MCP library. Confirm no AI package is installed.
2. **Schema.** Write `supabase/schema.sql`. **Pause:** I will run it in Supabase.
3. **Supabase clients and auth.** Browser and server clients, login and sign-up page, route protection for `/dashboard`, `/campaigns/*`, `/settings`.
4. **Dashboard.** Campaign list, new campaign form, Load demo data.
5. **Lib logic.** Section 8 functions with basic tests if quick.
6. **Campaign editor.** Section 6.
7. **Public page.** Section 6.
8. **MCP endpoint and tools.** Section 7. **Pause:** I will test with the MCP inspector and then with my own Claude.
9. **Settings page.** MCP URL, Copy, Regenerate token, instructions.
10. **Docs.** `README.md` (section 13) and an architecture diagram as Mermaid in the README.
11. **Polish and deploy check.** Loading and empty states, error messages, `npm run build` passes locally. Then I will push and test on Vercel.

## 13. README requirements (the judges read this)

Write a concise `README.md` covering:

1. **What it is** and the one-line pitch.
2. **Architecture diagram** (Mermaid): Claude (user's own plan) → MCP endpoint → Supabase Postgres ← Web app (organizer) → Public page (donors); plus a simulated "Volopay payment adapter" box.
3. **Data flow** in numbered steps (message in Claude → tool call → record → human edit → read-back → public page).
4. **Responsibilities table** with three columns: *Glasspot prototype (built)*, *Volopay or partner in production (assumption)*, *Notes*. Rows: reading messy messages (customer's Claude); needs, ledger, approvals, audit (built); card issuing, vendor payments, reimbursements (Volopay, **simulated**); spend policies and approval workflows (basic limit built, richer engine at Volopay); accounting integrations (CSV built, Volopay integrations in production); KYC, compliance, foreign-donation and tax rules (out of scope). **State plainly that all Volopay-side items are assumptions based on public information.**
5. **What I built vs. the proposed production system** (two short lists).
6. **MCP tools** table: name, inputs, what it does, what it deliberately cannot do.
7. **No AI inside:** state that there are no AI keys, SDKs or calls; list the three env vars.
8. **Auth model and trade-offs:** token in URL (simple, regenerable, anyone with the URL can act as that organizer) versus OAuth (next step).
9. **Assumptions and limitations:** no money moves; fixed schema; single owner per campaign; Claude plan with custom connectors required; cold starts on serverless; no rate limiting beyond basics.
10. **Edge cases handled:** invalid input, duplicate needs, duplicate contributions, unmatched need names, spends above the limit, token not found, campaign not owned by token.
11. **Next steps:** OAuth, configurable fields per campaign, donor pledge form, real payments via a partner, multi-user roles, notifications, templates, verified campaign badge.
12. **How to run locally** and how to connect to Claude.

## 14. When to stop and ask me

- Before running or changing anything in Supabase or Vercel (I do that manually).
- If a library API differs from what this spec assumes and the fix changes behaviour.
- If you are about to add anything that looks like AI.
- If a command needs a secret I have not provided.

Otherwise, make sensible decisions, keep changes small, and keep me informed.

## 15. Definition of done (manual test script)

1. Sign up, then Load demo data. The dashboard shows "Ward 4 Flood Relief".
2. `/settings` shows my MCP URL. Connect it to Claude as a custom connector.
3. In Claude: "Add needs: 100 kg rice and 12 blankets in Ward 4. Raju gave 5000 rupees cash. Anita pledged 50 kg rice. Pay Sharma Caterers 14000 rupees for cooking the packets." Claude calls the tools. Needs and contributions appear in the editor. The 14,000 spend is **pending**.
4. In the web app: edit the rice quantity, approve the spend, click Pay via Volopay (simulated).
5. In Claude: "What is still unfilled?" The answer reflects my edit.
6. `/c/<slug>` shows all of it publicly with no emails.
7. Asking Claude to approve the pending spend fails because no such tool exists.
8. `grep -ri "openai\|anthropic\|api.anthropic" src package.json` finds nothing.
9. `npm run build` succeeds, and the Vercel deployment works with a second Claude account.
