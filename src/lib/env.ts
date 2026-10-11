/// <reference types="vite/client" />

import { envsafe, str, url } from 'envsafe'

export function parseEnv(source: Record<string, string | undefined>) {
  return envsafe({
    BACKEND_URL: url(),
    WALLET_ORIGIN: url(),
    WALLET_RP_ID: str(),
    BASE_SEPOLIA_RPC_URL: url(),
    BUNDLER_URL: str({ default: '', allowEmpty: true }),
  }, { env: source })
}

export const env = parseEnv(import.meta.env ?? process.env)
