import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {Config,SettingsSchema} from '../src/index.ts';
import {mergeSettings} from '../src/settings.ts';
describe('等价类',()=>{
  for(const autoApprove of ['off','safe','safe+grey'])it(`accepts ${autoApprove}`,()=>{
    assert.equal((Config({autoApprove}) as any).autoApprove,autoApprove);
    assert.equal(mergeSettings(Config({}) as any,{autoApprove}).autoApprove,autoApprove);
  });
});
describe('边界值',()=>{
  it('defaults off in composition and optional settings page',()=>{
    assert.equal((Config({}) as any).autoApprove,'off');assert.equal((SettingsSchema({}) as any).autoApprove,'off');
  });
});
describe('异常路径',()=>{
  for(const value of ['all','safe+high',true,1,null])it(`invalid setting ${value} never enables approval`,()=>{
    assert.equal(mergeSettings(Config({}) as any,{autoApprove:value}).autoApprove,'off');
  });
});
