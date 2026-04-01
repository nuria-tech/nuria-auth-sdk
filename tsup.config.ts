import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.ts',
    vue: 'src/vue/index.ts',
    nuxt: 'src/nuxt/index.ts',
    next: 'src/next/index.ts',
    angular: 'src/angular/index.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2018',
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  splitting: false,
});
