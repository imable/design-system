import {
  RGB, RGBA,
  LocalVariableCollection, VariableValue, LocalVariable, VariableAlias, GetLocalVariablesResponse,
} from '@figma/rest-api-spec';

/**
 * Configure this package for the Figma Variables Rest API.
 *
 * @example
 * {
 *    // The API used
 *    api
 *    // Response from Figma Variables Rest API /v1/files/:file_key/variables/* endpoint
 *    response
 * }
 */
export type RestAPIProps = {
  api?: 'rest'
  response: GetLocalVariablesResponse
}

/**
 * Configure this package for the Figma Plugin API.
 *
 * @example
 * {
 *    // The API used
 *    api
 *    // Pass in Figma Plugin API client
 *    client: figma
 * }
 */
export type PluginAPIProps = {
  api?: 'plugin',
  client: PluginAPI
}

export type Options<Collection> = {
  verbosity?: 'silent' | 'verbose',
  typeMap?: Record<FigmaTokenType, (category: Collection) => string>
}

type OptionalExcept<T, K extends keyof T> = Pick<T, K> & Partial<T>
export type DesignTokenType = 'color' | 'number' | 'boolean' | 'string'
export type FigmaTokenType = LocalVariable['resolvedType']
export type DesignToken = {
  $type: DesignTokenType
  $value: string | number | boolean | RGB | CompositeToken
  $description: string
}
export interface CompositeToken { [key: string]: DesignToken['$value'] }
export type Token = DesignToken | CompositeToken

export type Tree = Token | { [key: string]: Tree };
export type Node = Exclude<Tree, Token>

export type Tokens<
  Themes extends string,
  Variants extends string,
  SharedCollections extends string,
  InvariantCollections extends string,
  VariantCollections extends string
> = {
  [sc in SharedCollections]?: Tree } & {
    [ic in InvariantCollections]?: { [theme in Themes]?: Tree } } & {
    [vc in VariantCollections]?: { [theme in `${Themes}_${Variants}`]?: Tree }
  }

let globalOptions: Required<Options<any>>;
const defaultOptions: typeof globalOptions = {
  verbosity: 'silent',
  typeMap: {
    COLOR: () => 'color',
    FLOAT: () => 'number',
    STRING: () => 'string',
    BOOLEAN: () => 'boolean',
  },
};
const isVerbose = () => globalOptions.verbosity === 'verbose';

let getVariableById: (id: string) => Promise<LocalVariable>;
let getAllVariables: () => Promise<LocalVariable[]>;

/**
 * Converts an RGB(a) value to HEX
 *
 * @param color Color in RGB(a) format
 * @returns Color in HEX format
 */
function rgbToHex({
  r, g, b, a,
}: RGBA) {
  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };

  const hex = [toHex(r), toHex(g), toHex(b)];
  if (a !== 1) {
    hex.push(toHex(a));
  }
  return `#${hex.join('')}`;
}

/**
 * Cleans the name of a variable according to Design Token (W3C) standard
 *
 * @param name Name of a variable
 * @returns Name trimmed and snake_case
 */
function sanitizeName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/^ +/, '')
    .replace(/ +$/, '')
    .replace(/ +/g, '_')
    .toLowerCase();
}

function roundFloat(float: number, precision = 6): number {
  return parseFloat(float.toFixed(precision));
}

/**
 * Checks if the name of a collection, group or variable is private.
 *
 * @param collection Name of the collection
 * @returns True if private
 */
function isPrivate(collection: string) {
  return collection.startsWith('_');
}

/**
 * Map Figma ids to names of variables and collections
 *
 * @param nodesWithNames Collection of variables
 * @param idKey The key of the id in the `nodesWithNames` parameter
 * @returns Functions that map from id to name and back
 */
function uniqueKeyIdMaps<T extends OptionalExcept<LocalVariableCollection, 'name'>, K extends keyof T, F extends T[K] & (string | number | symbol)>(nodesWithNames: T[], idKey: K) {
  const idToKey: Record<F, string> = {} as Record<F, string>;
  const keyToId: Record<string, T[K]> = {};

  nodesWithNames.forEach((node) => {
    const key = sanitizeName(node.name);
    let int = 2;
    let uniqueKey = key;
    while (keyToId[uniqueKey]) {
      uniqueKey = `${key}_${int}`;
      int += 1;
    }
    keyToId[uniqueKey] = node[idKey];
    idToKey[node[idKey] as F] = uniqueKey;
  });

  return { idToKey, keyToId };
}

