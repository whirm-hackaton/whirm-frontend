import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['BACKEND_URL', 'WALLET_', 'BASE_SEPOLIA_RPC_URL', 'BUNDLER_PROXY_URL'])

  return {
    define: {
      ...Object.fromEntries(['BACKEND_URL', 'WALLET_ORIGIN', 'WALLET_RP_ID', 'BASE_SEPOLIA_RPC_URL', 'BUNDLER_PROXY_URL']
        .map((key) => [`import.meta.env.${key}`, JSON.stringify(env[key]) ?? 'undefined'])),
    },
    plugins: [tailwindcss(), svelte()],
    server: {
      port: 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      },
    },
  }
})
