import { describe, expect, it } from 'vitest';
import { useAuthSession } from '../src/vue';

describe('vue entrypoint', () => {
  it('exports Vue integration APIs', () => {
    expect(typeof useAuthSession).toBe('function');
  });
});
