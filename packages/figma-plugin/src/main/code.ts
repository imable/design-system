import { useFigmaToDTCG, type Tree } from '@mimir/figma-to-dtcg';
import { loadSettings, saveSettings } from './storageBridge';
import type {
  ExportedModeTokens,
  ExportTokensError,
  FigmaCollectionInfo,
  MainToUIMessage,
  ModeMappingConfig,
  SettingsConfig,
  StaleMapping,
  UIToMainMessage,
  UnconfiguredMode,
} from '../shared/types';

figma.showUI(__html__, { width: 420, height: 600 });

/**
 * Name of the single Variable Collection whose Modes (e.g. "Saga", "Mimir")
 * are surfaced to the UI and mapped to target repos. Edit this to point at a
 * different Collection - everything else (drift detection, mode selection,
 * token export) adapts automatically.
 */
const MODE_SOURCE_COLLECTION_NAME = 'Base Colors';

function postToUI(message: MainToUIMessage) {
  figma.ui.postMessage(message);
}

async function getLiveCollections(): Promise<VariableCollection[]> {
  return figma.variables.getLocalVariableCollectionsAsync();
}

function getModeSourceCollection(collections: VariableCollection[]): VariableCollection | undefined {
  return collections.find(
    (collection) => collection.name.trim().toLowerCase() === MODE_SOURCE_COLLECTION_NAME.toLowerCase(),
  );
}

/** Serializes only the Modes of `MODE_SOURCE_COLLECTION_NAME`, for the UI. */
function serializeCollections(collections: VariableCollection[]): FigmaCollectionInfo[] {
  const collection = getModeSourceCollection(collections);
  if (!collection) return [];

  return [{
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
  }];
}

/**
 * Compares persisted mappings against the live document, splitting out any
 * mapping whose Collection or Mode no longer exists (stale) from the ones
 * still valid, and surfacing live Modes that have no mapping yet.
 */
function detectDrift(
  settings: SettingsConfig,
  collections: FigmaCollectionInfo[],
): { validMappings: ModeMappingConfig[]; staleMappings: StaleMapping[]; unconfiguredModes: UnconfiguredMode[] } {
  const collectionsById = new Map(collections.map((c) => [c.id, c]));
  const validMappings: ModeMappingConfig[] = [];
  const staleMappings: StaleMapping[] = [];

  settings.mappings.forEach((mapping) => {
    const collection = collectionsById.get(mapping.figmaCollectionId);
    if (!collection) {
      staleMappings.push({ mapping, reason: 'collection-removed' });
      return;
    }
    const mode = collection.modes.find((m) => m.modeId === mapping.figmaModeId);
    if (!mode) {
      staleMappings.push({ mapping, reason: 'mode-removed' });
      return;
    }
    validMappings.push(mapping);
  });

  const mappedModeIds = new Set(validMappings.map((m) => `${m.figmaCollectionId}:${m.figmaModeId}`));
  const unconfiguredModes: UnconfiguredMode[] = [];
  collections.forEach((collection) => {
    collection.modes.forEach((mode) => {
      if (!mappedModeIds.has(`${collection.id}:${mode.modeId}`)) {
        unconfiguredModes.push({
          collectionId: collection.id,
          collectionName: collection.name,
          modeId: mode.modeId,
          modeName: mode.name,
        });
      }
    });
  });

  return { validMappings, staleMappings, unconfiguredModes };
}

/** Mirrors the name sanitizing `@mimir/figma-to-dtcg` applies to Collection and Mode names. */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/ +/g, '_')
    .toLowerCase();
}

function isTree(value: unknown): value is Record<string, Tree> {
  return typeof value === 'object' && value !== null && !('$value' in value);
}

/**
 * `useFigmaToDTCG` nests a Collection's tree once per Mode (keyed by the
 * sanitized Mode name) only when that Collection has more than one Mode -
 * otherwise the Collection's tree applies to every Mode equally. This walks
 * the full export and, per Collection, picks out just the target Mode's
 * subtree (or the whole Collection, when it doesn't vary by Mode).
 */
function extractModeTokens(
  tree: Tree,
  targetModeName: string,
  allModeNames: string[],
): Tree {
  const targetKey = sanitizeName(targetModeName);
  const knownModeKeys = new Set(allModeNames.map(sanitizeName));
  const result: Record<string, Tree> = {};

  Object.entries(tree as Record<string, Tree>).forEach(([collectionKey, subtree]) => {
    if (!isTree(subtree)) return;

    const isModeLayer = Object.keys(subtree).some((key) => knownModeKeys.has(key));
    if (!isModeLayer) {
      result[collectionKey] = subtree;
    } else if (targetKey in subtree) {
      result[collectionKey] = (subtree as Record<string, Tree>)[targetKey];
    }
  });

  return result;
}

async function exportTokensForMappings(
  mappings: ModeMappingConfig[],
): Promise<{ results: ExportedModeTokens[]; errors: ExportTokensError[] }> {
  const results: ExportedModeTokens[] = [];
  const errors: ExportTokensError[] = [];
  if (mappings.length === 0) return { results, errors };

  try {
    const { tokens } = await useFigmaToDTCG({ api: 'plugin', client: figma });
    const allModeNames = mappings.map((m) => m.modeName);

    mappings.forEach((mapping) => {
      results.push({
        mappingId: mapping.id,
        tokens: extractModeTokens(tokens as Tree, mapping.modeName, allModeNames),
      });
    });
  } catch (error) {
    mappings.forEach((mapping) => {
      errors.push({ mappingId: mapping.id, message: (error as Error).message });
    });
  }

  return { results, errors };
}

async function init() {
  const [collectionsRaw, settings] = await Promise.all([getLiveCollections(), loadSettings()]);
  const collections = serializeCollections(collectionsRaw);
  const { validMappings, staleMappings, unconfiguredModes } = detectDrift(settings, collections);

  if (staleMappings.length > 0) {
    settings.mappings = validMappings;
    await saveSettings(settings);
  }

  postToUI({
    type: 'init',
    settings,
    collections,
    modeSourceCollectionName: MODE_SOURCE_COLLECTION_NAME,
    staleMappings,
    unconfiguredModes,
  });
}

figma.ui.onmessage = async (message: UIToMainMessage) => {
  switch (message.type) {
    case 'ready':
      await init();
      break;
    case 'get-collections': {
      const collections = serializeCollections(await getLiveCollections());
      postToUI({ type: 'collections', collections, modeSourceCollectionName: MODE_SOURCE_COLLECTION_NAME });
      break;
    }
    case 'save-settings':
      await saveSettings(message.settings);
      postToUI({ type: 'settings-saved', settings: message.settings });
      break;
    case 'export-tokens': {
      const settings = await loadSettings();
      const mappings = settings.mappings.filter((m) => message.mappingIds.includes(m.id));
      const { results, errors } = await exportTokensForMappings(mappings);
      postToUI({
        type: 'export-tokens-result', requestId: message.requestId, results, errors,
      });
      break;
    }
    default:
      break;
  }
};
