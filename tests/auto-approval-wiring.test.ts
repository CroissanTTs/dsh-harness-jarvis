import { beforeEach,afterEach,describe,it,mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync,readdirSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { apply } from '../src/index.ts';
import { LiveState,PENDING_GRACE_MS } from '../src/live-state.ts';
import { TaskLedger } from '../src/tasks.ts';
import { AutoApproval } from '../src/auto-approval.ts';
import { ApprovalPresets } from '../src/approval-presets.ts';
import { MemoryStore } from '../src/memory/store.ts';
import { writeApproval } from '../src/approval-store.ts';
import { fingerprint } from '../src/approvals.ts';
let root:string,dispose:(()=>void)|void,handler:any,events:Map<string,any>,hooks:any,values:any,services:any,held:LiveState;
let command:string,now:number,calls:number,nextCalls:number,spoken:string[],verdict:string,model:any,userText:string,userId:string;
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'jv-auto-wiring-'));events=new Map();values={};command='git status';now=Date.now();calls=0;nextCalls=0;spoken=[];
  held=undefined as any;
  userText='请检查并修复此项目';userId='user-1';
  verdict='{"decision":"allow","confidence":0.95,"reason":"符合任务"}';
  mock.method(Date,'now',()=>now);
  mock.method(childProcess,'spawn',()=>Object.assign(new EventEmitter(),{unref(){},kill(){},killed:false}));syncBuiltinESMExports();
  mock.method(globalThis,'fetch',async(url:any,init:any)=>{
    if(String(url).endsWith('/voice-mini/test'))spoken.push(JSON.parse(init.body).text);
    return {ok:true,status:200,json:async()=>({})} as Response;
  });
  model=async function*(){calls++;yield{type:'text-delta',text:verdict};yield{type:'finish',reason:{kind:'stop'}};};
  const hold=LiveState.prototype.holdApproval;
  mock.method(LiveState.prototype,'holdApproval',function(this:LiveState,...args:any[]){held=this;return (hold as any).apply(this,args);});
  services={sessions:{get:()=>({header:{cwd:root}})},llm:{stream:(r:any)=>model(r)},
    settings:{installSection(_o:any,_n:any,_s:any,base:any,h:any){hooks=h;h.setSource(()=>({...base,...values}));h.onChange();}},
    webServer:{port:43210,register:(r:any)=>{handler=r.handler;}},
    'voice-mini':{speakExternal:async(text:string)=>{spoken.push(text);return true;}}};
  const ctx:any={get:(n:string)=>services[n],provide(){},on:(n:string,c:any)=>events.set(n,c),
    inject:(ns:string[],cb:any)=>{if(ns.every(n=>n in services))cb(ctx);}};
  dispose=apply(ctx,{jarvisSessionId:'jarvis-auto-test',memoryRoot:root,audioDir:root,lockFile:join(root,'lock.json'),
    approvalsDir:join(root,'memory/approvals'),managedFile:join(root,'managed.json'),tasksFile:join(root,'tasks.json'),runtimeFile:join(root,'runtime.json'),judgeTimeoutMs:1000});
});
afterEach(async()=>{dispose?.();await new Promise(r=>setTimeout(r,35));mock.restoreAll();syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});});
const enable=(autoApprove='safe+grey')=>{values={autoApprove};hooks.onChange();};
function approve(next:()=>Promise<any>=async()=>{nextCalls++;return 'rejected';},signal?:AbortSignal){
  return events.get('approval/request')({toolName:'bash',callId:'call',signal,agent:{id:'worker',session:{deriveMessages:()=>[
    {id:userId,role:'user',content:[{type:'text',text:userText}]},
    {role:'assistant',content:[{type:'toolCall',id:'call',arguments:{command}}]},
  ]}}},next);
}
async function request(path:string,body?:unknown){
  const token=JSON.parse(readFileSync(join(root,'runtime.json'),'utf8')).token;
  const req=Object.assign(new EventEmitter(),{method:body?'POST':'GET',url:'/jarvis'+path,socket:{remoteAddress:'127.0.0.1'},headers:{authorization:`Bearer ${token}`}});
  let output='';const res:any={statusCode:200,writeHead(n:number){this.statusCode=n;},end(s:string){output=s;}};
  const pending=handler(req,res);if(body){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}await pending;
  return{status:res.statusCode,body:JSON.parse(output||'{}')};
}
async function records(){for(let i=0;i<100;i++){
  const dir=join(root,'memory/approvals');if(existsSync(dir)){const files=readdirSync(dir).filter(n=>n.endsWith('.html'));if(files.length)return files.map(n=>readFileSync(join(dir,n),'utf8'));}
  await new Promise(r=>setTimeout(r,3));}assert.fail('record missing');}
