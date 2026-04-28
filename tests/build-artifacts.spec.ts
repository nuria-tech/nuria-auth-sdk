import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT_DIR = join(import.meta.dirname, '..');
const DIST_DIR = join(ROOT_DIR, 'dist');
const ENTRYPOINTS = ['index', 'react', 'vue', 'nuxt', 'next', 'angular'] as const;
const SHELL_PATH = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh';

function countLines(contents: string) {
  return contents.split(/\r?\n/).length;
}

function npmPackDryRun() {
  const output = execSync('npm pack --json --dry-run', {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    shell: SHELL_PATH,
  });

  return JSON.parse(output) as Array<{
    files: Array<{ path: string; size: number }>;
  }>;
}

describe('published build artifacts', () => {
  beforeAll(() => {
    rmSync(DIST_DIR, { recursive: true, force: true });
    execSync('pnpm build', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: SHELL_PATH,
    });
  }, 120_000);

  it('emits all public entrypoints declared in package exports', () => {
    for (const entrypoint of ENTRYPOINTS) {
      expect(existsSync(join(DIST_DIR, `${entrypoint}.js`))).toBe(true);
      expect(existsSync(join(DIST_DIR, `${entrypoint}.cjs`))).toBe(true);
      expect(existsSync(join(DIST_DIR, `${entrypoint}.d.ts`))).toBe(true);
    }
  });

  it('publishes minified JavaScript bundles for runtime entrypoints', () => {
    for (const entrypoint of ENTRYPOINTS) {
      const esmBundle = readFileSync(join(DIST_DIR, `${entrypoint}.js`), 'utf8');
      const cjsBundle = readFileSync(join(DIST_DIR, `${entrypoint}.cjs`), 'utf8');

      expect(esmBundle).not.toContain('// src/');
      expect(cjsBundle).not.toContain('// src/');
      expect(esmBundle).not.toMatch(/\/\*[\s\S]*?\*\//);
      expect(cjsBundle).not.toMatch(/\/\*[\s\S]*?\*\//);
      expect(countLines(esmBundle)).toBeLessThan(25);
      expect(countLines(cjsBundle)).toBeLessThan(25);
    }
  });

  it('packs only publishable artifacts in the npm tarball', () => {
    const [packResult] = npmPackDryRun();
    const packedFiles = packResult?.files.map((file) => file.path) ?? [];

    expect(packedFiles).toContain('package.json');
    expect(packedFiles).toContain('README.md');
    expect(packedFiles).toContain('LICENSE');
    expect(packedFiles.some((file) => file.startsWith('dist/'))).toBe(true);
    expect(packedFiles.some((file) => file.startsWith('src/'))).toBe(false);
    expect(packedFiles.some((file) => file.startsWith('tests/'))).toBe(false);
    expect(packedFiles.some((file) => file.startsWith('coverage/'))).toBe(false);
  }, 30_000);
});
