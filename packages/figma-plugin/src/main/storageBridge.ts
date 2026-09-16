import { createEmptySettings, type SettingsConfig } from '../shared/types';

const STORAGE_KEY = 'design-token-sync-settings';

/**
 * Reads the plugin's persisted settings from `figma.clientStorage`.
 * `clientStorage` is only reachable from this sandboxed main thread, so the
 * UI (iframe) always goes through IPC messages to read or write settings.
 */
export async function loadSettings(): Promise<SettingsConfig> {
  const stored = await figma.clientStorage.getAsync(STORAGE_KEY);
  if (!stored) return createEmptySettings();
  return { ...createEmptySettings(), ...(stored as Partial<SettingsConfig>) };
}

export async function saveSettings(settings: SettingsConfig): Promise<void> {
  await figma.clientStorage.setAsync(STORAGE_KEY, settings);
}
