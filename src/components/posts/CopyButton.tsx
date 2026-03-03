// ══════════════════════════════════════════════════════════════════════
// CopyButton — Copy-to-Clipboard Button
// src/components/posts/CopyButton.tsx
//
// PURPOSE:
//   Button that copies text to clipboard when clicked.
//   Shows a "Copied!" confirmation for 2 seconds after clicking,
//   then reverts to "Copy" state.
//
// USAGE:
//   <CopyButton text={fullPostText} />
//
// HOW IT WORKS:
//   Uses the modern Clipboard API (navigator.clipboard.writeText).
//   Falls back gracefully if clipboard access is denied
//   (shows an error tooltip instead of breaking the page).
//
// AFFECT ON THE SYSTEM:
//   - Used by: PostPreview.tsx
//   - No external dependencies — uses browser Clipboard API
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

interface CopyButtonProps {
  text: string;
  label?: string;
}

/**
 * CopyButton — Copies text to clipboard with visual confirmation.
 */
export function CopyButton({ text, label = 'Copy' }: CopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      // Reset back to 'idle' after 2 seconds
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className={status === 'copied' ? 'text-green-600' : status === 'error' ? 'text-red-600' : ''}
    >
      {status === 'copied' ? '✓ Copied!' : status === 'error' ? 'Failed to copy' : label}
    </Button>
  );
}
