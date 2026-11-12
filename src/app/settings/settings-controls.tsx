'use client';

import { useState } from 'react';

import Button from '@/components/button';

import { regenerateMcpToken } from './actions';

export default function SettingsControls({ mcpUrl }: { mcpUrl: string }) {
  const [copyMessage, setCopyMessage] = useState('');

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopyMessage('MCP URL copied.');
    } catch {
      setCopyMessage('Could not access the clipboard. Select and copy the URL above.');
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
      <Button type="button" variant="ghost" onClick={copyUrl}>Copy</Button>
      <form action={regenerateMcpToken}>
        <Button
          type="submit"
          variant="danger"
          confirmMessage="Regenerate this connector URL? The current URL will stop working immediately."
          loadingText="Regenerating..."
        >
          Regenerate token
        </Button>
      </form>
      <span role="status" aria-live="polite" style={{ color: 'var(--muted)' }}>{copyMessage}</span>
    </div>
  );
}
