// ══════════════════════════════════════════════════════════════════════
// Popup Script
// chrome-extension/src/popup/popup.ts
//
// PURPOSE:
//   The JavaScript logic for the extension popup (popup.html).
//   Runs whenever the user opens the popup by clicking the extension icon.
//
// WHAT THIS FILE DOES:
//   1. RENDER: Reads today's captured entries from chrome.storage.local
//      and renders them in the popup UI (count stats + entry list)
//
//   2. "OPEN LEARNPULSE" BUTTON (primary CTA):
//      a. Formats all today's entries as freeform text (one per line)
//      b. Opens or focuses the LearnPulse tab (http://localhost:3000)
//      c. After the tab loads, injects a script that dispatches a
//         CustomEvent with the formatted data
//      d. The web app's page.tsx listens for this event, parses the
//         entries, and shows them in a left panel for the user to
//         review, delete, and then manually trigger analysis.
//
//      KEY CHANGE from the old "Analyze Now" design:
//        Previously the popup auto-started the AI pipeline on open.
//        Now the popup just delivers the data — the user decides when
//        to analyze inside the web app. This gives the user control
//        over which entries to include before spending API credits.
//
//   3. "CLEAR TODAY" BUTTON: Clears all entries from storage
//
// HOW DATA GETS INTO THE WEB APP:
//   The key step is `chrome.scripting.executeScript()` — this is Chrome's
//   way of injecting JavaScript into another tab from an extension.
//   It's only possible because we declared "scripting" permission in manifest.json
//   and listed "http://localhost:3000/*" in host_permissions.
//
//   The injected function:
//   1. Creates a CustomEvent with the formatted history text
//   2. Dispatches it on window
//   3. The web app's useEffect catches this event
//   4. The web app parses the text into HistoryEntry[] and shows the
//      left-panel entry list for review and deletion
//   5. User clicks "Analyze" inside the web app when ready
//
// WHY NOT USE MESSAGES (chrome.runtime.sendMessage)?
//   Message passing requires a content script already loaded in the target tab.
//   executeScript() works even if no content script is loaded — it's simpler
//   and more reliable for one-time data injection.
// ══════════════════════════════════════════════════════════════════════

import { readStorage, CapturedEntry, STORAGE_KEY, getTodayString } from '../types';

// ─── LearnPulse Web App URL ──────────────────────────────────────────────────
// This URL is used to open/focus the LearnPulse tab.
// Change this if the app is deployed to a remote URL.
const LEARNPULSE_URL = 'http://localhost:3000';

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Main initialization — runs when the popup HTML is fully loaded.
 * Reads storage and renders the UI.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Set the header date to today's date
  const headerDate = document.getElementById('header-date');
  if (headerDate) {
    headerDate.textContent = formatDate(new Date());
  }

  // Load and render captured entries
  await renderEntries();

  // Attach button event listeners
  attachEventListeners();
});

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Reads today's entries from storage and renders the full popup UI.
 * Called once on DOMContentLoaded.
 */
async function renderEntries(): Promise<void> {
  const storage = await readStorage();
  const entries = storage.entries;

  // Sort entries by most recent first
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);

  const searchCount = entries.filter((e) => e.type === 'search').length;
  const urlCount = entries.filter((e) => e.type === 'visit').length;

  if (entries.length === 0) {
    // Show empty state
    show('empty-state');
    hide('stats-bar');
    hide('entries-section');
    hide('actions');
    return;
  }

  // Show data sections
  hide('empty-state');
  show('stats-bar');
  show('entries-section');
  show('actions');

  // Update stats
  setText('stat-searches', String(searchCount));
  setText('stat-urls', String(urlCount));
  setText('stat-total', String(entries.length));

  // Render entry list (most recent 10 entries)
  const listEl = document.getElementById('entries-list');
  if (!listEl) return;

  listEl.innerHTML = '';
  const preview = sorted.slice(0, 10);

  for (const entry of preview) {
    listEl.appendChild(createEntryElement(entry));
  }

  // Show "and X more" if more than 10 entries
  if (entries.length > 10) {
    const moreEl = document.createElement('div');
    moreEl.style.cssText = 'padding: 6px 4px; color: #9ca3af; font-size: 11px; text-align: center;';
    moreEl.textContent = `+${entries.length - 10} more entries`;
    listEl.appendChild(moreEl);
  }
}

/**
 * Creates a single entry list item element.
 *
 * Each item shows:
 * - An icon (🔍 for search, 🔗 for URL visit)
 * - A source badge (Google/Perplexity/History)
 * - The content (query text or URL, truncated)
 * - The time (relative: "2m ago", "1h ago")
 */
