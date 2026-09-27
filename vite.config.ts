import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Keep the vendor split explicit so the storefront stays small on mobile.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', '@tanstack/react-router'],
          supabase: ['@supabase/supabase-js'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
