<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useSettingsStore } from '../store/useSettingsStore';
import { exportTokensForMappings } from '../services/tokenExporter';
import { GithubApiError, syncTokensToGithub } from '../services/github';

const store = useSettingsStore();

const selectedIds = reactive(new Set<string>());
const running = ref(false);
const log = ref<string[]>([]);
const prLinks = ref<{ modeName: string; url: string }[]>([]);

const mappings = computed(() => store.settings.mappings);
const allSelected = computed(
  () => mappings.value.length > 0 && selectedIds.size === mappings.value.length,
);

function toggleAll(checked: boolean) {
  selectedIds.clear();
  if (checked) mappings.value.forEach((mapping) => selectedIds.add(mapping.id));
}

function toggleMapping(id: string, checked: boolean) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
}

function appendLog(message: string) {
  log.value = [...log.value, message];
}

async function runSync() {
  const targets = mappings.value.filter((mapping) => selectedIds.has(mapping.id));
  if (targets.length === 0 || running.value) return;

  running.value = true;
  log.value = [];
  prLinks.value = [];

  for (const mapping of targets) {
    appendLog(`[1/4] Reading variable mode "${mapping.modeName}" from document...`);
    // eslint-disable-next-line no-await-in-loop
    const { results, errors } = await exportTokensForMappings([mapping]);

    const failure = errors.find((e) => e.mappingId === mapping.id);
    if (failure) {
      appendLog(`Failed to read "${mapping.modeName}": ${failure.message}`);
      continue;
    }

    const exported = results.find((r) => r.mappingId === mapping.id);
    if (!exported) {
      appendLog(`No tokens were returned for "${mapping.modeName}".`);
      continue;
    }

    appendLog('[2/4] Generating W3C Tokens via @mimir/figma-to-dtcg...');

    try {
      // eslint-disable-next-line no-await-in-loop
      const prUrl = await syncTokensToGithub(
        store.settings.githubPAT,
        {
          owner: mapping.targetRepoOwner,
          repo: mapping.targetRepoName,
          baseBranch: mapping.targetBranch || 'main',
          modeName: mapping.modeName,
        },
        exported.tokens,
        (step) => appendLog(`[${step.step}/${step.total}] ${step.message}`),
      );
      appendLog(`Pull Request created for "${mapping.modeName}".`);
      prLinks.value = [...prLinks.value, { modeName: mapping.modeName, url: prUrl }];
    } catch (error) {
      const message = error instanceof GithubApiError ? error.message : (error as Error).message;
      appendLog(`Failed to sync "${mapping.modeName}": ${message}`);
    }
  }

  running.value = false;
}
</script>

<template>
  <section class="home-tab">
    <h3>Select Modes</h3>
    <p v-if="mappings.length === 0" class="empty">
      No modes are configured yet. Configure one in the Settings tab.
    </p>

    <div v-else class="mode-selector">
      <label class="mode-checkbox">
        <input
          type="checkbox"
          :checked="allSelected"
          @change="toggleAll(($event.target as HTMLInputElement).checked)"
        >
        All
      </label>
      <label v-for="mapping in mappings" :key="mapping.id" class="mode-checkbox">
        <input
          type="checkbox"
          :checked="selectedIds.has(mapping.id)"
          @change="toggleMapping(mapping.id, ($event.target as HTMLInputElement).checked)"
        >
        {{ mapping.modeName }}
      </label>
    </div>

    <button
      type="button"
      class="primary"
      :disabled="running || selectedIds.size === 0"
      @click="runSync"
    >
      {{ running ? 'Syncing...' : 'Export & Push Tokens' }}
    </button>

    <pre v-if="log.length" class="log">{{ log.join('\n') }}</pre>

    <ul v-if="prLinks.length" class="pr-links">
      <li v-for="pr in prLinks" :key="pr.url">
        <a :href="pr.url" target="_blank" rel="noopener noreferrer">{{ pr.modeName }}: View Pull Request</a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
h3 {
  margin: 0 0 8px;
}

.empty {
  color: #888;
}

.mode-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.mode-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
}

.primary {
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 4px;
  background: #0066ff;
  color: #fff;
  font-weight: 600;
}

.primary:disabled {
  background: #b3d1ff;
  cursor: not-allowed;
}

.log {
  margin-top: 12px;
  padding: 8px;
  background: #f7f7f7;
  border-radius: 4px;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  max-height: 220px;
  overflow-y: auto;
}

.pr-links {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

.pr-links a {
  color: #0066ff;
  font-weight: 600;
}
</style>
