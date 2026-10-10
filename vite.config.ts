import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'BACKEND_URL')

  return {
    define: {
      'import.meta.env.BACKEND_URL': JSON.stringify(env.BACKEND_URL) ?? 'undefined',
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
