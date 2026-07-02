import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const root = path.resolve(__dirname, '../..');
const certDir = path.join(root, 'certs');
const hasCerts = fs.existsSync(path.join(certDir, 'cert.pem'));

const https = hasCerts
  ? {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    }
  : undefined;

const apiTarget = hasCerts ? 'https://localhost:8787' : 'http://localhost:8787';
const wsTarget = hasCerts ? 'wss://localhost:8787' : 'ws://localhost:8787';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['three', 'react', 'react-dom'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https,
    proxy: {
      '/api': { target: apiTarget, secure: false, changeOrigin: true },
      '/ws': { target: wsTarget, ws: true, secure: false, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
