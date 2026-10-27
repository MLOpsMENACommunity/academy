import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTOMATION_RULE_TYPES, AUTOMATION_RULES, automationParams, automationRule, automationRuleSchema } from '@academy/shared';
import { quietUntil } from './automation.service';
import { RULES, weekIndex } from './engine';

describe('automation rules', () => {
  it('has an evaluator for every rule in the catalog, and nothing else', () => {
    expect(Object.keys(RULES).sort()).toEqual([...AUTOMATION_RULE_TYPES].sort());
    expect(new Set(AUTOMATION_RULE_TYPES).size).toBe(AUTOMATION_RULES.length);
  });

  /** The promise to the team: rules nudge, alert, reward and flag; they never remove anyone. */
  it('never changes an application, removes an enrolment or deletes anything', () => {
    const dir = __dirname;
    const code = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    for (const forbidden of [/\.transition\(/, /application\.update/, /enrollment\.(delete|update)/, /\.delete(Many)?\(/, /status:\s*'(REJECTED|WITHDRAWN)'/]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it('falls back to defaults for missing or out-of-range settings', () => {
    const def = automationRule('PAYMENT_REMINDER')!;
    expect(automationParams(def, { firstDays: 99, secondDays: 'x' })).toEqual({ firstDays: 3, secondDays: 7 });
    expect(automationParams(automationRule('CERT_ELIGIBLE')!, { mode: 'issue' })).toEqual({ mode: 'issue' });
    expect(automationRuleSchema(automationRule('COMMUNITY_LINKS')!).safeParse({ enabled: true, params: { telegramUrl: 'http://x' } }).success).toBe(false);
  });

  it('holds emails from 22:00 to 08:00 Cairo time', () => {
    expect(quietUntil(new Date('2026-11-10T10:00:00Z'))).toBeNull(); // 12:00 Cairo
    expect(quietUntil(new Date('2026-11-10T21:00:00Z'))?.toISOString()).toBe('2026-11-11T06:00:00.000Z'); // 23:00 → 08:00
    expect(quietUntil(new Date('2026-11-11T03:30:00Z'))?.toISOString()).toBe('2026-11-11T06:00:00.000Z'); // 05:30 → 08:00
  });

  it('numbers weeks from Monday', () => {
    const monday = Date.parse('2026-11-09T00:00:00Z');
    expect(weekIndex(monday)).toBe(weekIndex(monday + 6 * 86_400_000 + 3_599_000));
    expect(weekIndex(monday) - weekIndex(monday - 1)).toBe(1);
  });
});
