// ══════════════════════════════════════════════════════════════════════
// Card — Reusable Card Container
// src/components/ui/Card.tsx
//
// PURPOSE:
//   White rounded card with subtle shadow — the primary content container
//   used throughout the app for cluster cards, post previews, and sections.
//
// VARIANTS:
//   - default → White card with border and shadow
//   - 'elevated' → Stronger shadow for prominent content (post previews)
//   - 'flat'     → No shadow, just border (for inner cards / secondary content)
//
// USAGE:
//   <Card>
//     <Card.Header>Title</Card.Header>
//     <Card.Body>Content</Card.Body>
//   </Card>
//
// AFFECT ON THE SYSTEM:
//   - Used by: ClusterCard, PostPreview, HistoryInput section headers
//   - Exported from: src/components/ui/index.ts
// ══════════════════════════════════════════════════════════════════════

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'flat';
  className?: string;
}

/**
 * Card — A padded, rounded container with configurable shadow.
 * All padding is set on the Card itself — child components don't need padding.
 */
export function Card({ children, variant = 'default', className = '' }: CardProps) {
  const variants = {
    default: 'bg-white border border-gray-200 shadow-sm',
    elevated: 'bg-white border border-gray-200 shadow-md',
    flat: 'bg-white border border-gray-200',
  };

  return (
    <div className={`rounded-xl p-6 ${variants[variant]} ${className}`}>
      {children}
    </div>
  );
}
