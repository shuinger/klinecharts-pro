import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [solidPlugin()]
})