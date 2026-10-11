// Vaultwarden 1.37.4 / Bitwarden PBKDF2 registration protocol.
// References and compatibility limits are documented in docs/vault-registration.md.
export const vaultServer = 'https://vault.whirm.dev'
export const kdfIterations = 600_000
const encoder = new TextEncoder()

function base64(bytes: ArrayBuffer | Uint8Array) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

async function pbkdf2(password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data))
}

async function encrypt(data: Uint8Array<ArrayBuffer>, key: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const aesKey = await crypto.subtle.importKey('raw', key.slice(0, 32), 'AES-CBC', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, data))
  const authenticated = new Uint8Array(iv.length + ciphertext.length)
  authenticated.set(iv)
  authenticated.set(ciphertext, iv.length)
  const mac = await hmac(key.slice(32), authenticated)
  return `2.${base64(iv)}|${base64(ciphertext)}|${base64(mac)}`
}

export function registrationDetails(email: string, masterPassword: string, confirmation: string) {
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid vault email address.')
  // Our onboarding rule, distinct from the bank password policy.
  if (masterPassword.length < 12 || masterPassword.length > 1024 || !masterPassword.trim()) throw new Error('Use a master password of 12 to 1024 characters. A long, unique passphrase is recommended.')
  if (masterPassword !== confirmation) throw new Error('The master passwords do not match.')
  return normalized
}

export async function encryptedRegistration(email: string, masterPassword: string) {
  const masterKey = await pbkdf2(encoder.encode(masterPassword), encoder.encode(email), kdfIterations)
  const userKey = crypto.getRandomValues(new Uint8Array(64))
  const stretched = new Uint8Array(64)
  let privateKey: Uint8Array<ArrayBuffer> | undefined
  try {
    // HKDF-Expand only: Bitwarden uses the PBKDF2 key as the PRK (no HKDF-Extract).
    stretched.set(await hmac(masterKey, new Uint8Array([...encoder.encode('enc'), 1])))
    stretched.set(await hmac(masterKey, new Uint8Array([...encoder.encode('mac'), 1])), 32)
    const hash = await pbkdf2(masterKey, encoder.encode(masterPassword), 1)
    const rsa = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['encrypt', 'decrypt'])
    privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', rsa.privateKey))
    const publicKey = await crypto.subtle.exportKey('spki', rsa.publicKey)
    const key = await encrypt(userKey, stretched)
    const encryptedPrivateKey = await encrypt(privateKey, userKey)
    const masterPasswordHash = base64(hash)
    hash.fill(0)
    // Legacy field shape is explicitly supported by Vaultwarden 1.37.4's RegisterDataCompat.
    return { email, kdf: 0, kdfIterations, masterPasswordHash, key,
      keys: { publicKey: base64(publicKey), encryptedPrivateKey } }
  } finally {
    masterKey.fill(0)
    userKey.fill(0)
    stretched.fill(0)
    privateKey?.fill(0)
  }
}

export async function registerVault(email: string, masterPassword: string, confirmation: string, signal: AbortSignal) {
  const normalized = registrationDetails(email, masterPassword, confirmation)
  const options = { method: 'POST', credentials: 'omit' as const, cache: 'no-store' as const,
    redirect: 'error' as const, signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
  signal.throwIfAborted()
  // The browser never sends the master password, user key or RSA private key in plaintext.
  const response = await fetch('/vault-registration/start', { ...options, body: JSON.stringify({ email: normalized }) })
  if (!response.ok) throw new Error(response.status === 429 ? 'Too many attempts. Wait before trying again.' : 'Vault registration is unavailable or not allowed. An existing account must be opened in Bitwarden.')
  if (response.status === 204) throw new Error('This server requires email verification. Complete registration in Bitwarden; this demo supports registration without email verification.')
  const token: unknown = await response.json()
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('The vault returned an unexpected registration response. No account creation was requested.')
  const payload = await encryptedRegistration(normalized, masterPassword)
  signal.throwIfAborted()
  let finished: Response
  try {
    finished = await fetch('/vault-registration/finish', { ...options,
      body: JSON.stringify({ ...payload, emailVerificationToken: token }) })
  } catch {
    throw new Error('The registration result is unknown. Try signing in to Bitwarden with these details before attempting registration again.')
  }
  if (!finished.ok) throw new Error(finished.status === 429 ? 'Too many attempts. Wait before trying again.' : 'The vault refused registration. If you already have a vault, sign in to it in Bitwarden. No existing account was replaced.')
  try {
    const result: unknown = await finished.json()
    if (finished.status !== 200 || !result || typeof result !== 'object' || !('object' in result) || result.object !== 'registerFinish') throw new Error('Unexpected completion')
  } catch {
    throw new Error('The registration result is unknown. Try signing in to Bitwarden with these details before attempting registration again.')
  }
  // Never authenticate or unlock a vault in Whirm. The official Bitwarden clients do that.
}
