import { describe, expect, it } from 'vitest';
import { SAVE_SCHEMA_VERSION } from './index.js';

describe('@lifesim/shared', () => {
  it('exports save schema version >= 1', () => {
    expect(SAVE_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });
});
