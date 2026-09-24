import type { MemoryStore } from './memory/store.ts';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { canPresetApproval, type PresetOperation } from './approval-risk.ts';
import { fingerprint } from './approvals.ts';
import { atomicWrite } from './memory/journal.ts';
export interface ApprovalRule { fingerprint: string; tool: string; workspace: string; createdAt: number; expiresAt?: number }
export type ApprovalRuleKey = Pick<ApprovalRule, 'fingerprint' | 'tool' | 'workspace'>;
export function validRuleKey(value: unknown): value is ApprovalRuleKey {
  const key = value as ApprovalRuleKey | null;
  return !!key && typeof key.tool === 'string' && !!key.tool.trim() &&
    typeof key.fingerprint === 'string' && !!key.fingerprint.trim() &&
    typeof key.workspace === 'string' && isAbsolute(key.workspace) && !key.workspace.includes('\0');
}
const same = (a: ApprovalRuleKey, b: ApprovalRuleKey) => a.tool === b.tool && a.workspace === b.workspace && a.fingerprint === b.fingerprint;
const timestamp = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export class ApprovalPresets {
  private store: MemoryStore;
  private now: () => number;
  constructor(store: MemoryStore, now = Date.now) { this.store = store; this.now = now; }

  private async read(directory: string, create = false): Promise<ApprovalRule[]> {
    // MemoryStore raw-lock callbacks own descendant validation and I/O.
    const root = this.store.rootDir;
    const parts = relative(root, directory).split(sep);
    for (let i = 0; i <= parts.length; i++) {
      const path = join(root, ...parts.slice(0, i));
      if (create) await mkdir(path, { recursive: i === 0, mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      try {
        const stat = await lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid preferences directory');
      } catch (error) { if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    }
    const file = join(directory, 'approvals.json');
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid approval rules file');
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(raw) || !raw.every(rule => rule && timestamp(rule.createdAt) &&
        (rule.expiresAt === undefined || timestamp(rule.expiresAt)) && validRuleKey(rule))) throw Error('Invalid approval rules');
      return raw;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async list(): Promise<ApprovalRule[]> {
    return this.store.withReadLock('preferences', async directory =>
      (await this.read(directory)).filter(rule => rule.expiresAt === undefined || rule.expiresAt > this.now()));
  }
  async add(operation: PresetOperation & { expiresAt?: number }): Promise<ApprovalRule> {
    // Validate again inside the lock in case a target path changed while queued.
    return this.store.withWriteLock('preferences', async directory => {
      if (!canPresetApproval(operation)) throw Error('Operation cannot have an approval preset');
      const now = this.now();
      if (operation.expiresAt !== undefined && (!timestamp(operation.expiresAt) || operation.expiresAt <= now)) throw Error('Invalid preset expiry');
      const rules = await this.read(directory, true);
      const rule: ApprovalRule = { fingerprint: fingerprint(operation.tool, operation.command), tool: operation.tool,
        workspace: operation.workspace, createdAt: now, ...(operation.expiresAt !== undefined ? { expiresAt: operation.expiresAt } : {}) };
      await atomicWrite(join(directory, 'approvals.json'), JSON.stringify([...rules.filter(r => !same(r, rule)), rule], null, 2) + '\n');
      return rule;
    });
  }
  async remove(key: ApprovalRuleKey): Promise<boolean> {
    if (!validRuleKey(key)) throw Error('Invalid approval rule key');
    return this.store.withWriteLock('preferences', async directory => {
      const rules = await this.read(directory);
      const rest = rules.filter(rule => !same(rule, key));
      if (rest.length === rules.length) return false;
      await atomicWrite(join(directory, 'approvals.json'), JSON.stringify(rest, null, 2) + '\n');
      return true;
    });
  }
  async matches(operation: PresetOperation): Promise<boolean> {
    try {
      if (!canPresetApproval(operation)) return false;
      const key = { ...operation, fingerprint: fingerprint(operation.tool, operation.command) };
      return (await this.list()).some(rule => same(rule, key));
    } catch { return false; }
  }
}
