import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Config, SettingsSchema } from '../src/index.ts';
import { renderConfigTable, replaceConfigTable } from '../scripts/readme-config.mjs';

describe('等价类', () => {
  it('README configuration is generated from the actual Config and settings schema', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.equal(replaceConfigTable(readme, renderConfigTable(Config, SettingsSchema)), readme);
    for (const key of Object.keys(Config.dict!)) assert.ok(readme.includes('`' + key + '`'));
  });
  it('renders enum choices, defaults and settings availability without applying the plugin', () => {
    const table = renderConfigTable(Config, SettingsSchema);
    assert.match(table, /autoApprove.*off.*safe.*safe\+grey/);
    assert.match(table, /judgeTimeoutMs.*20000.*是/);
    assert.match(table, /runtimeFile.*否/);
  });
});
describe('边界值', () => {
  it('escapes pipes, backticks and HTML in defaults so values cannot break the table', () => {
    const schema = Object.assign(() => ({ field: '<b>|`\n' }), { dict: { field: { type: 'string' } } });
    const table = renderConfigTable(schema, { dict: {} });
    assert.ok(table.includes('&lt;b&gt;&#124;&#96;\\n'));
    assert.equal(table.split('\n').length, 3);
  });
  it('replaces only the generated section, preserves surrounding prose, and is idempotent', () => {
    const before = 'intro\n<!-- CONFIG:START -->\nold\n<!-- CONFIG:END -->\nend\n';
    const after = replaceConfigTable(before, 'table');
    assert.equal(after, 'intro\n<!-- CONFIG:START -->\ntable\n<!-- CONFIG:END -->\nend\n');
    assert.equal(replaceConfigTable(after, 'table'), after);
  });
});
describe('异常路径', () => {
  it('refuses missing, duplicated or reversed markers instead of overwriting README prose', () => {
    for (const value of ['', '<!-- CONFIG:END --><!-- CONFIG:START -->',
      '<!-- CONFIG:START --><!-- CONFIG:START --><!-- CONFIG:END -->']) {
      assert.throws(() => replaceConfigTable(value, 'table'), /marker/i);
    }
  });
});
