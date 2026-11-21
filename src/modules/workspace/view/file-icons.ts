import manifest from 'material-icon-theme/dist/material-icons.json';

declare const __FILE_ICONS_DIR__: string;

const svgOfDefinition = new Map<string, string>();
for (const [definition, meta] of Object.entries(manifest.iconDefinitions)) {
  const svg = meta.iconPath?.split('/').pop();
  if (svg) svgOfDefinition.set(definition, svg);
}

function resolveKeys(mapping: Record<string, string>): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const [key, definition] of Object.entries(mapping)) {
    const svg = svgOfDefinition.get(definition);
    if (svg) resolved.set(key.toLowerCase(), svg);
  }
  return resolved;
}

const byName = resolveKeys(manifest.fileNames);
const byExt = resolveKeys(manifest.fileExtensions);
const baseUrl = import.meta.env.DEV ? `/@fs/${__FILE_ICONS_DIR__}/` : './file-icons/';

export function fileIconUrl(fileName: string): string | null {
  const name = fileName.toLowerCase();
  const icon = byName.get(name) ?? suffixIconOf(name);
  return icon ? baseUrl + icon : null;
}

function suffixIconOf(name: string): string | null {
  let dot = name.indexOf('.');
  while (dot !== -1) {
    const icon = byExt.get(name.slice(dot + 1));
    if (icon) return icon;
    dot = name.indexOf('.', dot + 1);
  }
  return null;
}
