import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { AutoApprovalState } from '../src/auto-approval-state.ts';
const rule={fingerprint:'bash:npm-install',tool:'bash',workspace:'/repo'};
const entry={session:'worker',title:'hammer',tool:'bash',command:'npm install',tier:'medium' as const,rule};
describe('等价类',()=>{
  it('retains recent approvals and exact revocation removes only rule affordances',()=>{
    const state=new AutoApprovalState(()=>1000);state.add(entry);state.add({...entry,rule:{...rule,workspace:'/else'}});
    assert.equal(state.list().length,2);state.revoke(rule);
    assert.ok(state.list()[0].rule);assert.equal(state.list()[1].rule,undefined);
    assert.equal(state.list()[1].at,1000);assert.equal(state.list()[1].title,'hammer');
  });
});
describe('边界值',()=>{
  it('caps newest first at five and isolates returned state',()=>{
    const state=new AutoApprovalState();for(let i=0;i<6;i++)state.add({...entry,title:String(i)});
    const list=state.list();assert.deepEqual(list.map(x=>x.title),['5','4','3','2','1']);
    list[0].rule!.workspace='changed';assert.equal(state.list()[0].rule!.workspace,'/repo');
  });
});
describe('异常路径',()=>{
  it('high tier can never be published as automatically approved',()=>{
    const state=new AutoApprovalState();assert.throws(()=>state.add({...entry,tier:'high' as any}));assert.deepEqual(state.list(),[]);
  });
});
