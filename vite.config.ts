import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * A build that cannot send postcards is a build that is only half a build.
 *
 * The photographs and the films of the city are delivered from addresses
 * that are written into the source, and they work with nothing more than a
 * cloud name. The postcard is the one thing in the app that *writes* to the
 * cloud, and it needs an unsigned upload preset — the name of which is the
 * permission.
 *
 * When that preset is missing from the environment the build is published
 * anyway, and the postcard fails quietly for every visitor who tries it, in
 * a message that says nothing about what to do. So the build says it here,
 * loudly, at the one moment when somebody could still go and set it.
 *
 * It is a warning and not an error: the photographs, the films and the whole
 * of the city still work without a preset, and a build that refuses to
 * finish is a build that cannot be deployed at all.
 */
function cloudinaryUploadGuard(): Plugin {
  return {
    name: 'nb-cloudinary-upload-guard',
    apply: 'build',
    config(_config, { mode }) {
      // The .env file beside the app, and the environment of the machine
      // doing the building — which is where a deployed build gets the
      // setting, as a repository secret.
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const cloudName = (env.VITE_CLOUDINARY_CLOUD_NAME ?? '').trim();
      const preset = (env.VITE_CLOUDINARY_UPLOAD_PRESET ?? '').trim();

      if (!cloudName) {
        this.warn(
          'nb-cloudinary: VITE_CLOUDINARY_CLOUD_NAME is not set. The photographs and ' +
            'the films of the city will not be delivered from the cloud.',
        );
        return;
      }

      if (!preset) {
        this.warn(
          'nb-cloudinary: VITE_CLOUDINARY_UPLOAD_PRESET is not set. The build will ' +
            'finish and the city will work, but the postcard — the one thing in the ' +
            'app that writes to the cloud — will not be able to be sent. Set it in .env ' +
            'for a local build, and as the VITE_CLOUDINARY_UPLOAD_PRESET repository ' +
            'secret for the published site. The name of the preset is the permission; ' +
            'it is not a secret and no API secret is needed.',
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudinaryUploadGuard()],
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
