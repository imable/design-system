<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../store/useSettingsStore';
import type { ModeMappingConfig } from '../../shared/types';

const store = useSettingsStore();

interface DiscoveredMode {
  collectionId: string;
  collectionName: string;
  modeId: string;
  modeName: string;
  mapping?: ModeMappingConfig;
}

const discoveredModes = computed<DiscoveredMode[]>(() => store.collections.flatMap(
  (collection) => collection.modes.map((mode) => ({
    collectionId: collection.id,
    collectionName: collection.name,
    modeId: mode.modeId,
    modeName: mode.name,
    mapping: store.settings.mappings.find(
      (m) => m.figmaCollectionId === collection.id && m.figmaModeId === mode.modeId,
    ),
  })),
));

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `mapping_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function configureMode(mode: DiscoveredMode) {
  store.addMapping({
    id: createId(),
    figmaCollectionId: mode.collectionId,
    figmaCollectionName: mode.collectionName,
    figmaModeId: mode.modeId,
    modeName: mode.modeName,
    targetRepoOwner: '',
    targetRepoName: '',
    targetBranch: 'main',
  });
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
</script>

<template>
  <section class="settings-tab">
    <label class="field">
      <span>GitHub Personal Access Token</span>
      <input
        type="password"
        placeholder="ghp_..."
        :value="store.settings.githubPAT"
        @input="store.setGithubPAT(inputValue($event))"
      >
      <small>Requires the <code>repo</code> scope.</small>
    </label>

    <div class="field-row">
      <h3>Modes ({{ store.modeSourceCollectionName || '…' }})</h3>
      <button type="button" class="link-button" @click="store.refreshCollections()">Refresh</button>
    </div>

    <p v-if="discoveredModes.length === 0" class="empty">
      No "{{ store.modeSourceCollectionName }}" collection found in this document.
    </p>

    <ul class="mode-list">
      <li
        v-for="mode in discoveredModes"
        :key="`${mode.collectionId}:${mode.modeId}`"
        class="mode-item"
      >
        <div class="mode-header">
          <span class="mode-name">{{ mode.modeName }}</span>
          <span v-if="!mode.mapping" class="badge">Not configured</span>
        </div>

        <div v-if="mode.mapping" class="mode-fields">
          <input
            placeholder="Repo owner"
            :value="mode.mapping.targetRepoOwner"
            @input="store.updateMapping(mode.mapping!.id, { targetRepoOwner: inputValue($event) })"
          >
          <input
            placeholder="Repo name"
            :value="mode.mapping.targetRepoName"
            @input="store.updateMapping(mode.mapping!.id, { targetRepoName: inputValue($event) })"
          >
          <input
            placeholder="Branch"
            :value="mode.mapping.targetBranch"
            @input="store.updateMapping(mode.mapping!.id, { targetBranch: inputValue($event) })"
          >
          <button type="button" class="danger" @click="store.removeMapping(mode.mapping!.id)">
            Remove
          </button>
        </div>
        <button v-else type="button" @click="configureMode(mode)">Configure</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}

.field input {
  padding: 6px 8px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
}

.field small {
  color: #888;
}

.field-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

h3 {
  margin: 0 0 8px;
}

.link-button {
  border: none;
  background: none;
  color: #0066ff;
}

.empty {
  color: #888;
}

.mode-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-item {
  border: 1px solid #e6e6e6;
  border-radius: 6px;
  padding: 8px;
}

.mode-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.mode-name {
  font-weight: 600;
}

.badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  background: #ffe4d6;
  color: #b3450a;
}

.mode-fields {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 6px;
}

.mode-fields input {
  padding: 5px 6px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  min-width: 0;
}

.danger {
  border: 1px solid #e6e6e6;
  background: none;
  color: #c62828;
  border-radius: 4px;
}
</style>
