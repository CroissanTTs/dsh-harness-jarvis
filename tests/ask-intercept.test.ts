import { beforeEach, afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AskInterceptor, parseChoice } from '../src/ask-intercept.ts';
let interceptor: AskInterceptor, enabled: boolean, managed: boolean, original: string, response: string;
let calls: any[], accepted: any[], forwards: number, recall: (session: string, query: string) => Promise<string>, llm: any;
const fallback = async () => { forwards++; return { answers: [{ id: 'human', selected: ['用户'] }] }; };
const req = (questions: any[] = [{ id: 'q', question: '用哪种缩进？', options: [{ label: '两空格' }, { label: '四空格' }] }]): any => ({ agent: { id: 'worker' }, questions });
beforeEach(() => {
  enabled = true; managed = true; original = '按现有项目风格'; response = '{"choice":"两空格","confidence":0.9}';
  calls = []; accepted = []; forwards = 0; recall = async () => '项目使用两空格';
  llm = { async *stream(options: any) { calls.push(options); yield { type: 'text-delta', text: response }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
  interceptor = new AskInterceptor({ config: () => ({ askInterception: enabled, provider: 'base', model: 'model', judgeProvider: '', judgeModel: '', judgeTimeoutMs: 1000 }),
    managed: () => managed, task: () => ({ id: 'task', request: original }), llm: () => llm,
    recall: (session, query) => recall(session, query), accepted: (...args) => { accepted.push(args); } });
});
afterEach(() => { interceptor.dispose(); mock.timers.reset(); });
describe('等价类', () => {
  it('returns exact host answer and passes request, choices, task and memory to oneShot', async () => {
    assert.deepEqual(await interceptor.answer(req(), fallback), { answers: [{ id: 'q', selected: ['两空格'] }] });
    assert.equal(forwards, 0); assert.equal(accepted.length, 1);
    const prompt = calls[0].messages[0].content[0].text;
    for (const text of ['用哪种缩进', '四空格', original, '项目使用两空格']) assert.ok(prompt.includes(text));
    assert.equal(calls[0].purpose, 'jarvis-ask-intercept');
    assert.match(calls[0].system, /低风险/); assert.match(calls[0].system, /不可信/);
  });
  it('answers all questions only after all choices are validated', async () => {
    const question = req().questions[0];
    const result = await interceptor.answer(req([question, { ...question, id: 'q2' }]), fallback);
    assert.equal(result.answers.length, 2); assert.equal(accepted.length, 2); assert.equal(calls.length, 2);
  });
  it('does not call model or recall while disabled or unmanaged', async () => {
    recall = async () => { throw Error('must not run'); }; enabled = false;
    await interceptor.answer(req(), fallback); enabled = true; managed = false;
    await interceptor.answer(req(), fallback); assert.equal(forwards, 2); assert.equal(calls.length, 0);
  });
});
describe('边界值', () => {
  for (const confidence of [0.849999, 0.85, 1, 1.0001, -1]) it(`confidence ${confidence}`, async () => {
    response = JSON.stringify({ choice: '两空格', confidence }); await interceptor.answer(req(), fallback);
    assert.equal(forwards, confidence >= 0.85 && confidence <= 1 ? 0 : 1);
  });
  it('retains whitespace in exact option labels and rejects near matches', () => {
    assert.equal(parseChoice('{"choice":" A ","confidence":0.85}', [' A '])?.choice, ' A ');
    assert.equal(parseChoice('{"choice":"A","confidence":1}', [' A ']), null);
  });
  it('falls back the entire batch if a later question is uncertain, with no partial side effects', async () => {
    const q = req().questions[0]; let i = 0;
    llm.stream = async function* () { yield { type: 'text-delta', text: ++i === 1 ? response : '{"choice":null,"confidence":0}' }; yield { type: 'finish', reason: { kind: 'stop' } }; };
    await interceptor.answer(req([q, { ...q, id: 'q2' }]), fallback); assert.equal(forwards, 1); assert.equal(accepted.length, 0);
  });
});
describe('异常路径', () => {
  for (const invalid of ['oops', '{}', '[]', '{"choice":"两空格","confidence":"1"}', '{"choice":"不存在","confidence":1}', '{"choice":null,"confidence":1}', '```json\n{"choice":"两空格","confidence":1}\n```']) it(`rejects ${invalid}`, async () => {
    response = invalid; await interceptor.answer(req(), fallback); assert.equal(forwards, 1); assert.equal(accepted.length, 0);
  });
  for (const question of [ { id: 'q', question: '开放题' }, { ...req().questions[0], intent: { kind: 'approval', approve: '两空格' } },
    { ...req().questions[0], options: [{ label: '同名' }, { label: '同名' }] }, { ...req().questions[0], options: [{ label: 3 }] } ]) it('forwards open, intentional approval or malformed options without consulting a model', async () => {
    await interceptor.answer(req([question]), fallback); assert.equal(forwards, 1); assert.equal(calls.length, 0);
  });
  it('falls back with no llm or a failed memory lookup', async () => {
    llm = undefined; await interceptor.answer(req(), fallback); assert.equal(forwards, 1);
    llm = { stream() { throw Error('bad llm'); } }; recall = async () => { throw Error('disk unavailable'); };
    await interceptor.answer(req(), fallback); assert.equal(forwards, 2);
  });
  it('bounds stalled memory lookup as well as model work', async () => {
    mock.timers.enable({ apis: ['setTimeout'] }); recall = () => new Promise(() => {});
    const pending = interceptor.answer(req(), fallback); mock.timers.tick(1000);
    await pending; assert.equal(forwards, 1); assert.equal(accepted.length, 0);
  });
  it('bounds a model that ignores abort and never yields', async () => {
    mock.timers.enable({ apis: ['setTimeout'] }); llm = { async *stream() { await new Promise(() => {}); } };
    const pending = interceptor.answer(req(), fallback); await Promise.resolve(); await Promise.resolve(); mock.timers.tick(1000);
    await pending; assert.equal(forwards, 1);
  });
  for (const change of ['disabled','unmanaged','new-task','aborted','disposed']) it(`does not apply stale answer after ${change}`, async () => {
    let done!: (v: string) => void; recall = () => new Promise(resolve => { done = resolve; });
    const controller = new AbortController(); const r = { ...req(), signal: controller.signal };
    const pending = interceptor.answer(r, fallback);
    if (change === 'disabled') enabled = false;
    if (change === 'unmanaged') managed = false;
    if (change === 'new-task') original = '新的需求';
    if (change === 'aborted') controller.abort();
    if (change === 'disposed') interceptor.dispose();
    done('旧记忆'); await pending; assert.equal(forwards, 1); assert.equal(accepted.length, 0);
  });
  it('forwards if the final task freshness check throws after an otherwise valid model answer', async () => {
    let reads = 0;
    interceptor = new AskInterceptor({ config: () => ({ askInterception: true, provider: 'p', model: 'm', judgeProvider: '', judgeModel: '', judgeTimeoutMs: 1000 }),
      managed: () => true, task: () => { if (++reads === 4) throw Error('final read failed'); return { id: 'task', request: 'original' }; },
      llm: () => llm, recall: async () => '', accepted: answer => { accepted.push(answer); } });
    await interceptor.answer(req(), fallback); assert.equal(forwards, 1); assert.equal(accepted.length, 0);
  });
  it('forwards oversized complete context without truncating task constraints or calling the model', async () => {
    original = 'x'.repeat(16001); await interceptor.answer(req(), fallback);
    assert.equal(forwards, 1); assert.equal(calls.length, 0);
  });
  it('reporting failures cannot replace an accepted answer with a user prompt', async () => {
    interceptor = new AskInterceptor({ config: () => ({ askInterception: true, provider: 'p', model: 'm', judgeProvider: '', judgeModel: '', judgeTimeoutMs: 1000 }),
      managed: () => true, task: () => undefined, llm: () => llm, recall: async () => '', accepted: () => { throw Error('report failed'); } });
    assert.equal((await interceptor.answer(req(), fallback)).answers[0].selected[0], '两空格'); assert.equal(forwards, 0);
  });
});
