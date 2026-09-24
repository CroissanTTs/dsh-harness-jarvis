/** Editable DSH settings. Storage paths and agent identity stay composition-owned. */
export interface JarvisSettings {
  provider: string;
  model: string;
  edgeVoice: string;
  greetings: string[];
  judgeEnabled: boolean;
  askInterception: boolean;
  judgeProvider: string;
  judgeModel: string;
  judgeTimeoutMs: number;
  maxContinueRounds: number;
}

export const SETTINGS_LIMITS = { minTimeout: 1000, maxTimeout: 120000, maxRounds: 10 } as const;

/** Resolve a full snapshot against the immutable composition base, never the previous update. */
export function mergeSettings(base: JarvisSettings, source: unknown): JarvisSettings {
  const raw = source && typeof source === 'object' && !Array.isArray(source) ? source as Record<string, unknown> : {};
  const text = (key: 'provider' | 'model' | 'edgeVoice' | 'judgeProvider' | 'judgeModel', blank = false): string => {
    const value = raw[key];
    return typeof value === 'string' && (blank || value.trim()) ? value.trim() : base[key];
  };
  const integer = (key: 'judgeTimeoutMs' | 'maxContinueRounds', min: number, max: number): number => {
    const value = raw[key];
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : base[key];
  };
  const greetings = Array.isArray(raw.greetings) && raw.greetings.every(value => typeof value === 'string')
    ? raw.greetings as string[] : base.greetings;
  return {
    provider: text('provider'), model: text('model'), edgeVoice: text('edgeVoice'),
    greetings: greetings.map(value => value.trim()).filter(Boolean),
    judgeEnabled: typeof raw.judgeEnabled === 'boolean' ? raw.judgeEnabled : base.judgeEnabled,
    askInterception: typeof raw.askInterception === 'boolean' ? raw.askInterception : base.askInterception,
    judgeProvider: text('judgeProvider', true), judgeModel: text('judgeModel', true),
    judgeTimeoutMs: integer('judgeTimeoutMs', SETTINGS_LIMITS.minTimeout, SETTINGS_LIMITS.maxTimeout),
    maxContinueRounds: integer('maxContinueRounds', 0, SETTINGS_LIMITS.maxRounds),
  };
}
