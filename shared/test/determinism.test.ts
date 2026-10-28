import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { DEFAULT_PARAMS, buildGolden, checkGolden, type Golden } from '../src';

const goldenPath = fileURLToPath(new URL('../golden/determinism.json', import.meta.url));

test('golden determinism suite', () => {
  if (!existsSync(goldenPath)) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, JSON.stringify(buildGolden(DEFAULT_PARAMS), null, 2) + '\n');
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden;
  expect(golden.params, 'golden file is stale: run `npm run golden`').toEqual(DEFAULT_PARAMS);
  for (const r of checkGolden(golden)) expect(r.actual, r.name).toBe(r.expected);
});

test('outcomes in the suite are varied', () => {
  const outcomes = new Set(buildGolden(DEFAULT_PARAMS).cases.map((c) => c.outcome));
  expect(outcomes.size).toBeGreaterThanOrEqual(3);
});
