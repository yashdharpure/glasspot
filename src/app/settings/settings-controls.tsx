'use client';

import { useState } from 'react';

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
      <button type="button" onClick={copyUrl}>Copy</button>
      <form
        action={regenerateMcpToken}
        onSubmit={(event) => {
          if (!window.confirm('Regenerate this connector URL? The current URL will stop working immediately.')) {
            event.preventDefault();
          }
        }}
      >
        <button type="submit">Regenerate token</button>
      </form>
      <span role="status" aria-live="polite" style={{ color: 'var(--muted)' }}>{copyMessage}</span>
    </div>
  );
}
