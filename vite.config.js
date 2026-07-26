import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('./package.json', 'utf8')).version
const build = new Date().toISOString().slice(0, 10)

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev has no serverless functions — proxy /api to production so the
    // app runs fully against real data (writes included; mind what you touch).
    proxy: { "/api": { target: "https://lavalle-haus-os.vercel.app", changeOrigin: true } },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(build),
  },
})