/**
 * Convert single variable to Design Token (W3C) standard
 *
 * @param name Name of the current variable
 * @param value Value of the current variable
 * @param type Type of current variable
 * @returns Value of the variable in Design Token (W3C) standard
 */
async function valueToJSON(
  name: string,
  value: VariableValue,
  type: LocalVariable['resolvedType'],
): Promise<DesignToken['$value'] | undefined> {
  const isAlias = (
    v: VariableValue,
  ): v is VariableAlias => !!(v as VariableAlias).type && !!(v as VariableAlias).id;

  const isForeground = (
    { name: _name }: LocalVariable,
  ): boolean => !!_name.match(/^Foreground\/[\w\s]+\/[\w\s]+$/);

  const isColorPalette = (
    { name: _name }: LocalVariable,
  ): boolean => !!_name.match(/^[A-Za-z]+\/\d+\/Background$/);

  let _value: DesignToken['$value'];

  // If the variable is a reference to another variable
  if (isAlias(value)) {
    // Get the referenced variable
    const variable = (await getVariableById(value.id));
    if (!variable) {
      if (isVerbose()) {
        console.warn(`Missing alias definiton for ${name}. Your Figma file might contain variables with a definition outside of the file. Skipping...`);
      }
      return undefined;
    }

    const alias = `{${variable.name.replace(/\//g, '.')}}`;

    _value = alias;

    // Expand the referenced variable to every sibling variant that lives
    // next to it under the same `Foreground/<Category>/` group, e.g. a
    // reference to `Foreground/Text/HighEmphasis` also pulls in
    // `Foreground/Text/MediumEmphasis` if that variant exists too.
    if (isForeground(variable)) {
      const [, groupPrefix, variantName] = variable.name.match(/^(Foreground\/[\w\s]+\/)([\w\s]+)$/)!;
      const siblingVariables = (await getAllVariables()).filter(
        (sibling) => sibling.name !== variable.name
          && sibling.name.startsWith(groupPrefix)
          && !sibling.name.slice(groupPrefix.length).includes('/'),
      );

      _value = siblingVariables.reduce<CompositeToken>((acc, sibling) => {
        acc[sibling.name.slice(groupPrefix.length)] = `{${sibling.name.replace(/\//g, '.')}}`;
        return acc;
      }, { [variantName]: alias });
    }

    // Expand the referenced variable if it is a reference to the color palette
    // If the current variable is a foreground color, do not expand it to avoid circular references
    if (isColorPalette(variable) && !isForeground({ name } as LocalVariable)) {
      _value = {
        Background: alias,
        Foreground: alias.replace('Background', 'Foreground'),
      };
    }
  } else if (type === 'COLOR') {
    _value = rgbToHex(value as RGBA);
  } else if (type === 'FLOAT') {
    _value = roundFloat(value as number);
  } else {
    _value = value as string;
  }

  return _value;
}

/**
 * Converts a collection to Design Token (W3C) standard
 *
 * @param collection The variable collection to export
 * @returns The collection in the Design Token (W3C) format
 */
async function collectionAsJSON(
  { name: collectionName, modes, variableIds }: LocalVariableCollection,
) {
  const collection: Record<string, Tree> = {};
  const { idToKey, keyToId } = uniqueKeyIdMaps(modes, 'modeId');
  const modeKeys = Object.values(idToKey);
  const isMultiMode = modeKeys.length > 1;

  // Add nesting for each mode if we have multiple
  if (isMultiMode) {
    modeKeys.forEach((mode: string) => {
      collection[mode] = collection[mode] || {};
    });
  }

  variables: for (const variableId of variableIds) {
    const {
      name,
      resolvedType,
      valuesByMode,
      remote,
      description
    } = (await getVariableById(variableId))!;

    if (remote) {
      if (isVerbose()) {
        console.warn(`Skipping remote variable ${name}`);
      }
      continue;
    }

    for (const mode of modeKeys) {
      // Do not nest if there is only one mode
      let obj = isMultiMode ? collection[mode] : collection;
      const value = valuesByMode[keyToId[mode]];

      if (value !== undefined && ['COLOR', 'FLOAT', 'STRING'].includes(resolvedType)) {
        const groups = name.split('/');
        const objValue = await valueToJSON(name, value, resolvedType);

        if (
          groups.some((group) => isPrivate(group))
          || objValue === undefined
        ) {
          continue variables;
        }

        groups.forEach((groupName) => {
          obj = obj as Node;
          obj[groupName] = obj[groupName] || {};
          obj = obj[groupName];
        });

        obj.$value = objValue;
        obj.$type = globalOptions.typeMap[resolvedType](sanitizeName(collectionName));
        obj.$description = description;
      }
    }
  }
  return collection;
}

