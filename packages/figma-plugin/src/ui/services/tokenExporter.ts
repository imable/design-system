import type {
  ExportedModeTokens, ExportTokensError, MainToUIMessage, ModeMappingConfig,
} from '../../shared/types';
import { createRequestId, requestFromMain } from './ipc';

/**
 * Outside of Figma (e.g. `vite dev` in a plain browser tab for UI development)
 * there is no plugin main thread to ask for a real export, so a mock payload
 * stands in - this is the "@mimir/tokens mock wrapper" the plugin spec calls
 * for. Inside Figma, the real export always runs in `main/code.ts`, since
 * only that sandboxed thread can reach `figma.variables`.
 */
const isInsideFigma = typeof window !== 'undefined' && window.parent !== window;

async function mockExportTokens(
  mappings: ModeMappingConfig[],
): Promise<{ results: ExportedModeTokens[]; errors: ExportTokensError[] }> {
  const results: ExportedModeTokens[] = mappings.map((mapping) => ({
    mappingId: mapping.id,
    tokens: {
      color: {
        primary: {
          $type: 'color',
          $value: '#0066ff',
          $description: `Mock token generated for local development (mode: ${mapping.modeName})`,
        },
      },
    },
  }));
  return { results, errors: [] };
}

function isExportResult(
  message: MainToUIMessage,
  requestId: string,
): message is Extract<MainToUIMessage, { type: 'export-tokens-result' }> {
  return message.type === 'export-tokens-result' && message.requestId === requestId;
}

export async function exportTokensForMappings(
  mappings: ModeMappingConfig[],
): Promise<{ results: ExportedModeTokens[]; errors: ExportTokensError[] }> {
  if (mappings.length === 0) return { results: [], errors: [] };
  // if (!isInsideFigma) return mockExportTokens(mappings);

  const requestId = createRequestId();
  const response = await requestFromMain(
    { type: 'export-tokens', requestId, mappingIds: mappings.map((m) => m.id) },
    (message): message is Extract<MainToUIMessage, { type: 'export-tokens-result' }> => isExportResult(message, requestId),
  );

  return { results: response.results, errors: response.errors };
}
