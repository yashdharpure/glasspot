'use client';

import { useState } from 'react';

import Button from '@/components/button';

export default function CopyPublicLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/c/${encodeURIComponent(slug)}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="campaign-card__copy-button"
      onClick={copyLink}
      aria-label={copied ? 'Public link copied' : 'Copy public link'}
    >
      {copied ? 'Copied' : 'Copy public link'}
    </Button>
  );
}
