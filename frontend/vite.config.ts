import react from '@vitejs/plugin-react';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, normalizePath } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const infoviewDistPath = [
  path.resolve(__dirname, './node_modules/lean4monaco/node_modules/@leanprover/infoview/dist'),
  path.resolve(__dirname, './node_modules/@leanprover/infoview/dist'),
].find((candidate) => existsSync(candidate));

if (!infoviewDistPath) {
  throw new Error('Could not resolve @leanprover/infoview distribution files.');
}

const leanImportMetaUrlFilter = /[\\/]node_modules[\\/]lean4monaco[\\/]dist[\\/].*\.js$/;

const leanImportMetaUrlPlugin = {
  name: `${importMetaUrlPlugin.name}-lean4monaco`,
  setup(build: any) {
    importMetaUrlPlugin.setup({
      ...build,
      onLoad(options: { filter: RegExp; namespace?: string }, callback: any) {
        return build.onLoad(
          {
            ...options,
            filter: leanImportMetaUrlFilter,
          },
          callback,
        );
      },
    } as never);
  },
};

// https://vite.dev/config/
export default defineConfig({
  envDir: '..',
  optimizeDeps: {
    esbuildOptions: {
      // Only rewrite asset URLs inside lean4monaco; monaco-editor workers break if this runs globally.
      plugins: [leanImportMetaUrlPlugin as never],
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      overrides: {
        fs: 'memfs',
      },
    }),
    viteStaticCopy({
      targets: [
        {
          src: [
            normalizePath(path.join(infoviewDistPath, '*')),
            normalizePath(path.resolve(__dirname, './node_modules/lean4monaco/dist/webview/webview.js')),
          ],
          dest: 'infoview',
        },
        {
          src: [
            normalizePath(path.join(infoviewDistPath, 'codicon.ttf')),
          ],
          dest: 'assets',
        },
        {
          src: [
            normalizePath(
              path.resolve(
                __dirname,
                './node_modules/@codingame/monaco-vscode-theme-defaults-default-extension/resources/*',
              ),
            ),
          ],
          dest: 'node_modules/.vite/deps/resources',
        },
      ],
    }),
  ],
  server: {
    fs: {
      allow: ['..'],
    },
  },
});
