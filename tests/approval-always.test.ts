import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiveState, PENDING_GRACE_MS } from '../src/live-state.ts';

function setup() {
  let now = 1000, saved = 0, allowed = true;
  const live = new LiveState('jarvis', () => now);
  const options = { canAlwaysAllow: () => allowed, onAlways: () => { saved++; } };
  const req = { agent: { id: 'worker' }, toolName: 'bash' };
  const show = () => { now += PENDING_GRACE_MS; return live.pending()[0]; };
  return { live, req, options, show, saved: () => saved, disallow: () => { allowed = false; } };
}
describe('等价类', () => {
  it('always resolves allowed-once and signals one preset after winning', async () => {
    const s = setup(); const done = s.live.holdApproval(s.req, () => new Promise(() => {}), 'npm test', s.options);
    const card = s.show(); assert.equal(card.canAlwaysAllow, true);
    assert.equal(s.live.answer({ id: card.id, decision: 'always' }), 'ok');
    assert.equal(await done, 'allowed-once'); assert.equal(s.saved(), 1);
    assert.equal(s.live.answer({ id: card.id, decision: 'always' }), 'not-found'); assert.equal(s.saved(), 1);
  });
  for (const decision of ['allow', 'deny']) it(`${decision} does not save a preset`, async () => {
    const s = setup(); const done = s.live.holdApproval(s.req, () => new Promise(() => {}), 'npm test', s.options);
    s.live.answer({ id: s.show().id, decision }); await done; assert.equal(s.saved(), 0);
  });
});
describe('边界值', () => {
  it('DSH winning the race prevents a late panel always from saving', async () => {
    const s = setup(); let settle!: (s: any) => void;
    const downstream = new Promise<any>(r => { settle = r; });
    const done = s.live.holdApproval(s.req, () => downstream, 'npm test', s.options);
    const card = s.show(); await Promise.resolve(); settle('rejected'); await Promise.resolve();
    assert.equal(s.live.answer({ id: card.id, decision: 'always' }), 'not-found');
    assert.equal(await done, 'rejected'); assert.equal(s.saved(), 0);
  });
  it('rechecks eligibility at click time, leaves normal allow usable', async () => {
    const s = setup(); const done = s.live.holdApproval(s.req, () => new Promise(() => {}), 'npm test', s.options);
    const card = s.show(); s.disallow();
    assert.equal(s.live.answer({ id: card.id, decision: 'always' }), 'invalid');
    assert.equal(s.live.pending()[0].canAlwaysAllow, false);
    s.live.answer({ id: card.id, decision: 'allow' }); assert.equal(await done, 'allowed-once'); assert.equal(s.saved(), 0);
  });
});
describe('异常路径', () => {
  it('missing policy/high risk hides button and rejects forged always', async () => {
    const s = setup(); const done = s.live.holdApproval(s.req, () => new Promise(() => {}), 'rm -rf .');
    const card = s.show(); assert.equal(card.canAlwaysAllow, false);
    assert.equal(s.live.answer({ id: card.id, decision: 'always' }), 'invalid');
    s.live.answer({ id: card.id, decision: 'deny' }); assert.equal(await done, 'rejected');
  });
  it('throwing selected callback never changes approval outcome', async () => {
    const s = setup(); s.options.onAlways = () => { throw Error('disk failed'); };
    const done = s.live.holdApproval(s.req, () => new Promise(() => {}), 'npm test', s.options);
    s.live.answer({ id: s.show().id, decision: 'always' }); assert.equal(await done, 'allowed-once');
  });
  it('aborted requests cannot create rules', async () => {
    const s = setup(); const abort = new AbortController();
    const done = s.live.holdApproval({ ...s.req, signal: abort.signal }, () => new Promise(() => {}), 'npm test', s.options);
    const card = s.show(); abort.abort();
    assert.equal(s.live.answer({ id: card.id, decision: 'always' }), 'not-found');
    assert.equal(await done, 'cancelled'); assert.equal(s.saved(), 0);
  });
});
