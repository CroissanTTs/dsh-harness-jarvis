import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkState, checkWait, checkMessages, checkStatus, checkManagedState, checkRuntime, runManagedRoundTrip } from '../scripts/smoke.mjs';

const session = { id: 'worker', title: 'Worker', status: 'idle', managed: false };
const state = (sessions = [session]) => ({ status: 200, body: { sessions, voice: {}, pending: [] } });
const runtime = { origin: 'http://127.0.0.1:1234', token: 'secret', rendererHeader: { name: 'X-Renderer', value: 'renderer-secret' } };
const ok = (result: { passed: boolean }) => assert.equal(result.passed, true);
const bad = (result: { passed: boolean; reason?: string }) => {
  assert.equal(result.passed, false);
  assert.ok(result.reason);
  assert.equal(result.reason!.includes('secret'), false);
};

// In-memory request injection exercises rollback sequencing, without a server or real DSH.
function fakeAPI(failAt = '') {
  let managed = false;
  let reads = 0;
  const writes: boolean[] = [];
  return {
    writes,
    request: async (path: string, options: any = {}) => {
      if (path === '/jarvis/state') {
        reads++;
        if ((failAt === 'confirm' && reads === 2) || (failAt === 'restore-state' && reads === 3)) throw Error('secret response');
        return state([{ ...session, managed }]);
      }
      assert.equal(path, '/jarvis/managed');
      managed = options.body.managed;
      writes.push(managed);
      if ((failAt === 'add-response' && managed) || (failAt === 'restore-response' && !managed)) throw Error('secret transport');
      if (failAt === 'not-restored' && !managed) managed = true;
      return { status: 200 };
    },
  };
}

describe('等价类', () => {
  it('validates state rows, wait version, message envelope and expected statuses', () => {
    ok(checkState(state()));
    ok(checkWait({ status: 200, body: { version: 12 } }, 20));
    ok(checkMessages({ status: 200, body: { messages: [{ role: 'assistant' }], count: 1 } }));
    ok(checkStatus({ status: 404 }, 404));
    ok(checkStatus({ status: 400 }, 400));
    ok(checkManagedState(state(), 'worker', false));
    ok(checkRuntime(runtime));
  });
  it('temporarily manages an unmanaged visible session and confirms restoration', async () => {
    const api = fakeAPI();
    ok(await runManagedRoundTrip(api.request));
    assert.deepEqual(api.writes, [true, false]);
  });
});

describe('边界值', () => {
  it('allows empty lists and message envelopes without optional count', () => {
    ok(checkState(state([])));
    ok(checkMessages({ status: 200, body: { messages: [], count: 0 } }));
    ok(checkMessages({ status: 200, body: { messages: [], error: 'no session' } }));
    ok(checkState(state([{ ...session, title: '' }])));
  });
  it('accepts wait version zero and exactly 1500ms but rejects the next instant', () => {
    ok(checkWait({ status: 200, body: { version: 0 } }, 1500));
    bad(checkWait({ status: 200, body: { version: 0 } }, 1500.001));
  });
  it('skips write checks when all visible sessions are managed or no sessions exist', async () => {
    for (const sessions of [[], [{ ...session, managed: true }]]) {
      let calls = 0;
      const result = await runManagedRoundTrip(async () => { calls++; return state(sessions); });
      ok(result);
      assert.equal(result.skipped, true);
      assert.equal(calls, 1);
    }
  });
  it('accepts IPv6 loopback and optional renderer header', () => {
    ok(checkRuntime({ origin: 'http://[::1]:1234', token: 'secret' }));
  });
});

describe('异常路径', () => {
  it('rejects malformed state envelopes and session fields', () => {
    for (const body of [null, [], {}, { sessions: [], voice: [], pending: [] }, { sessions: [], voice: {}, pending: {} }]) {
      bad(checkState({ status: 200, body }));
    }
    for (const row of [null, {}, { ...session, id: '' }, { ...session, title: 1 }, { ...session, status: null }, { ...session, managed: 'false' }]) {
      bad(checkState(state([row as any])));
    }
    bad(checkState({ status: 500, body: { secret: 'secret' } }));
  });
  it('rejects absent, negative, fractional and nonnumeric versions or timings', () => {
    for (const version of [undefined, -1, 1.5, '1', Infinity]) bad(checkWait({ status: 200, body: { version } }, 0));
    for (const elapsed of [-1, NaN, Infinity]) bad(checkWait({ status: 200, body: { version: 0 } }, elapsed));
  });
  it('rejects bare message arrays, malformed messages and incorrect count', () => {
    for (const body of [[], null, {}, { messages: {} }, { messages: [], count: 1 }, { messages: [], count: '0' }]) {
      bad(checkMessages({ status: 200, body }));
    }
    bad(checkMessages({ status: 500, body: { error: 'secret' } }));
    bad(checkStatus({ status: 200, body: { error: 'secret' } }, 404));
  });
  it('rejects missing sessions and wrong managed state during confirmation', () => {
    bad(checkManagedState(state(), 'missing', false));
    bad(checkManagedState(state(), 'worker', true));
  });
  it('refuses nonlocal origins, URL credentials, malformed tokens and unsafe renderer headers', () => {
    for (const origin of ['https://remote.example', 'http://secret@127.0.0.1:1234', 'http://127.0.0.1:1234?secret', 'http://127.0.0.1:1234/path', 'secret']) {
      bad(checkRuntime({ ...runtime, origin }));
    }
    for (const token of ['', null, 'secret\nvalue']) bad(checkRuntime({ ...runtime, token }));
    for (const rendererHeader of [{}, { name: 'Authorization', value: 'secret' }, { name: 'Host', value: 'secret' }, { name: 'X-Renderer', value: '\nsecret' }]) {
      bad(checkRuntime({ ...runtime, rendererHeader }));
    }
  });
  it('restores even when the add response is lost or confirmation fails', async () => {
    for (const point of ['add-response', 'confirm']) {
      const api = fakeAPI(point);
      bad(await runManagedRoundTrip(api.request));
      assert.deepEqual(api.writes, [true, false]);
    }
  });
  it('fails when restoration cannot be confirmed, including a lost rollback response', async () => {
    for (const point of ['restore-response', 'restore-state', 'not-restored']) {
      const api = fakeAPI(point);
      const result = await runManagedRoundTrip(api.request);
      bad(result);
      assert.match(result.reason, /恢复/);
      assert.deepEqual(api.writes, [true, false]);
    }
  });
  it('makes no writes when initial state is invalid or unavailable', async () => {
    for (const response of [null, { status: 500 }]) {
      let calls = 0;
      bad(await runManagedRoundTrip(async () => { calls++; if (!response) throw Error('secret'); return response; }));
      assert.equal(calls, 1);
    }
  });
});