/**
 * Provides Design Tokens from a given Figma instance
 * using either Figma Variables Rest API or the Plugin API.
 *
 * **Typing of the returned Tokens object using generics**
 *
 * 1. Themes = keys of the available themes
 *
 * Example: type Themes = "normal" | "halloween" | "easter"
 *
 * 2. Variants = keys of variants for each theme
 *
 * Example: type Variants = "light" | "dark"
 *
 * 3. SharedCollections = Keys of collections that do not change across themes
 *
 * example: "border" | "spacing"
 *
 * 4. InvariantCollections = Keys of collections that do not change according to variant of a theme,
 * but change across themes
 *
 * Example: "color_palette"
 *
 * 5. VariantCollections = Keys of collections that change according to theme variant
 *
 * Example: "themes"
 *
 * @param props
 * @returns `{ tokens }` Design Tokens in W3C spec
 */
async function useFigmaToDTCG<
  Themes extends string = any,
  Variants extends string = any,
  SharedCollections extends string = any,
  InvariantCollections extends string = any,
  VariantCollections extends string = any
>(
  props: RestAPIProps | PluginAPIProps,
  options?: Options<SharedCollections | InvariantCollections | VariantCollections>,
) {
  globalOptions = {
    ...defaultOptions,
    ...options,
  } as Required<Options<SharedCollections | InvariantCollections | VariantCollections>>;

  const isRestApiEnv = (p: typeof props): p is RestAPIProps => p.api === 'rest';

  getVariableById = isRestApiEnv(props)
    ? (id: string) => Promise.resolve(props.response.meta.variables[id])
    : (id: string) => props.client.variables.getVariableByIdAsync(id) as Promise<LocalVariable>;
  // The full variable list doesn't change while this function runs, so fetch it
  // (or read it off the REST response) once and hand every caller the same
  // cached promise instead of re-fetching per lookup.
  const allVariables: Promise<LocalVariable[]> = isRestApiEnv(props)
    ? Promise.resolve(Object.values(props.response.meta.variables))
    : (props.client.variables.getLocalVariablesAsync() as Promise<LocalVariable[]>);
  getAllVariables = () => allVariables;
  const collections = isRestApiEnv(props)
    ? Object.values(props.response.meta.variableCollections)
    : await props.client.variables.getLocalVariableCollectionsAsync();

  const tree: Tree = {};

  for (const collection of collections) {
    if (collection.remote) {
      if (isVerbose()) console.warn(`Skipping remote collection ${collection.name}`);
      continue;
    }

    const name = sanitizeName(collection.name);

    // Skip this collection if private
    if (isPrivate(name)) continue;

    tree[name] = await collectionAsJSON(collection);
  }

  return {
    tokens: tree as Tokens<
      Themes,
      Variants,
      SharedCollections,
      InvariantCollections,
      VariantCollections
    >,
  };
}

export { useFigmaToDTCG };
// export type ImportOptions = {
//   verbosity?: 'silent' | 'verbose'
// }

// export type ImportSummary = {
//   createdCollections: number
//   createdVariables: number
//   updatedVariables: number
//   skippedAliases: string[]
// }

// const designTypeToFigmaType: Record<DesignTokenType, FigmaTokenType> = {
//   color: 'COLOR',
//   number: 'FLOAT',
//   boolean: 'BOOLEAN',
//   string: 'STRING',
// };

// function isDesignToken(node: unknown): node is DesignToken {
//   return typeof node === 'object' && node !== null && '$value' in node && '$type' in node;
// }

// /**
//  * Recovers the single alias string `valueToJSON` expands into a composite
//  * `$value` for readability, e.g.
//  * `{ Primary: alias, Secondary: alias.replace(...), Disabled: alias.replace(...) }`
//  * (foreground variables) or `{ Background: alias, Foreground: alias.replace(...) }`
//  * (color palette variables). In both cases the first field always holds the
//  * variable's actual, unmodified alias - the remaining fields are derived purely
//  * for documentation and do not correspond to values Figma stores separately.
//  *
//  * @param value `$value` of a Design Token
//  * @returns The value to use when assigning this token to a Variable
//  */
// function unwrapCompositeValue(value: DesignToken['$value']): DesignToken['$value'] {
//   if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
//     const composite = value as CompositeToken;
//     if (typeof composite.Primary === 'string') return composite.Primary;
//     if (typeof composite.Background === 'string') return composite.Background;
//   }
//   return value;
// }