function createEntryElement(entry: CapturedEntry): HTMLElement {
  const item = document.createElement('div');
  item.className = 'entry-item';

  const icon = entry.type === 'search' ? '🔍' : '🔗';
  const sourceClass = `source-${entry.source}`;
  const sourceLabel = entry.source === 'perplexity' ? 'Perplx' : entry.source;
  const displayContent = entry.type === 'visit' && entry.title
    ? entry.title
    : entry.content;
  const timeAgo = formatRelativeTime(entry.timestamp);

  item.innerHTML = `
    <span class="entry-icon">${icon}</span>
    <span class="entry-source">
      <span class="source-badge ${sourceClass}">${sourceLabel}</span>
    </span>
    <span class="entry-content" title="${escapeHtml(entry.content)}">${escapeHtml(truncate(displayContent, 50))}</span>
    <span class="entry-time">${timeAgo}</span>
  `;

  return item;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function attachEventListeners(): void {
  // "Open LearnPulse" — primary CTA
  // Opens the web app, injects captured entries for review, then closes popup.
  // The user decides when to actually run analysis inside the web app.
  document.getElementById('btn-open-app')?.addEventListener('click', handleOpenLearnPulse);

  // "Clear today" — reset all captured entries
  document.getElementById('btn-clear')?.addEventListener('click', handleClear);
}

// ─── Open LearnPulse Flow ─────────────────────────────────────────────────────

/**
 * The core action: opens the LearnPulse web app and injects today's entries.
 *
 * FLOW:
 * 1. Disable the button to prevent double-clicks
 * 2. Read today's entries from storage
 * 3. If no entries: just open the tab (nothing to inject)
 * 4. Format entries as freeform text
 * 5. Open or focus the LearnPulse tab
 * 6. Wait for the tab to fully load
 * 7. Inject the data via chrome.scripting.executeScript()
 * 8. The injected script dispatches a CustomEvent the web app listens for
 * 9. The web app shows entries in its left panel for the user to review
 * 10. Close the popup (user continues in the web app)
 *
 * DESIGN INTENT:
 * The popup's only job is to deliver the data.
 * The web app's left panel lets the user delete unwanted entries
 * and then manually click "Analyze" when they're satisfied with the list.
 * This prevents accidentally analyzing noise entries or old browsing.
 */
async function handleOpenLearnPulse(): Promise<void> {
  const openBtn = document.getElementById('btn-open-app') as HTMLButtonElement;
  const openLabel = document.getElementById('btn-open-app-label');

  // Disable button to prevent double-clicks
  if (openBtn) openBtn.disabled = true;
  if (openLabel) openLabel.textContent = 'Opening...';
  showStatus('Opening LearnPulse...', 'default');

  const storage = await readStorage();

  // If no entries, just open the tab (nothing to inject)
  if (storage.entries.length === 0) {
    await openOrFocusLearnPulseTab();
    window.close();
    return;
  }

  // Format entries as freeform text — one entry per line.
  // Searches come first (primary signal), then URLs.
  // The web app's freeform parser will re-parse this back into HistoryEntry[].
  const formattedText = formatEntriesAsText(storage.entries);

  try {
    // Open or find the LearnPulse tab
    const tab = await openOrFocusLearnPulseTab();

    if (!tab.id) {
      throw new Error('Could not open LearnPulse tab');
    }

    // Wait for the tab to finish loading before injecting.
    // The tab may already be loaded (if it was focused, not created fresh).
    showStatus('Waiting for LearnPulse to load...', 'default');
    await waitForTabLoad(tab.id);

    showStatus('Sending your captures...', 'default');

    // Inject the data into the LearnPulse page.
    // The injected function runs in the web app's context and dispatches
    // a CustomEvent that page.tsx listens for.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectHistoryIntoWebApp,
      args: [formattedText],
    });

    // Close the popup — user continues in the web app's entry review panel
    setTimeout(() => window.close(), 800);

  } catch (error) {
    console.error('[LearnPulse Popup] Failed to inject data:', error);
    showStatus(
      'Failed to open LearnPulse. Make sure it\'s running at localhost:3000',
      'error'
    );
    if (openBtn) openBtn.disabled = false;
    if (openLabel) openLabel.textContent = 'Open LearnPulse';
  }
}

/**
 * Formats CapturedEntry[] as freeform text for the LearnPulse web app.
 *
 * Format: one entry per line
 * - Search entries: just the query text
 * - URL entries: the URL
 *
 * Searches come first (highest learning signal), then URLs.
 * Sorted chronologically within each group (oldest first = natural reading order).
 *
 * WHY THIS FORMAT?
 * The web app's freeform parser (src/lib/parsers/freeform-parser.ts) handles
 * this exact format: lines starting with "http" become 'visit' entries,
 * everything else becomes 'search' entries. This creates a clean round-trip:
 *   CapturedEntry[] → formatted text → HistoryEntry[] (in the web app)
 */
