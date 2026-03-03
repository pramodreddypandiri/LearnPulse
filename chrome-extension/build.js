// ══════════════════════════════════════════════════════════════════════
// Chrome Extension Build Script
// chrome-extension/build.js
//
// PURPOSE:
//   Bundles all TypeScript source files into plain JavaScript that
//   Chrome can load as an extension. Chrome cannot run TypeScript
//   directly — it needs compiled, bundled JS files.
//
// WHY ESBUILD (not webpack/vite)?
//   - Zero configuration needed beyond this script
//   - Extremely fast (10-100x faster than webpack)
//   - Built-in TypeScript support (no separate ts-loader needed)
//   - Small output — Chrome extensions benefit from minimal file sizes
//   - No dev server needed — we just produce static JS files
//
// WHAT GETS BUILT:
//   Each entry point becomes a separate output file in dist/:
//
//   src/background.ts         → dist/background.js
//     Service worker: runs in the background, manages storage/badges/alarms
//
//   src/content-google.ts     → dist/content-google.js
//     Content script: injected into every Google search page
//
//   src/content-perplexity.ts → dist/content-perplexity.js
//     Content script: injected into every Perplexity.ai page
//
//   src/popup/popup.ts        → dist/popup/popup.js
//     Popup script: runs when user opens the extension popup
//
// BUILD FORMAT:
//   We use 'iife' (Immediately Invoked Function Expression) format
//   for content scripts and popup — this wraps the code in a function
//   to avoid polluting the global scope of the pages they run on.
//
//   We use 'esm' for the background service worker because Chrome's
//   Manifest V3 service workers support ES modules natively.
//
// HOW TO RUN:
//   npm run build         → builds once
//   npm run build:watch   → rebuilds on any file change (development)
// ══════════════════════════════════════════════════════════════════════

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// ─── Ensure dist directories exist ──────────────────────────────────────────
// esbuild creates output files but NOT directories — we must create them first.
['dist', 'dist/popup'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// ─── Build Configuration ─────────────────────────────────────────────────────

/**
 * Entry points for esbuild.
 * Each key is the output path, each value is the source file path.
 *
 * 'entryPoints' as an object allows us to control output filenames precisely.
 * If we used an array, esbuild would mirror the src/ directory structure.
 */
const entryPoints = {
  'dist/background':          'src/background.ts',
  'dist/content-google':      'src/content-google.ts',
  'dist/content-perplexity':  'src/content-perplexity.ts',
  'dist/popup/popup':         'src/popup/popup.ts',
};

const sharedConfig = {
  bundle: true,           // Bundle all imports into a single file per entry point
  sourcemap: true,        // Generate .js.map files for debugging in Chrome DevTools
  target: ['chrome120'],  // Target modern Chrome — safe for extensions (MV3 requires Chrome 88+)
  logLevel: 'info',       // Show what files were built and their sizes
};

async function build() {
  console.log('🔨 Building LearnPulse Chrome Extension...\n');

  try {
    // Build content scripts and popup with 'iife' format
    // IIFE = "(function() { ...your code... })()" — self-executing, isolated scope
    // This prevents the extension code from interfering with page globals.
    await esbuild.build({
      ...sharedConfig,
      entryPoints: {
        'dist/content-google':      'src/content-google.ts',
        'dist/content-perplexity':  'src/content-perplexity.ts',
        'dist/popup/popup':         'src/popup/popup.ts',
      },
      outdir: '.',
      format: 'iife',
    });

    // Build background service worker with 'esm' format
    // MV3 service workers run as ES modules (they're not injected into pages).
    // Using ESM here allows top-level await and modern module semantics.
    await esbuild.build({
      ...sharedConfig,
      entryPoints: {
        'dist/background': 'src/background.ts',
      },
      outdir: '.',
      format: 'esm',
    });

    // ─── Copy Static Assets ────────────────────────────────────────────
    // esbuild only compiles .ts → .js. Static HTML files must be copied
    // manually into dist/ so they live alongside their compiled scripts.
    //
    // WHY THIS MATTERS:
    //   popup.html contains: <script src="popup.js"></script>
    //   Chrome resolves that path RELATIVE TO THE HTML FILE's location.
    //
    //   If the HTML is at  src/popup/popup.html
    //   Chrome looks for:  src/popup/popup.js   ← doesn't exist!
    //
    //   If the HTML is at  dist/popup/popup.html
    //   Chrome looks for:  dist/popup/popup.js  ← esbuild output ✓
    //
    // So we must serve popup.html from dist/popup/, not src/popup/.
    fs.copyFileSync(
      path.join(__dirname, 'src/popup/popup.html'),
      path.join(__dirname, 'dist/popup/popup.html')
    );
    console.log('  ✓ Copied src/popup/popup.html → dist/popup/popup.html');

    console.log('\n✅ Build complete! Load the chrome-extension/ folder in Chrome.');
    console.log('   chrome://extensions → Developer mode → Load unpacked');

  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
