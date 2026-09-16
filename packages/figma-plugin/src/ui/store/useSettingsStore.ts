import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type {
  FigmaCollectionInfo,
  ModeMappingConfig,
  SettingsConfig,
  StaleMapping,
  UnconfiguredMode,
} from '../../shared/types';
import { createEmptySettings } from '../../shared/types';
import { onMainMessage, postToMain } from '../services/ipc';

/**
 * Settings are the single source of truth persisted to `figma.clientStorage`,
 * which only the plugin's main thread can reach. This store's persistence
 * provider is therefore the IPC bridge itself: every change is pushed to
 * main with a `save-settings` message, and the store is hydrated from the
 * `init` message main sends back on plugin startup (after running its own
 * drift check against the live document).
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<SettingsConfig>(createEmptySettings());
  const collections = ref<FigmaCollectionInfo[]>([]);
  const modeSourceCollectionName = ref('');
  const staleMappings = ref<StaleMapping[]>([]);
  const unconfiguredModes = ref<UnconfiguredMode[]>([]);
  const ready = ref(false);

  // Set while applying settings that came from main, so the watcher below
  // doesn't immediately echo them straight back as a redundant save.
  let hydrating = false;

  function hydrate(next: SettingsConfig) {
    hydrating = true;
    settings.value = next;
    queueMicrotask(() => { hydrating = false; });
  }

  onMainMessage((message) => {
    switch (message.type) {
      case 'init':
        hydrate(message.settings);
        collections.value = message.collections;
        modeSourceCollectionName.value = message.modeSourceCollectionName;
        staleMappings.value = message.staleMappings;
        unconfiguredModes.value = message.unconfiguredModes;
        ready.value = true;
        break;
      case 'collections':
        collections.value = message.collections;
        modeSourceCollectionName.value = message.modeSourceCollectionName;
        break;
      default:
        break;
    }
  });

  watch(settings, (next) => {
    if (hydrating) return;
    postToMain({ type: 'save-settings', settings: next });
  }, { deep: true });

  function setGithubPAT(pat: string) {
    settings.value.githubPAT = pat;
  }

  function addMapping(mapping: ModeMappingConfig) {
    settings.value.mappings.push(mapping);
  }

  function updateMapping(id: string, patch: Partial<ModeMappingConfig>) {
    const mapping = settings.value.mappings.find((m) => m.id === id);
    if (mapping) Object.assign(mapping, patch);
  }

  function removeMapping(id: string) {
    settings.value.mappings = settings.value.mappings.filter((m) => m.id !== id);
  }

  function refreshCollections() {
    postToMain({ type: 'get-collections' });
  }

  function initialize() {
    postToMain({ type: 'ready' });
  }

  return {
    settings,
    collections,
    modeSourceCollectionName,
    staleMappings,
    unconfiguredModes,
    ready,
    setGithubPAT,
    addMapping,
    updateMapping,
    removeMapping,
    refreshCollections,
    initialize,
  };
});