describe('等价类',()=>{
  it('default off uses human relay and user record',async()=>{assert.equal(await approve(),'rejected');assert.equal(nextCalls,1);assert.match((await records())[0],/source="user"/);});
  it('safe mode bypasses relay, records jarvis+tier after return and stays silent',async()=>{
    enable('safe');assert.equal(await approve(),'allowed-once');assert.equal(nextCalls,0);assert.equal(existsSync(join(root,'memory/approvals')),false);
    assert.match((await records())[0],/source="jarvis"/);assert.match((await records())[0],/tier value="safe"/);
    assert.equal(calls,0);assert.equal(spoken.length,0);assert.equal((await request('/state')).body.autoApprovals[0].tier,'safe');
  });
  it('medium preset approves and revoke clears matching recent affordance',async()=>{
    enable();command='npm install';const presets=new ApprovalPresets(new MemoryStore({rootDir:root}));
    const rule=await presets.add({tool:'bash',command,workspace:root,args:JSON.stringify({command})});
    assert.equal(await approve(),'allowed-once');await records();
    assert.equal((await request('/state')).body.autoApprovals[0].rule.fingerprint,rule.fingerprint);
    assert.equal((await request('/approval-rules/remove',rule)).status,204);
    assert.equal((await request('/state')).body.autoApprovals[0].rule,undefined);
    assert.equal(await approve(),'rejected');
  });
  it('medium learns two user approvals, never its own approvals',async()=>{
    enable();command='npm install';const store=new MemoryStore({rootDir:root});
    for(let i=0;i<2;i++)await writeApproval(store,{fingerprint:fingerprint('bash',command),ts:new Date(now).toISOString(),
      session:{id:'worker',cwd:root,managed:false},operation:{tool:'bash',command,args:JSON.stringify({command})},context:'',
      decision:{allow:true,source:'user',reason:''},tier:{value:'',notes:''}});
    assert.equal(await approve(),'allowed-once');assert.equal(calls,0);
  });
  it('grey npm test uses the model, records its reason and speaks exactly once',async()=>{
    enable();command='npm test';await request('/voice',{action:'unmute'});
    assert.equal(await approve(),'allowed-once');assert.equal(calls,1);assert.equal(nextCalls,0);
    const html=(await records())[0];await flush();
    assert.match(html,/source="jarvis" reason="符合任务"/);assert.match(html,/tier value="grey"/);
    assert.deepEqual(spoken,['替 worker 批准了 npm test']);
  });
});
describe('边界值',()=>{
  it('live setting off takes effect on the next request',async()=>{enable('safe');assert.equal(await approve(),'allowed-once');enable('off');assert.equal(await approve(),'rejected');});
  it('latest five approvals are visible and carry no preset rule for safe decisions',async()=>{
    enable('safe');for(let i=0;i<6;i++)assert.equal(await approve(),'allowed-once');await flush();
    const recent=(await request('/state')).body.autoApprovals;assert.equal(recent.length,5);assert.ok(recent.every((r:any)=>r.rule===undefined));
  });
});
describe('异常路径',()=>{
  it('high ignores a forged preset match and never asks model',async()=>{
    enable();command='rm -rf .';mock.method(ApprovalPresets.prototype,'matches',async()=>true);
    assert.equal(await approve(),'rejected');assert.equal(nextCalls,1);assert.equal(calls,0);
  });
  it('model denial forwards reason to original relay without changing its outcome',async()=>{
    enable();command='date';verdict='{"decision":"deny","confidence":1,"reason":"需要核对目标"}';
    const done=approve(()=>new Promise(()=>{}));
    for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,2));now+=PENDING_GRACE_MS;
    const card=held.pending()[0];assert.match(card.note!,/需要核对目标/);held.answer({id:card.id,decision:'allow'});assert.equal(await done,'allowed-once');
    assert.match((await records())[0],/source="user"/);
  });
  it('late model result after disabling is not allowed',async()=>{
    enable();command='date';model=async function*(){enable('off');yield{type:'text-delta',text:verdict};yield{type:'finish',reason:{kind:'stop'}};};
    assert.equal(await approve(),'rejected');
  });
  it('a changed operation cannot use an earlier safe decision',async()=>{
    enable('safe');const decide=AutoApproval.prototype.decide;
    mock.method(AutoApproval.prototype,'decide',async function(this:AutoApproval,...args:any[]){const r=await(decide as any).apply(this,args);command='rm -rf .';return r;});
    assert.equal(await approve(),'rejected');
  });
  it('changed user instruction invalidates allowance even with an unchanged ledger task',async()=>{
    mock.method(TaskLedger.prototype,'peekCurrent',()=>({id:'task-1',request:'运行检查'}) as any);
    enable();command='date';model=async function*(){userText='停止，先不要执行';yield{type:'text-delta',text:verdict};yield{type:'finish',reason:{kind:'stop'}};};
    assert.equal(await approve(),'rejected');
  });
  it('a new user message identity invalidates allowance even when text is identical',async()=>{
    enable();command='date';model=async function*(){userId='user-2';yield{type:'text-delta',text:verdict};yield{type:'finish',reason:{kind:'stop'}};};
    assert.equal(await approve(),'rejected');
  });
  it('changed fallback user context invalidates an in-flight grey model allowance',async()=>{
    enable();command='date';model=async function*(){userText='停止，先不要执行';yield{type:'text-delta',text:verdict};yield{type:'finish',reason:{kind:'stop'}};};
    assert.equal(await approve(),'rejected');
  });
});