function formatEntriesAsText(entries: CapturedEntry[]): string {
  const searches = entries
    .filter((e) => e.type === 'search')
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => e.content);

  const urls = entries
    .filter((e) => e.type === 'visit')
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => e.content);

  const lines = [...searches, ...urls];
  return lines.join('\n');
}

// ─── Tab Management ───────────────────────────────────────────────────────────

/**
 * Opens the LearnPulse web app in a tab, or focuses it if already open.
 * Returns the tab object (either found or created).
 */
async function openOrFocusLearnPulseTab(): Promise<chrome.tabs.Tab> {
  // Search all open tabs for the LearnPulse URL
  const existingTabs = await chrome.tabs.query({ url: `${LEARNPULSE_URL}/*` });

  if (existingTabs.length > 0 && existingTabs[0].id) {
    // Tab already open — focus it
    await chrome.tabs.update(existingTabs[0].id, { active: true });
    if (existingTabs[0].windowId) {
      await chrome.windows.update(existingTabs[0].windowId, { focused: true });
    }
    return existingTabs[0];
  }

  // No existing tab — create a new one
  const tab = await chrome.tabs.create({ url: LEARNPULSE_URL });
  return tab;
}

/**
 * Waits for a tab to finish loading (status === 'complete').
 *
 * If the tab is already loaded, resolves immediately.
 * If not, waits for the chrome.tabs.onUpdated event.
 *
 * Includes a 10-second timeout to avoid hanging if the page never loads.
 */
async function waitForTabLoad(tabId: number): Promise<void> {
  // Check current tab status first
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  // Wait for tab to load
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 10_000);

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Delay to ensure Next.js has fully hydrated and useEffect listeners
        // have registered. 500ms was too short for cold starts (fresh tab).
        // 1500ms covers even slow machines / first-load JS parsing.
        setTimeout(resolve, 1500);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ─── Data Injection ───────────────────────────────────────────────────────────

/**
 * This function is INJECTED INTO THE LEARNPULSE TAB via chrome.scripting.executeScript().
 *
 * IMPORTANT: This function runs in the context of the LearnPulse web page,
 * NOT in the extension's context. This means:
 * - It can access window, document, and page globals
 * - It CANNOT access extension APIs (no chrome.storage, no chrome.tabs)
 * - It receives data via the `text` argument passed by executeScript()
 *
 * HOW IT COMMUNICATES WITH REACT:
 * The function dispatches a CustomEvent on window.
 * The web app's page.tsx has a useEffect that listens for 'learnpulse:inject'
 * and responds by:
 *   1. Parsing the text into HistoryEntry[] using the freeform parser
 *   2. Showing those entries in a left panel for review/deletion
 *   3. Waiting for the user to manually click "Analyze" in the web app
 *
 * @param text - The formatted history text (one entry per line)
 */
function injectHistoryIntoWebApp(text: string): void {
  // ── Store-then-dispatch pattern ───────────────────────────────────────────
  //
  // PROBLEM: CustomEvent dispatch is instant, but React's useEffect (which
  // registers the listener) only runs AFTER the component mounts and
  // Next.js has fully hydrated. On a fresh page load this takes 1-3 seconds.
  // If we only dispatch the event, there's a window where no listener exists
  // yet and the event fires into the void.
  //
  // FIX: Store the data in window.__learnpulseInjectData BEFORE dispatching.
  // React's useEffect reads this variable on mount and processes any data
  // that arrived before the listener was registered.
  // The variable is deleted after the data is consumed (no memory leak).
  //
  // This creates two paths to success:
  //   Path A (listener ready): useEffect already registered → event fires → listener handles it
  //   Path B (listener not ready yet): event fires → missed → useEffect mounts → checks variable → handles it
  (window as unknown as Record<string, unknown>)['__learnpulseInjectData'] = { text };

  // Also dispatch the event for Path A (already-loaded pages)
  window.dispatchEvent(
    new CustomEvent('learnpulse:inject', {
      detail: { text },
    })
  );

  console.log('[LearnPulse Extension] Injected history data into web app');
}

// ─── Clear Handler ────────────────────────────────────────────────────────────

/**
 * Clears all of today's entries from storage.
 * Asks for confirmation first (accidental clears are annoying).
 */
async function handleClear(): Promise<void> {
  const confirmed = confirm(
    "Clear all of today's captured history?\nThis can't be undone."
  );
  if (!confirmed) return;

  await chrome.storage.local.set({
    [STORAGE_KEY]: { date: getTodayString(), entries: [] },
  });

  // Re-render the popup to show empty state
  await renderEntries();
  showStatus('Today\'s history cleared.', 'default');
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function show(id: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}

function hide(id: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showStatus(message: string, type: 'default' | 'success' | 'error'): void {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.textContent = message;
  el.className = `status-message visible ${type === 'default' ? '' : type}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a Unix timestamp as relative time ("2m ago", "1h ago", "3d ago").
 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
