<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useSettingsStore } from './store/useSettingsStore';
import SettingsTab from './components/SettingsTab.vue';
import HomeTab from './components/HomeTab.vue';

const store = useSettingsStore();
const activeTab = ref<'home' | 'settings'>('home');

onMounted(() => {
  store.initialize();
});
</script>

<template>
  <div class="app">
    <nav class="tabs">
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'home' }"
        @click="activeTab = 'home'"
      >
        Home
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'settings' }"
        @click="activeTab = 'settings'"
      >
        Settings
        <span v-if="store.unconfiguredModes.length" class="tab-dot" />
      </button>
    </nav>

    <div v-if="store.staleMappings.length" class="banner banner--warning">
      Removed {{ store.staleMappings.length }} mapping(s) that pointed to a Collection or Mode
      no longer in this document.
    </div>
    <div v-if="store.unconfiguredModes.length" class="banner banner--info">
      {{ store.unconfiguredModes.length }} newly detected mode(s) need configuring.
      <a href="#" @click.prevent="activeTab = 'settings'">Open Settings</a>
    </div>

    <main class="content">
      <HomeTab v-if="activeTab === 'home'" />
      <SettingsTab v-else />
    </main>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  color: #1a1a1a;
}

button {
  font: inherit;
  cursor: pointer;
}

input {
  font: inherit;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.tabs {
  display: flex;
  border-bottom: 1px solid #e6e6e6;
}

.tab {
  position: relative;
  flex: 1;
  padding: 10px;
  border: none;
  background: none;
  color: #666;
  border-bottom: 2px solid transparent;
}

.tab--active {
  color: #0066ff;
  border-bottom-color: #0066ff;
  font-weight: 600;
}

.tab-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 4px;
  border-radius: 50%;
  background: #ff5c33;
  vertical-align: middle;
}

.banner {
  padding: 8px 12px;
  font-size: 11px;
  border-bottom: 1px solid #e6e6e6;
}

.banner--warning {
  background: #fff4e5;
  color: #8a5300;
}

.banner--info {
  background: #eaf2ff;
  color: #0044b3;
}

.banner a {
  color: inherit;
  font-weight: 600;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
</style>
