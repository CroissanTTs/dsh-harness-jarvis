import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AutoApproval } from '../src/auto-approval.ts';
import type { ApprovalTier } from '../src/approval-tier.ts';

function setup(tier: ApprovalTier = 'grey', mode = 'safe+grey') {
  const state = { mode, preset: false, history: { approvals: 0, denials: 0, complete: true, records: [] as unknown[] },
    calls: 0, historyCalls: 0, presetCalls: 0, tier, current: true, timeout: 100,
    text: '{"decision":"allow","confidence":0.9,"reason":"用户已授权此局部操作"}' };
  let stream: any = async function* (request: any) {
    state.calls++; assert.equal(request.purpose, 'jarvis-approval');
    yield { type: 'text-delta', text: state.text }; yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const deps = { config: () => ({ autoApprove: state.mode as any, provider:'base', model:'base-model', judgeProvider:'', judgeModel:'', judgeTimeoutMs:state.timeout }),
    classify: () => state.tier, llm: () => ({ stream: (r: any) => stream(r) }),
    preset: async () => { state.presetCalls++; return state.preset; },
    history: async () => { state.historyCalls++; return state.history; },
  };
  const auto = new AutoApproval(deps);
  const req = { operation: { tool:'bash', command:'npm test', cwd:'/repo', args:'{"command":"npm test"}' },
    context:'run tests', current: () => state.current };
  return { auto, state, req, deps, stream: (s: any) => { stream = s; } };
}
describe('等价类', () => {
  for (const tier of ['safe','grey','medium','high'] as const) for (const mode of ['off','safe','safe+grey']) {
    it(`${mode} / ${tier} follows decision table without automatic denial`, async () => {
      const s = setup(tier, mode); const r = await s.auto.decide(s.req);
      assert.equal(r.allow, mode !== 'off' && (tier === 'safe' || tier === 'grey' && mode === 'safe+grey'));
      assert.equal(s.state.calls, tier === 'grey' && mode === 'safe+grey' ? 1 : 0);
      if (tier === 'high' || mode === 'off' || mode === 'safe') assert.equal(s.state.presetCalls, 0);
    });
  }
  it('medium preset grants a rule identity; two prior user approvals grant without one', async () => {
    const s=setup('medium'); s.state.preset=true;
    const r=await s.auto.decide(s.req); assert.equal(r.allow,true); assert.deepEqual(r.rule,{tool:'bash',fingerprint:'bash:npm-test',workspace:'/repo'});
    s.state.preset=false; s.state.history.approvals=2;
    const h=await s.auto.decide(s.req); assert.equal(h.allow,true); assert.equal(h.rule,undefined);
  });
  it('model denial is relayed with its reason and never returned as rejected', async () => {
    const s=setup(); s.state.text='{"decision":"deny","confidence":1,"reason":"需要确认目标"}';
    assert.deepEqual(await s.auto.decide(s.req),{allow:false,tier:'grey',reason:'需要确认目标'});
  });
});
describe('边界值', () => {
  for (const confidence of [0.8999,0.9,1,1.01]) it(`confidence ${confidence}`, async () => {
    const s=setup(); s.state.text=JSON.stringify({decision:'allow',confidence,reason:''});
    assert.equal((await s.auto.decide(s.req)).allow,confidence>=0.9 && confidence<=1);
  });
  for (const approvals of [0,1,2,3]) it(`history approval count ${approvals}`,async () => {
    const s=setup('medium'); s.state.history.approvals=approvals;
    assert.equal((await s.auto.decide(s.req)).allow,approvals>=2);
    s.state.history.denials=1; assert.equal((await s.auto.decide(s.req)).allow,false);
  });
  it('high wins even if forged preset/history/model would allow',async () => {
    const s=setup('high'); s.state.preset=true; s.state.history.approvals=99;
    assert.equal((await s.auto.decide(s.req)).allow,false); assert.equal(s.state.presetCalls+s.state.historyCalls+s.state.calls,0);
  });
  it('oversized task data never truncates constraints for model inference', async () => {
    const s=setup(); s.req.context='a'.repeat(17000);
    assert.equal((await s.auto.decide(s.req)).allow,false); assert.equal(s.state.calls,0);
  });
});
describe('异常路径', () => {
  for (const text of ['garbage','```json {} ```','{}','{"decision":"allow","confidence":"1"}','{"decision":"allow","confidence":null}',
    '{"decision":"reject","confidence":1}','{"decision":"allow","confidence":1,"reason":{}}']) it(`invalid verdict ${text}`,async () => {
      const s=setup();s.state.text=text;assert.equal((await s.auto.decide(s.req)).allow,false);
    });
  it('timeout bounds a model that ignores abort',async () => {
    const s=setup();s.state.timeout=10;s.stream(()=>({[Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{})})}));
    assert.equal((await s.auto.decide(s.req)).allow,false);
  });
  it('timeout also bounds hung history and corrupt history cannot learn',async () => {
    const s=setup('medium');s.state.history.approvals=2;s.state.history.complete=false;
    assert.equal((await s.auto.decide(s.req)).allow,false);
    s.deps.history=()=>new Promise(()=>{});s.state.timeout=10;
    assert.equal((await s.auto.decide(s.req)).allow,false);
  });
  for (const mutate of ['off','dispose','stale','operation','high','abort']) it(`late answer ignored after ${mutate}`,async () => {
    const s=setup();const controller=new AbortController();const req={...s.req,signal:controller.signal};
    s.stream(async function*(){
      if(mutate==='off')s.state.mode='off'; if(mutate==='dispose')s.auto.dispose(); if(mutate==='stale')s.state.current=false;
      if(mutate==='operation')req.operation.command='rm -rf .'; if(mutate==='high')s.state.tier='high'; if(mutate==='abort')controller.abort();
      yield {type:'text-delta',text:s.state.text};yield {type:'finish',reason:{kind:'stop'}};
    });
    assert.equal((await s.auto.decide(req)).allow,false);
  });
  it('storage/config/model exceptions fall back',async () => {
    const s=setup('medium');s.deps.preset=async()=>{throw Error('broken')};assert.equal((await s.auto.decide(s.req)).allow,false);
    s.deps.config=()=>{throw Error('missing')};assert.equal((await s.auto.decide(s.req)).allow,false);
  });
});
