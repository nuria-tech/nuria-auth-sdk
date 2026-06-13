import { describe, expect, it } from 'vitest';
import {
  ImpersonationBanner,
  mountImpersonationBanner,
  useAuthSession,
} from '../src/vue';

describe('vue entrypoint', () => {
  it('exports Vue integration APIs', () => {
    expect(typeof useAuthSession).toBe('function');
    expect(ImpersonationBanner).toBeDefined();
    expect(typeof mountImpersonationBanner).toBe('function');
  });
});
