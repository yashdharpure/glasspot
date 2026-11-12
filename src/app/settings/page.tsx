import { redirect } from 'next/navigation';

import Button from '@/components/button';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';

import SettingsControls from './settings-controls';

export const dynamic = 'force-dynamic';

function getPublicOrigin() {
  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }

  const host =
    process.env.VERCEL_ENV === 'preview'
      ? process.env.VERCEL_URL
      : process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

  if (!host) {
    throw new Error('The public site origin is unavailable. Check the Vercel deployment URL settings.');
  }

  return new URL(host.startsWith('http') ? host : `https://${host}`).origin;
}

async function signOut() {
  'use server';

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  const service = createServiceClient();
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('mcp_token')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Could not load connector settings: ${profileError.message}`);
  }

  if (!profile?.mcp_token) {
    throw new Error('No MCP token is available for this account.');
  }

  const { token } = await searchParams;
  const mcpUrl = new URL(`/api/mcp/${encodeURIComponent(profile.mcp_token)}`, getPublicOrigin()).toString();

  return (
    <main style={{ maxWidth: 960, margin: '3rem auto', padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Settings</h1>
          <p style={{ margin: 0, color: 'var(--muted)' }}>Signed in as {user.email}</p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" loadingText="Signing out...">Sign out</Button>
        </form>
      </header>

      <section style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid var(--line)', borderRadius: 16, background: 'var(--card)' }}>
        <h2 style={{ marginTop: 0 }}>Your MCP connector</h2>
        <p style={{ color: 'var(--muted)' }}>
          Use this URL to connect your own Claude account. Anyone with this URL can act as you, so keep it private.
        </p>
        {token === 'regenerated' ? (
          <p role="status" style={{ color: 'var(--green)' }}>A new connector URL is ready. The previous URL no longer works.</p>
        ) : null}
        <label htmlFor="mcp-url" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>MCP URL</label>
        <input
          id="mcp-url"
          readOnly
          value={mcpUrl}
          style={{ width: '100%', padding: '0.8rem', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', color: 'var(--ink)' }}
        />
        <SettingsControls mcpUrl={mcpUrl} />
      </section>

      <section style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid var(--line)', borderRadius: 16, background: 'var(--card)' }}>
        <h2 style={{ marginTop: 0 }}>Connect to Claude</h2>
        <ol style={{ display: 'grid', gap: '0.8rem', paddingLeft: '1.5rem', lineHeight: 1.6 }}>
          <li>Copy your MCP URL.</li>
          <li>In Claude, open Settings, then Connectors.</li>
          <li>Click Add custom connector.</li>
          <li>Paste the URL and save.</li>
          <li>In a new chat, type: “Create a relief campaign called Ward 4 Flood Relief, then add these needs and donations: ...”</li>
        </ol>
      </section>

      <p style={{ marginTop: '1.5rem', color: 'var(--muted)' }}>
        Payments and accounting export are simulated.
      </p>
    </main>
  );
}
