import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { approvalFileName, renderApprovalHtml, type ApprovalRecord } from './approvals.ts';

/** Publish a complete file without overwriting an existing approval, even across writers. */
export async function writeApproval(directory: string, record: ApprovalRecord,
  onError?: (error: unknown) => void): Promise<string | undefined> {
  let temporary: string | undefined;
  try {
    const name = approvalFileName(record.fingerprint, record.ts);
    const html = renderApprovalHtml(record);
    await mkdir(directory, { recursive: true });
    temporary = join(directory, `.approval-${randomUUID()}.tmp`);
    await writeFile(temporary, html, { flag: 'wx', mode: 0o600 });
    for (let number = 1; ; number++) {
      const path = join(directory, number === 1 ? name : name.replace(/\.html$/, `-${number}.html`));
      try {
        // rename can overwrite; link atomically publishes the finished file only if absent.
        await link(temporary, path);
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  } catch (error) {
    try { onError?.(error); } catch { /* Logging must never change an approval outcome. */ }
    return undefined;
  } finally {
    if (temporary) {
      try { await unlink(temporary); } catch { /* Best-effort cleanup of this writer's temporary file. */ }
    }
  }
}
