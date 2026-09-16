/**
 *
 * Main export code based on code by `jake-figma`
 * https://github.com/jake-figma/figma-token-json
 *
 */
import { useFigmaToDTCG, useDTCGToFigma, type Tree } from '@mimir/figma-to-dtcg';

console.clear();
console.log('------------------- Console cleared by Design Tokens (W3C) Export -------------------');

figma.showUI(__html__);

/**
 * Exports generated files to .zip
 *
 * Takes a tree of design tokens, split is up by collection and mode
 * and generates a file structure that is send to a .zip file.
 *
 * The generated structure is as follows, which is send to the front-end for download.
 *
 * ```
 * {
 *   [collection].[mode].json: json_content,
 *   ...
 * }
 * ```
 *
 */
async function exportFiles() {
  const { tokens } = await useFigmaToDTCG({
    api: 'plugin',
    client: figma,
  });
  const collections = Object.keys(tokens);

  type FileName = string
  const zipContent: Record<FileName, string> = {};

  collections.forEach((collection) => {
    const fileName = `${collection}.json`;
    const content = JSON.stringify(tokens[collection], null, 2);
    zipContent[fileName] = content;
  });

  figma.ui.postMessage({
    type: 'download-zip',
    contents: zipContent,
    raw: JSON.stringify(tokens, null, 2),
  });
}

exportFiles();

/**
 * Imports a pasted Design Tokens (W3C) JSON tree, upserting Figma Variables
 * and Variable Collections to match, then reports the outcome back to the UI.
 *
 * @param tokens Design Tokens (W3C) tree, as pasted into the UI
 */
async function importTokens(tokens: unknown) {
  try {
    const summary = await useDTCGToFigma(tokens as Tree, { api: 'plugin', client: figma });

    figma.notify(`Imported ${summary.createdVariables + summary.updatedVariables} variable(s) across ${summary.createdCollections} new collection(s)`);
    figma.ui.postMessage({ type: 'import-result', ok: true, summary });
  } catch (error) {
    figma.notify('Failed to import Design Tokens', { error: true });
    figma.ui.postMessage({ type: 'import-result', ok: false, error: (error as Error).message });
  }
}

figma.ui.onmessage = (message) => {
  if (message?.type === 'import-tokens') {
    importTokens(message.tokens);
  }
};
