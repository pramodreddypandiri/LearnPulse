// ══════════════════════════════════════════════════════════════════════
// PostPreview — Generated Posts Display
// src/components/posts/PostPreview.tsx
//
// PURPOSE:
//   Displays the generated LinkedIn and X posts side by side.
//   Each platform gets its own panel with the post content,
//   hashtags, character count, and a "Copy" button.
//
// LAYOUT:
//   ┌─────────────────────┐  ┌─────────────────────┐
//   │  LinkedIn           │  │  X / Twitter        │
//   │  [post body text]   │  │  [tweet text]       │
//   │  #hashtags          │  │  #hashtag           │
//   │  [Copy Full Post]   │  │  [Copy Tweet]       │
//   └─────────────────────┘  └─────────────────────┘
//
// INTERACT:
//   - "Copy Full Post" copies body + hashtags as one block of text
//   - Character counts show whether the post is within limits
//   - The post body is displayed in a scrollable read-only textarea
//     (users can manually edit before copying)
//
// AFFECT ON THE SYSTEM:
//   - Used by: src/app/page.tsx
//   - Reads: GeneratedPosts from usePipeline().state.posts
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import { CopyButton } from './CopyButton';
import type { GeneratedPosts } from '@/lib/types';

interface PostPreviewProps {
  posts: GeneratedPosts;
}

/**
 * PostPreview — Shows LinkedIn and X posts side by side with copy actions.
 */
export function PostPreview({ posts }: PostPreviewProps) {
  // Allow user to manually edit posts before copying
  const [linkedinBody, setLinkedinBody] = useState(posts.linkedin.body);
  const [xTweets, setXTweets] = useState(posts.x.tweets);

  // Full post text for copying (body + hashtags)
  const linkedinFull = [
    linkedinBody,
    posts.linkedin.hashtags.map((h) => `#${h}`).join(' '),
  ].filter(Boolean).join('\n\n');

  const xFull = [
    xTweets.join('\n\n'),
    posts.x.hashtags.map((h) => `#${h}`).join(' '),
  ].filter(Boolean).join('\n\n');

  return (
    <section>
      {/* Section header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Your Posts</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Generated from {posts.basedOn.length} learning {posts.basedOn.length === 1 ? 'journey' : 'journeys'}.
          Edit the text below before copying.
        </p>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LinkedIn Panel */}
        <Card variant="elevated">
          <LinkedInPanel
            body={linkedinBody}
            onBodyChange={setLinkedinBody}
            hashtags={posts.linkedin.hashtags}
            fullText={linkedinFull}
          />
        </Card>

        {/* X Panel */}
        <Card variant="elevated">
          <XPanel
            tweets={xTweets}
            onTweetsChange={setXTweets}
            hashtags={posts.x.hashtags}
            fullText={xFull}
          />
        </Card>
      </div>
    </section>
  );
}

// ─── LinkedIn Panel ───────────────────────────────────────────────────────────

interface LinkedInPanelProps {
  body: string;
  onBodyChange: (val: string) => void;
  hashtags: string[];
  fullText: string;
}

function LinkedInPanel({ body, onBodyChange, hashtags, fullText }: LinkedInPanelProps) {
  const charCount = body.length;
  const isOverLimit = charCount > 3000; // LinkedIn limit

  return (
    <div>
      {/* Platform header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* LinkedIn "in" logo in blue */}
          <span className="w-6 h-6 rounded bg-[#0A66C2] flex items-center justify-center text-white text-xs font-bold">
            in
          </span>
          <span className="font-semibold text-gray-800">LinkedIn</span>
        </div>
        <span className={`text-xs font-mono ${isOverLimit ? 'text-red-600' : 'text-gray-400'}`}>
          {charCount.toLocaleString()} / 3,000
        </span>
      </div>

      {/* Editable post body */}
      <textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        rows={10}
        className="w-full text-sm text-gray-800 bg-gray-50 rounded-lg p-3 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-y leading-relaxed"
      />

      {/* Hashtags */}
      {hashtags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {hashtags.map((h) => (
            <span key={h} className="text-xs text-indigo-600 font-medium">#{h}</span>
          ))}
        </div>
      )}

      {/* Copy button */}
      <div className="mt-4 flex justify-end">
        <CopyButton text={fullText} label="Copy LinkedIn Post" />
      </div>
    </div>
  );
}

// ─── X Panel ─────────────────────────────────────────────────────────────────

interface XPanelProps {
  tweets: string[];
  onTweetsChange: (tweets: string[]) => void;
  hashtags: string[];
  fullText: string;
}

function XPanel({ tweets, onTweetsChange, hashtags, fullText }: XPanelProps) {
  const updateTweet = (index: number, value: string) => {
    const updated = [...tweets];
    updated[index] = value;
    onTweetsChange(updated);
  };

  return (
    <div>
      {/* Platform header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* X logo */}
          <span className="w-6 h-6 rounded bg-black flex items-center justify-center text-white text-xs font-bold">
            𝕏
          </span>
          <span className="font-semibold text-gray-800">X / Twitter</span>
          {tweets.length > 1 && (
            <span className="text-xs text-gray-500">({tweets.length}-tweet thread)</span>
          )}
        </div>
      </div>

      {/* Tweet textareas */}
      <div className="space-y-3">
        {tweets.map((tweet, index) => {
          const isOverLimit = tweet.length > 280;
          return (
            <div key={index}>
              {tweets.length > 1 && (
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">{index + 1} of {tweets.length}</span>
                  <span className={`text-xs font-mono ${isOverLimit ? 'text-red-600' : 'text-gray-400'}`}>
                    {tweet.length} / 280
                  </span>
                </div>
              )}
              <textarea
                value={tweet}
                onChange={(e) => updateTweet(index, e.target.value)}
                rows={tweets.length > 1 ? 5 : 8}
                className="w-full text-sm text-gray-800 bg-gray-50 rounded-lg p-3 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-y leading-relaxed"
              />
              {tweets.length === 1 && (
                <div className="flex justify-end mt-1">
                  <span className={`text-xs font-mono ${isOverLimit ? 'text-red-600' : 'text-gray-400'}`}>
                    {tweet.length} / 280
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hashtags */}
      {hashtags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {hashtags.map((h) => (
            <span key={h} className="text-xs text-indigo-600 font-medium">#{h}</span>
          ))}
        </div>
      )}

      {/* Copy button */}
      <div className="mt-4 flex justify-end">
        <CopyButton text={fullText} label="Copy X Post" />
      </div>
    </div>
  );
}
