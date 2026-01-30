# CLAUDE.md

Chrome extension to sync Raindrop.io bookmarks to browser bookmarks with collection-based folder structure.

## Project Overview

Forked from [lasuillard/raindrop-sync-chrome](https://github.com/lasuillard/raindrop-sync-chrome).

**Key Feature:** Syncs all Raindrop collections as browser bookmark folders, preserving hierarchy.

## Architecture

```
raindrop-sync-chrome/
├── src/
│   ├── lib/
│   │   ├── browser/chrome.ts    # Chrome bookmark operations
│   │   ├── raindrop/            # Raindrop API client wrapper
│   │   └── sync/manager.ts      # Sync orchestration
│   ├── options/                 # Settings page (Svelte)
│   ├── popup/                   # Popup UI (Svelte)
│   └── service-worker.ts        # Background sync scheduler
├── dist/                        # Built extension (load unpacked)
└── release/                     # Packaged .zip
```

## Key Components

| File | Purpose |
|------|---------|
| `lib/sync/manager.ts` | Orchestrates sync: validate → fetch tree → clear → recreate |
| `lib/browser/chrome.ts` | `createBookmarksRecursively()` - creates folder structure |
| `lib/raindrop/client.ts` | Wraps `@lasuillard/raindrop-client` for API calls |

## How Sync Works

1. `getCollectionTree()` fetches all collections as a tree
2. For each collection node:
   - Fetch all raindrops (bookmarks) in that collection
   - Create bookmark entries in browser
   - For child collections, create subfolder and recurse
3. Unsorted bookmarks go to root sync folder (collection ID -1)

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Development mode with HMR
npm run build        # Build extension to dist/
npm run test         # Run unit tests
```

## Loading in Chrome

1. Build: `npm run build`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `dist/` folder

## Configuration

In extension options:
- **Access Token**: Your Raindrop.io API test token
- **Sync Location**: Which bookmark folder to sync into
- **Auto-sync**: Enable periodic sync

## API Token

Get from https://app.raindrop.io/settings/integrations → "Create test token"

Tom's token: `eda98fb2-e1ea-439a-bac9-f522a0e072fb` (in Bitwarden)

## Git Attribution

```bash
git config user.name "TomsTech"
git config user.email "82087949+TomsTech@users.noreply.github.com"
```

No AI attribution in commits.
