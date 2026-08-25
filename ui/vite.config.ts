import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

/**
 * The web UI's build.
 *
 * Output goes to `server/public`, which Express already serves as static files
 * - so `npm run ui` keeps working exactly as it did and needs to know nothing
 * about Vite. `npm run ui:dev` runs this dev server instead and proxies the API
 * to Express, which is what gives hot reload while editing.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../server/public'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/media': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
