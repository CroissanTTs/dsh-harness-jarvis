import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const START = '<!-- CONFIG:START -->';
const END = '<!-- CONFIG:END -->';
const cell = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\|/g, '&#124;').replace(/`/g, '&#96;').replace(/\r?\n/g, '<br>');

/** Public configuration surface: only assistant-relevant fields are documented
 *  in the README. Fields belonging to mechanisms that are not part of the
 *  current release stay internal (still configurable, just not advertised). */
export const PUBLIC_FIELDS = new Set([
  'locale', 'audioDir', 'ttsBackend', 'edgeVoice', 'greetings', 'provider', 'model',
]);

/** Accept schemas as values so tests can use source Config without a build. */
export function renderConfigTable(config, settings) {
  const defaults = config({});
  const rows = Object.entries(config.dict)
    .filter(([key]) => PUBLIC_FIELDS.has(key))
    .map(([key, schema]) => {
      const type = schema.type === 'union' ? schema.list.map(item => JSON.stringify(item.value)).join(' / ')
        : schema.type === 'array' ? 'string[]' : schema.type;
      return `| \`${cell(key)}\` | ${cell(type)} | \`${cell(JSON.stringify(defaults[key]))}\` | ${Object.hasOwn(settings.dict, key) ? '是 / Yes' : '否 / No'} |`;
    });
  return ['| 字段 / Field | 类型 / Type | 默认值 / Default | DSH 设置页 / Settings |',
    '|---|---|---|---|', ...rows].join('\n');
}

export function replaceConfigTable(readme, table) {
  const start = readme.indexOf(START), end = readme.indexOf(END);
  if (start < 0 || end < start || readme.indexOf(START, start + START.length) !== -1 ||
      readme.indexOf(END, end + END.length) !== -1) throw Error('Invalid README configuration markers');
  return readme.slice(0, start + START.length) + '\n' + table + '\n' + readme.slice(end);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { Config, SettingsSchema } = await import('../lib/index.js');
  const table = renderConfigTable(Config, SettingsSchema);
  // The English README is the npm/primary doc; the Chinese README mirrors it.
  const files = ['README.md', 'README.zh.md'];
  let stale = false;
  for (const name of files) {
    const file = new URL('../' + name, import.meta.url);
    const before = await readFile(file, 'utf8');
    let after;
    try { after = replaceConfigTable(before, table); } catch { console.error(`${name} has no configuration markers`); process.exitCode = 1; continue; }
    if (before !== after) stale = true;
    if (!process.argv.includes('--check')) await writeFile(file, after);
  }
  if (stale && process.argv.includes('--check')) {
    console.error('README configuration is stale; run npm run docs:config.');
    process.exitCode = 1;
  }
}
