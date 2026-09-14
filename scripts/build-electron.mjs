import { build } from 'esbuild';

await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    'scholar-preload': 'electron/scholar-preload.ts',
  },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  minify: false,
});
