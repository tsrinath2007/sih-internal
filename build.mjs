import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

const entryPoints = [
  'extension/background/service-worker.ts',
  'extension/content/dom-reader.ts',
  'extension/content/pii-detector-dom.ts',
  'extension/content/pii-detector-visual.ts',
  'extension/content/redactor.ts',
  'extension/content/action-executor.ts',
  'extension/popup/popup.ts',
  'extension/policy/action-validator.ts',
  'extension/api/grok-client.ts',
  'extension/storage/local-mapping-store.ts'
];

async function build() {
  const ctx = await esbuild.context({
    entryPoints,
    outdir: 'extension/dist',
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser'
  });

  if (isWatch) {
    await ctx.watch();
    console.log('⚡ Watching extension files for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('✓ Extension build complete -> extension/dist/');
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
