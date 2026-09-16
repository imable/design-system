# Design Token GitHub Sync

A Figma plugin that exports Figma variables as W3C Design Tokens (via `@mimir/figma-to-dtcg`) and syncs them to target GitHub repositories by opening automated Pull Requests.

## How it works

Each Variable Mode (e.g. `Saga`, `Mimir`) on a Variable Collection can be mapped to a target GitHub repository, owner and branch. Mode names are never hardcoded - they're read from the active document via `figma.variables.getLocalVariableCollectionsAsync()` every time the plugin opens, and any mapping pointing at a Collection/Mode that no longer exists is dropped automatically.

For each selected mode mapping, running a sync will:

1. Read the mode's variables from the current document.
2. Generate a W3C Design Tokens tree for that mode via `@mimir/figma-to-dtcg`.
3. Create a branch `figma-tokens-{modeName}-{timestamp}` off the mapping's target branch.
4. Overwrite `/tokens/{modeName}.json` on that branch and open a Pull Request back to the target branch.

## Architecture

- `src/main/code.ts` - the sandboxed main thread. Only this thread can reach `figma.variables` and `figma.clientStorage`, so it owns reading live Collections/Modes, the startup drift check, and the token export itself.
- `src/main/storageBridge.ts` - thin wrapper around `figma.clientStorage`.
- `src/ui/` - the Vue 3 + Pinia UI (iframe). It never talks to `figma.*` directly; everything goes through IPC messages defined in `src/shared/types.ts`. GitHub REST calls (`src/ui/services/github.ts`) run here, since this is the thread with `fetch`.
- `src/ui/store/useSettingsStore.ts` - Pinia store whose "persistence provider" is the IPC bridge: every change is pushed to main as a `save-settings` message, and the store is hydrated from the `init` message main sends on startup.
- `src/ui/services/tokenExporter.ts` - requests a token export from main; outside of Figma (e.g. running the UI standalone with `vite dev` for local development) it falls back to a mock payload, since there's no plugin thread to ask.

## Development

```sh
npm run build      # builds dist/ui.html and dist/code.js
npm run watch      # rebuilds on change
```

Load `manifest.json` into Figma via **Plugins → Development → Import plugin from manifest**.
