import type { Tree } from '@mimir/figma-to-dtcg';

export interface ModeMappingConfig {
  id: string; // GUID
  figmaCollectionId: string;
  figmaCollectionName: string; // e.g., "Base Colors"
  figmaModeId: string;
  modeName: string; // Dynamically fetched name (e.g., "Saga", "Mimir", "Brand A")
  targetRepoOwner: string;
  targetRepoName: string;
  targetBranch: string; // Default: "main"
}

export interface SettingsConfig {
  githubPAT: string;
  mappings: ModeMappingConfig[];
}

export function createEmptySettings(): SettingsConfig {
  return { githubPAT: '', mappings: [] };
}

/** A single Mode discovered on a live Figma Variable Collection. */
export interface FigmaModeInfo {
  modeId: string;
  name: string;
}

/** A live Figma Variable Collection, serialized for the UI thread. */
export interface FigmaCollectionInfo {
  id: string;
  name: string;
  modes: FigmaModeInfo[];
}

/** One mapping that referenced a Collection/Mode no longer present in the document. */
export interface StaleMapping {
  mapping: ModeMappingConfig;
  reason: 'collection-removed' | 'mode-removed';
}

/** A live Mode that has no corresponding entry in `SettingsConfig.mappings`. */
export interface UnconfiguredMode {
  collectionId: string;
  collectionName: string;
  modeId: string;
  modeName: string;
}

export interface ExportedModeTokens {
  mappingId: string;
  tokens: Tree;
}

export interface ExportTokensError {
  mappingId: string;
  message: string;
}

// ---------------------------------------------------------------------------
// IPC messages: main (sandboxed plugin thread) <-> ui (iframe)
// ---------------------------------------------------------------------------

export type MainToUIMessage =
  | {
    type: 'init';
    settings: SettingsConfig;
    collections: FigmaCollectionInfo[];
    modeSourceCollectionName: string;
    staleMappings: StaleMapping[];
    unconfiguredModes: UnconfiguredMode[];
  }
  | { type: 'collections'; collections: FigmaCollectionInfo[]; modeSourceCollectionName: string }
  | { type: 'settings-saved'; settings: SettingsConfig }
  | {
    type: 'export-tokens-result';
    requestId: string;
    results: ExportedModeTokens[];
    errors: ExportTokensError[];
  }
  | { type: 'notify'; message: string; error?: boolean };

export type UIToMainMessage =
  | { type: 'ready' }
  | { type: 'get-collections' }
  | { type: 'save-settings'; settings: SettingsConfig }
  | { type: 'export-tokens'; requestId: string; mappingIds: string[] };
