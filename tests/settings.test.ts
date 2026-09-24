import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/index.ts';
import { mergeSettings, type JarvisSettings } from '../src/settings.ts';
const defaults = Config({}) as JarvisSettings;

describe('等价类', () => {
  it('merges editable values, trims strings, copies greetings and preserves the base', () => {
    const greetings = ['  你好。 ', '欢迎。'];
    const merged = mergeSettings(defaults, { provider: ' custom ', model: ' test ', edgeVoice: ' voice ', greetings,
      judgeEnabled: false, judgeProvider: ' other ', judgeModel: ' judge ', judgeTimeoutMs: 30000, maxContinueRounds: 4 });
    assert.deepEqual(merged, { provider: 'custom', model: 'test', edgeVoice: 'voice', greetings: ['你好。', '欢迎。'],
      judgeEnabled: false, askInterception: false, judgeProvider: 'other', judgeModel: 'judge', judgeTimeoutMs: 30000, maxContinueRounds: 4 });
    assert.notEqual(merged.greetings, greetings);
    assert.equal(defaults.judgeEnabled, true);
  });
  it('partial source falls back to composition, unknown/internal keys are excluded', () => {
    const base = { ...defaults, provider: 'my-provider', maxContinueRounds: 3 };
    const value = mergeSettings(base, { judgeModel: 'x', runtimeFile: '/wrong', unknownField: true });
    assert.equal(value.provider, 'my-provider'); assert.equal(value.maxContinueRounds, 3);
    assert.ok(!('runtimeFile' in value)); assert.ok(!('unknownField' in value));
  });
  it('empty judge overrides follow the main model and empty greetings clear additions', () => {
    const value = mergeSettings({ ...defaults, judgeProvider: 'x', judgeModel: 'y', greetings: ['z'] },
      { judgeProvider: ' ', judgeModel: '', greetings: [] });
    assert.equal(value.judgeProvider, ''); assert.equal(value.judgeModel, ''); assert.deepEqual(value.greetings, []);
  });
});
describe('边界值', () => {
  for (const rounds of [0, 10]) it(`accepts round limit ${rounds}`, () => {
    assert.equal(mergeSettings(defaults, { maxContinueRounds: rounds }).maxContinueRounds, rounds);
  });
  for (const timeout of [1000, 120000]) it(`accepts timeout ${timeout}`, () => {
    assert.equal(mergeSettings(defaults, { judgeTimeoutMs: timeout }).judgeTimeoutMs, timeout);
  });
  it('blank required strings fall back to base', () => {
    const value = mergeSettings(defaults, { provider: '', model: '  ', edgeVoice: '\n' });
    assert.equal(value.provider, defaults.provider); assert.equal(value.model, defaults.model); assert.equal(value.edgeVoice, defaults.edgeVoice);
  });
});
describe('异常路径', () => {
  for (const invalid of [-1, 11, 1.5, NaN, Infinity, '3', null]) it(`rejects invalid round limit ${invalid}`, () => {
    assert.equal(mergeSettings(defaults, { maxContinueRounds: invalid }).maxContinueRounds, 2);
  });
  for (const invalid of [999, 120001, 2000.5, NaN, '20000']) it(`rejects invalid timeout ${invalid}`, () => {
    assert.equal(mergeSettings(defaults, { judgeTimeoutMs: invalid }).judgeTimeoutMs, 20000);
  });
  it('malformed fields fall back without coercion', () => {
    const value = mergeSettings(defaults, { judgeEnabled: 'false', greetings: [1, 'hello'], judgeModel: {}, edgeVoice: false });
    assert.equal(value.judgeEnabled, true); assert.deepEqual(value.greetings, []); assert.equal(value.judgeModel, '');
  });
  for (const source of [null, undefined, [], 'broken']) it(`ignores malformed source ${source}`, () => {
    assert.deepEqual(mergeSettings(defaults, source), mergeSettings(defaults, {}));
  });
});
