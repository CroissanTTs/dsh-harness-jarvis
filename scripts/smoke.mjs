#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pass = () => ({ passed: true });
const fail = (reason) => ({ passed: false, reason });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = 'DSH 没运行或插件未加载（也可能运行信息已过期或请求超时）';

// Reasons never include values from runtime files, server responses or exceptions.
export function checkStatus(response, expected) {
  return response?.status === expected ? pass() : fail('HTTP 状态不符合预期');
}

export function checkState(response) {
  if (!checkStatus(response, 200).passed) return fail('state HTTP 状态不符合预期');
  const body = response.body;
  if (!object(body) || !Array.isArray(body.sessions) || !object(body.voice) || !Array.isArray(body.pending)) {
    return fail('state 缺少 sessions 数组、voice 对象或 pending 数组');
  }
  if (!body.sessions.every((row) => object(row) && typeof row.id === 'string' && row.id.trim() &&
    typeof row.title === 'string' && typeof row.status === 'string' && row.status.trim() && typeof row.managed === 'boolean')) {
    return fail('session 行缺少有效的 id/title/status/managed');
  }
  return pass();
}

export function checkWait(response, elapsedMs) {
  if (!checkStatus(response, 200).passed) return fail('wait HTTP 状态不符合预期');
  if (!Number.isSafeInteger(response.body?.version) || response.body.version < 0) return fail('wait version 无效');
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 1500) return fail('wait 未在 1.5 秒内返回');
  return pass();
}

export function checkMessages(response) {
  if (!checkStatus(response, 200).passed) return fail('messages HTTP 状态不符合预期');
  const body = response.body;
  if (!object(body) || !Array.isArray(body.messages)) return fail('messages 字段不是数组');
  // The no-session response has an empty messages array but no count.
  if ('count' in body && body.count !== body.messages.length) return fail('messages count 与数组长度不符');
  return pass();
}

export function checkManagedState(response, session, managed) {
  const valid = checkState(response);
  if (!valid.passed) return valid;
  const row = response.body.sessions.find((item) => item.id === session);
  return row?.managed === managed ? pass() : fail('托管状态确认失败');
}

export function checkRuntime(runtime) {
  if (!object(runtime) || typeof runtime.origin !== 'string' || typeof runtime.token !== 'string' ||
    !runtime.token.trim() || /[\r\n]/.test(runtime.token)) return fail('runtime.json 配置无效');
  try {
    const origin = new URL(runtime.origin);
    if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) ||
      origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      return fail('runtime.json 必须使用无凭据的本机 HTTP origin');
    }
  } catch { return fail('runtime.json origin 无效'); }
  const header = runtime.rendererHeader;
  if (header !== undefined && (!object(header) || typeof header.name !== 'string' ||
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name) ||
    ['authorization', 'host', 'content-type'].includes(header.name.toLowerCase()) ||
    typeof header.value !== 'string' || !header.value || /[\r\n]/.test(header.value))) {
    return fail('runtime.json rendererHeader 无效');
  }
  return pass();
}

export async function runManagedRoundTrip(request) {
  let initial;
  try { initial = await request('/jarvis/state'); }
  catch { return fail(unavailable); }
  const valid = checkState(initial);
  if (!valid.passed) return valid;
  const candidate = initial.body.sessions.find((row) => !row.managed);
  if (!candidate) return { passed: true, skipped: true, reason: '没有未托管的可见会话，跳过写检查' };

  let result = pass();
  // Enter finally BEFORE sending: the server may apply a request whose response is lost.
  try {
    const added = await request('/jarvis/managed', { method: 'POST', body: { session: candidate.id, managed: true } });
    result = checkStatus(added, 200);
    if (result.passed) result = checkManagedState(await request('/jarvis/state'), candidate.id, true);
  } catch { result = fail('托管写入或确认失败'); }
  finally {
    let restored = false;
    try {
      const removed = await request('/jarvis/managed', { method: 'POST', body: { session: candidate.id, managed: false }, restoring: true });
      restored = checkStatus(removed, 200).passed;
    } catch { /* Still read state below, even if the rollback response is lost. */ }
    try {
      restored = checkManagedState(await request('/jarvis/state', { restoring: true }), candidate.id, false).passed && restored;
    } catch { restored = false; }
    if (!restored) result = fail('恢复原托管状态失败或无法确认；请在面板检查托管列表');
  }
  return result;
}

function makeRequest(runtime, cancellation) {
  const headers = { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' };
  if (runtime.rendererHeader) headers[runtime.rendererHeader.name] = runtime.rendererHeader.value;
  return async (path, { method = 'GET', body, timeoutMs = 5000, restoring = false } = {}) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const timer = setTimeout(cancel, timeoutMs);
    if (!restoring) {
      cancellation.addEventListener('abort', cancel, { once: true });
      if (cancellation.aborted) cancel();
    }
    try {
      const response = await fetch(new URL(path, runtime.origin), {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, redirect: 'error',
      });
      // Error bodies may contain credentials or arbitrary host details; discard them.
      if (response.status !== 200) {
        await response.body?.cancel();
        return { status: response.status };
      }
      return { status: response.status, body: await response.json() };
    } finally {
      clearTimeout(timer);
      cancellation.removeEventListener('abort', cancel);
    }
  };
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--write')) {
    console.log('✗ 参数 (0 ms)：用法 npm run smoke [-- --write]');
    return 1;
  }
  let failed = false;
  const step = async (label, check) => {
    const start = performance.now();
    let result;
    try { result = await check(start); }
    catch { result = fail(unavailable); }
    if (!result.passed) failed = true;
    console.log(`${result.passed ? '✓' : '✗'} ${label} (${Math.round(performance.now() - start)} ms)${result.reason ? `：${result.reason}` : ''}`);
    return result;
  };
  let runtime;
  const loaded = await step('runtime.json', async () => {
    try { runtime = JSON.parse(await readFile(join(homedir(), '.dsh/jarvis/runtime.json'), 'utf8')); }
    catch { return fail(unavailable); }
    return checkRuntime(runtime);
  });
  if (!loaded.passed) return 1;

  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    const request = makeRequest(runtime, cancellation.signal);
    await step('GET /jarvis/state', async () => checkState(await request('/jarvis/state')));
    let version;
    const versionResult = await step('GET /jarvis/wait 获取版本', async (start) => {
      const response = await request('/jarvis/wait?since=-1&timeout=1', { timeoutMs: 1500 });
      const result = checkWait(response, performance.now() - start);
      if (result.passed) version = response.body.version;
      return result;
    });
    await step('GET /jarvis/wait 短轮询', async (start) => {
      if (!versionResult.passed) return fail('无法获取当前 version');
      return checkWait(await request(`/jarvis/wait?since=${version}&timeout=1`, { timeoutMs: 1500 }), performance.now() - start);
    });
    await step('GET /jarvis/messages', async () => checkMessages(await request('/jarvis/messages')));
    await step('GET /jarvis/messages 未知会话 → 404', async () => checkStatus(await request('/jarvis/messages?session=__nope__'), 404));
    await step('POST /jarvis/managed 缺少参数 → 400', async () => checkStatus(await request('/jarvis/managed', { method: 'POST', body: {} }), 400));
    if (process.argv.includes('--write')) {
      await step('POST /jarvis/managed 托管并恢复', () => failed || cancellation.signal.aborted
        ? fail('前置检查失败，跳过写检查') : runManagedRoundTrip(request));
    }
    if (cancellation.signal.aborted) failed = true;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.log('✗ 冒烟检查 (0 ms)：检查未能完成；DSH 没运行或插件未加载');
    process.exitCode = 1;
  });
}
