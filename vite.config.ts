import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Pinned, and strict: a silent jump to the next free port is how one
    // ends up looking at a stale tab served by a different project. If
    // 5180 is taken the server says so and stops, rather than moving and
    // leaving the browser pointed at the old address.
    port: 5180,
    strictPort: true,
    host: true,
    fs: { strict: false },
  },
  preview: {
    port: 4180,
    strictPort: true,
    host: true,
  },
  build: {
    target: 'es2022',
    minify: 'terser',
    // Terser runs in a pool of worker threads. On a machine with little free
    // memory the pool crashes V8 rather than finishing, so it is kept to one
    // worker at a time.
    terserOptions: {
      maxWorkers: 1,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