// /**
//  * Resolves the Variable Mode(s) a collection's token tree should be imported
//  * into.
//  *
//  * `collectionAsJSON` nests a collection's entire token tree once per Mode
//  * when the collection has more than one, using the (sanitized) Mode name as
//  * the key - otherwise the tree starts directly with groups/tokens under the
//  * collection's single Mode. Since a Mode layer and a group are structurally
//  * identical (both are plain nested objects), the only reliable way to tell
//  * them apart on import is to check whether any top-level key already names a
//  * Mode on the matched Variable Collection. When one does, every sibling key
//  * at that level is treated as a Mode too, adding any that don't exist yet.
//  *
//  * A brand new collection has no Modes to match against, so its tree is
//  * always imported as a single Mode - there is no way to tell a Mode layer
//  * from a group without prior knowledge of the collection's Modes.
//  *
//  * @param collection The matched (or newly created) Variable Collection
//  * @param tree The token tree for this collection
//  * @returns One entry per Mode to import, pairing its Mode id with the subtree to walk
//  */
// function resolveModeSections(
//   collection: VariableCollection,
//   tree: Tree,
// ): { modeId: string, subtree: Tree }[] {
//   const modeIdsByName = new Map<string, string>();
//   collection.modes.forEach((mode) => modeIdsByName.set(sanitizeName(mode.name), mode.modeId));

//   const entries: [string, Tree][] = typeof tree === 'object' && tree !== null && !isDesignToken(tree)
//     ? Object.entries(tree as Record<string, Tree>)
//     : [];

//   // `key` is already sanitized - it came from a tree produced by `useFigmaToDTCG` -
//   // so it is compared as-is against `sanitizeName(mode.name)` rather than being
//   // sanitized again, which would corrupt it (sanitizeName strips underscores,
//   // but also produces them when replacing spaces).
//   const isModeLayer = entries.some(([key]) => modeIdsByName.has(key));

//   if (!isModeLayer) {
//     return [{ modeId: collection.defaultModeId, subtree: tree }];
//   }

//   return entries.map(([key, subtree]) => {
//     let modeId = modeIdsByName.get(key);
//     if (!modeId) {
//       modeId = collection.addMode(key);
//       modeIdsByName.set(key, modeId);
//     }
//     return { modeId, subtree };
//   });
// }

// /**
//  * Converts a HEX color to an RGB(a) value, normalized between 0 and 1
//  *
//  * @param hex Color in `#RRGGBB` or `#RRGGBBAA` HEX format
//  * @returns Color in RGB(a) format
//  */
// function hexToRgb(hex: string): RGBA {
//   const channels = hex.replace('#', '');
//   const toChannel = (channelHex: string) => parseInt(channelHex, 16) / 255;

//   return {
//     r: toChannel(channels.slice(0, 2)),
//     g: toChannel(channels.slice(2, 4)),
//     b: toChannel(channels.slice(4, 6)),
//     a: channels.length === 8 ? toChannel(channels.slice(6, 8)) : 1,
//   };
// }

// /**
//  * Walks a tree of Design Tokens, collecting every leaf token along with the
//  * path of group names leading to it.
//  *
//  * @param node Current position in the tree
//  * @param path Group names collected so far
//  * @returns Every Design Token found, paired with its path
//  */
// function collectDesignTokens(
//   node: unknown,
//   path: string[] = [],
// ): { path: string[], token: DesignToken }[] {
//   if (typeof node !== 'object' || node === null) {
//     if (isVerbose()) console.warn(`Skipping unsupported token at ${path.join('/')}`);
//     return [];
//   }

//   if (isDesignToken(node)) {
//     return [{ path, token: node }];
//   }

//   return Object.entries(node).flatMap(
//     ([key, child]) => collectDesignTokens(child, [...path, key]),
//   );
// }

