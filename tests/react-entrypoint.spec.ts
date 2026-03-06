import { describe, expect, it } from 'vitest';
import { AuthProvider, useAuth, useAuthSession } from '../src/react';

describe('react entrypoint', () => {
  it('exports React integration APIs', () => {
    expect(typeof useAuthSession).toBe('function');
    expect(typeof AuthProvider).toBe('function');
    expect(typeof useAuth).toBe('function');
  });
});
