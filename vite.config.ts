import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import unpluginAutoImport from 'unplugin-auto-import/vite';
<<<<<<< HEAD
=======
import { VueUseComponentsResolver, VueUseDirectiveResolver } from 'unplugin-vue-components/resolvers';
>>>>>>> 32e193a5f94b8e4e882fd1025408fedafe99fdce
import unpluginVueComponents from 'unplugin-vue-components/vite';
import { defineConfig } from 'vite';
import pluginExternal from 'vite-plugin-external';

const externals = {
  jquery: '$',
<<<<<<< HEAD
  lodash: '_',
  toastr: 'toastr',
=======
  hljs: 'hljs',
  lodash: '_',
  showdown: 'showdown',
  toastr: 'toastr',
  '@popperjs/core': 'Popper',
>>>>>>> 32e193a5f94b8e4e882fd1025408fedafe99fdce
} as const;

const relative_sillytavern_path = path.relative(
  path.join(__dirname, 'dist'),
  __dirname.substring(0, __dirname.lastIndexOf('public') + 6),
);

export default defineConfig(({ mode }) => ({
  plugins: [
    vue({
      features: {
        optionsAPI: false,
        prodDevtools: process.env.CI !== 'true',
        prodHydrationMismatchDetails: false,
      },
    }),
    unpluginAutoImport({
      dts: true,
      dtsMode: 'overwrite',
      imports: [
        'vue',
        'pinia',
<<<<<<< HEAD
        { from: '@sillytavern/scripts/i18n', imports: ['t'] },
        { from: 'klona', imports: ['klona'] },
=======
        '@vueuse/core',
        { from: '@sillytavern/scripts/i18n', imports: ['t'] },
        { from: 'klona', imports: ['klona'] },
        { from: 'vue-final-modal', imports: ['useModal'] },
>>>>>>> 32e193a5f94b8e4e882fd1025408fedafe99fdce
        { from: 'zod', imports: ['z'] },
      ],
      dirs: [{ glob: './src/panel/composable', types: true }],
    }),
    unpluginVueComponents({
      dts: true,
      syncMode: 'overwrite',
      // globs: ['src/panel/component/*.vue'],
<<<<<<< HEAD
=======
      resolvers: [VueUseComponentsResolver(), VueUseDirectiveResolver()],
>>>>>>> 32e193a5f94b8e4e882fd1025408fedafe99fdce
    }),
    {
      name: 'sillytavern_resolver',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('@sillytavern/')) {
          return {
            id: path.join(relative_sillytavern_path, id.replace('@sillytavern/', '')).replaceAll('\\', '/') + '.js',
            external: true,
          };
        }
      },
    },
    pluginExternal({
      externals: libname => {
        if (libname in externals) {
          return externals[libname as keyof typeof externals];
        }
      },
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  build: {
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].[hash].chunk.js',
        assetFileNames: '[name].[ext]',
        preserveModules: false,
      },
    },

    outDir: 'dist',
    emptyOutDir: false,

    sourcemap: mode === 'production' ? true : 'inline',

    minify: mode === 'production' ? 'terser' : false,
    terserOptions:
      mode === 'production'
        ? {
            format: { quote_style: 1 },
            mangle: { reserved: ['_', 'toastr', 'YAML', '$', 'z'] },
          }
        : {
            format: { beautify: true, indent_level: 2 },
            compress: false,
            mangle: false,
          },

    target: 'esnext',
  },
}));
