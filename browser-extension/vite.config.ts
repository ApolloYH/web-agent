import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const content = mode === 'extension-content';
  return {
    publicDir: false,
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: content,
      lib: {
        entry: resolve(__dirname, content ? 'src/content.ts' : 'src/background.ts'),
        name: content ? 'ApolloBrowserContent' : 'ApolloBrowserBackground',
        formats: ['iife'],
        fileName: () => content ? 'content.js' : 'background.js',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
    plugins: content ? [{
      name: 'disable-page-controller-javascript',
      enforce: 'pre',
      transform(code, id) {
        if (!id.includes('@page-agent/page-controller/dist/lib/page-controller.js')) return;
        const unsafe = '\t\t\tconst asyncFunction = eval(`(async (signal) => { ${script} })`);\n\t\t\tconst result = await asyncFunction(signal);';
        if (!code.includes(unsafe)) throw new Error('PageController executeJavascript implementation changed; review before upgrading');
        return code.replace(unsafe, '\t\t\tthrow new Error("Apollo Browser Bridge disables arbitrary JavaScript execution");');
      },
    }] : [{
      name: 'copy-extension-manifest',
      closeBundle() {
        copyFileSync(resolve(__dirname, 'manifest.json'), resolve(__dirname, 'dist/manifest.json'));
      },
    }],
  };
});
