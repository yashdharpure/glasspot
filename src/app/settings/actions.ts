'use server';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';

import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';

export async function regenerateMcpToken() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .update({ mcp_token: randomBytes(24).toString('hex') })
    .eq('id', user.id)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Could not regenerate connector token: ${error?.message ?? 'Profile not found.'}`);
  }

  redirect('/settings?token=regenerated');
}