// /**
//  * Imports a Design Tokens (W3C) tree into Figma, creating or updating
//  * Variable Collections and Variables to match.
//  *
//  * The top-level keys of `tokens` are matched against existing Variable
//  * Collections by (sanitized) name, creating a new collection when there is
//  * no match. Every leaf token is then upserted as a Variable, using the
//  * group path leading to it (joined with `/`) as the Variable name -
//  * mirroring how {@link useFigmaToDTCG} constructs the tree from Variable
//  * names in the first place.
//  *
//  * When a collection has more than one Mode, {@link useFigmaToDTCG} nests the
//  * whole tree once per Mode under its (sanitized) name - see
//  * {@link resolveModeSections} for how that layer is detected and imported
//  * into the matching Mode, adding any Mode that doesn't exist yet.
//  *
//  * Alias tokens (`"{group.path.to.token}"`) are resolved against every
//  * Variable touched by this import, plus every Variable that already existed
//  * in the file. Variables are created for every token before any value is
//  * assigned, so an alias may reference a token that appears later in `tokens`
//  * or lives in a different collection.
//  *
//  * @param tokens Design Tokens (W3C) tree, as produced by {@link useFigmaToDTCG}
//  * @param props Figma Plugin API client
//  * @param options
//  * @returns A summary of the collections and variables that were created or updated
//  */
// async function useDTCGToFigma(
//   tokens: Tree,
//   props: PluginAPIProps,
//   options?: ImportOptions,
// ): Promise<ImportSummary> {
//   const verbose = options?.verbosity === 'verbose';
//   const { client } = props;

//   const summary: ImportSummary = {
//     createdCollections: 0,
//     createdVariables: 0,
//     updatedVariables: 0,
//     skippedAliases: [],
//   };

//   const collections = await client.variables.getLocalVariableCollectionsAsync();
//   const collectionVariables = new Map<string, Map<string, Variable>>();
//   const aliasTargets = new Map<string, Variable>();

//   (await client.variables.getLocalVariablesAsync()).forEach((variable) => {
//     aliasTargets.set(variable.name, variable);
//   });

//   async function getCollectionVariables(collection: VariableCollection) {
//     if (!collectionVariables.has(collection.id)) {
//       const variables = await Promise.all(
//         collection.variableIds.map((id) => client.variables.getVariableByIdAsync(id)),
//       );
//       const byName = new Map<string, Variable>();
//       variables.forEach((variable) => {
//         if (variable) byName.set(variable.name, variable);
//       });
//       collectionVariables.set(collection.id, byName);
//     }
//     return collectionVariables.get(collection.id)!;
//   }

//   const pending: { variable: Variable, token: DesignToken, modeId: string }[] = [];

//   for (const [collectionKey, tree] of Object.entries(tokens as Node)) {
//     let collection = collections.find(
//       // `collectionKey` is already sanitized - see the note in `resolveModeSections`.
//       (c) => sanitizeName(c.name) === collectionKey,
//     );

//     if (!collection) {
//       collection = client.variables.createVariableCollection(collectionKey);
//       collections.push(collection);
//       summary.createdCollections += 1;
//     }

//     const variableNames = await getCollectionVariables(collection);

//     for (const { modeId, subtree } of resolveModeSections(collection, tree as Tree)) {
//       for (const { path, token } of collectDesignTokens(subtree)) {
//         const name = path.join('/');
//         let variable = variableNames.get(name);

//         if (!variable) {
//           variable = client.variables.createVariable(
//             name,
//             collection,
//             designTypeToFigmaType[token.$type],
//           );
//           variableNames.set(name, variable);
//           summary.createdVariables += 1;
//         } else {
//           summary.updatedVariables += 1;
//         }

//         aliasTargets.set(name, variable);
//         if (token.$description) variable.description = token.$description;
//         pending.push({ variable, token, modeId });
//       }
//     }
//   }

//   // Every Variable referenced by this import now exists, so alias targets can be resolved
//   // regardless of the order in which they appeared in `tokens`.
//   for (const { variable, token, modeId } of pending) {
//     const value = unwrapCompositeValue(token.$value);
//     const alias = typeof value === 'string' ? value.match(/^\{(.+)\}$/) : null;

//     if (alias) {
//       const target = aliasTargets.get(alias[1].replace(/\./g, '/'));
//       if (!target) {
//         if (verbose) console.warn(`Missing alias target for ${variable.name}: ${value}. Skipping...`);
//         summary.skippedAliases.push(variable.name);
//         continue;
//       }
//       variable.setValueForMode(modeId, client.variables.createVariableAlias(target));
//     } else if (token.$type === 'color' && typeof value === 'string') {
//       variable.setValueForMode(modeId, hexToRgb(value));
//     } else if (token.$type === 'number') {
//       variable.setValueForMode(
//         modeId,
//         typeof value === 'number' ? value : parseFloat(value as string),
//       );
//     } else if (token.$type === 'boolean') {
//       variable.setValueForMode(
//         modeId,
//         typeof value === 'boolean' ? value : value === 'true',
//       );
//     } else {
//       variable.setValueForMode(modeId, String(value));
//     }
//   }

//   return summary;
// }

// export { useFigmaToDTCG, useDTCGToFigma };
