/// <reference types="vite/client" />

import { envsafe, url } from 'envsafe'

export function parseEnv(source: Record<string, string | undefined>) {
  return envsafe({ BACKEND_URL: url() }, { env: source })
}

export const env = parseEnv(import.meta.env ?? process.env)
