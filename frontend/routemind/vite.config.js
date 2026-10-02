import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Prefix '' also picks up shell variables such as HTTPS=true from `npm run dev:https`.
  const env = loadEnv(mode, import.meta.dirname, '')
  // Browsers only expose geolocation on secure origins. `npm run dev:https` serves
  // over a self-signed certificate so a phone on the same network can test real GPS.
  const https = env.HTTPS === 'true'
  return {
    plugins: [react(), ...(https ? [basicSsl()] : [])],
    server: {
      host: https ? true : undefined,
      proxy: {
        // The frontend calls /api; the dev server forwards it to the backend, so the
        // browser never needs CORS or any API key.
        '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
      },
    },
  }
})
