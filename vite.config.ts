import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the UI with hot reload. Run the CLI on port 4321 at the
// same time (`node dist/cli.js <path> --no-open`) so the API calls resolve.
export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  build: { outDir: '../../dist/ui', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4321',
      '/events': 'http://127.0.0.1:4321',
    },
  },
});
