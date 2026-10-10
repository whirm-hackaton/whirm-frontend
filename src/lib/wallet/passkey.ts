import { createPublicClient, http, type Address, type Hex } from 'viem'
import { createWebAuthnCredential, toCoinbaseSmartAccount, toWebAuthnAccount } from 'viem/account-abstraction'
import { baseSepolia } from 'viem/chains'
import { p256 } from '@noble/curves/p256'
import { env } from '../env.js'

export const factoryAddress = '0xba5ed110efdba3d005bfc882d75358acbbb85842'
export type PasskeyCredential = {
  credentialId: string
  publicKey: Hex
  rpId: string
  origin: string
}
export type PasskeyMetadata = PasskeyCredential & {
  accountVersion: '1.1'
  accountNonce: '0'
  factoryAddress: typeof factoryAddress
}
export type PreparedPasskey = { address: Address; passkey: PasskeyMetadata }

export function passkeyContext() {
  const origin = new URL(env.WALLET_ORIGIN)
  if (origin.origin !== env.WALLET_ORIGIN || origin.origin !== window.location.origin
    || !window.isSecureContext || (origin.protocol !== 'https:' && origin.hostname !== 'localhost')
    || env.WALLET_RP_ID !== origin.hostname) {
    throw new Error('Open the configured secure wallet origin. The wallet RP ID must match its hostname.')
  }
  if (!window.PublicKeyCredential || !navigator.credentials?.create || !navigator.credentials?.get) {
    throw new Error('Passkeys are unavailable in this browser. Enable Bitwarden and use a supported browser.')
  }
  return { origin: origin.origin, rpId: env.WALLET_RP_ID }
}

export function isPasskeyCredential(value: unknown): value is PasskeyCredential {
  if (typeof value !== 'object' || value === null) return false
  if (!('credentialId' in value) || typeof value.credentialId !== 'string'
    || !/^[A-Za-z0-9_-]{1,2048}$/.test(value.credentialId)
    || !('publicKey' in value) || typeof value.publicKey !== 'string'
    || !/^0x[0-9a-fA-F]{128}$/.test(value.publicKey)
    || !('rpId' in value) || value.rpId !== env.WALLET_RP_ID
    || !('origin' in value) || value.origin !== env.WALLET_ORIGIN) return false
  try {
    p256.ProjectivePoint.fromHex('04' + value.publicKey.slice(2))
    return true
  } catch {
    return false
  }
}

export function isPasskeyMetadata(value: unknown): value is PasskeyMetadata {
  return isPasskeyCredential(value) && 'accountVersion' in value && value.accountVersion === '1.1'
    && 'accountNonce' in value && value.accountNonce === '0'
    && 'factoryAddress' in value && value.factoryAddress === factoryAddress
}

export async function createPasskey(userId: string, signal: AbortSignal): Promise<PasskeyCredential> {
  const context = passkeyContext()
  const credential = await createWebAuthnCredential({
    rp: { id: context.rpId, name: 'Whirm wallet' },
    user: { id: new TextEncoder().encode(userId), name: userId, displayName: 'Whirm wallet' },
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    createFn: (options) => navigator.credentials.create({ ...options, signal } as CredentialCreationOptions),
  })
  const result = { ...context, credentialId: credential.id, publicKey: credential.publicKey }
  if (!isPasskeyCredential(result)) throw new Error('The provider returned an invalid P-256 passkey.')
  return result
}

export async function toPasskeyAccount(passkey: PasskeyMetadata, signal?: AbortSignal) {
  passkeyContext()
  if (!isPasskeyMetadata(passkey)) throw new Error('The saved passkey settings do not match this wallet.')
  return toCoinbaseSmartAccount({
    client: createPublicClient({ chain: baseSepolia, transport: http(env.BASE_SEPOLIA_RPC_URL, { retryCount: 0 }) }),
    owners: [toWebAuthnAccount({
      credential: { id: passkey.credentialId, publicKey: passkey.publicKey },
      rpId: passkey.rpId,
      getFn: (options) => navigator.credentials.get({ ...options, signal } as CredentialRequestOptions),
    })],
    version: passkey.accountVersion,
    nonce: BigInt(passkey.accountNonce),
  })
}

export async function preparePasskeyAccount(credential: PasskeyCredential): Promise<PreparedPasskey> {
  const passkey: PasskeyMetadata = { credentialId: credential.credentialId, publicKey: credential.publicKey, rpId: credential.rpId, origin: credential.origin, accountVersion: '1.1', accountNonce: '0', factoryAddress }
  const account = await toPasskeyAccount(passkey)
  return { address: account.address.toLowerCase() as Address, passkey }
}

export function passkeyRequestRejected(error: unknown) {
  let cause = error
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (cause.name === 'NotAllowedError' || cause.name === 'AbortError') return true
    if ('cause' in cause) cause = cause.cause
    else break
  }
  return false
}

export function passkeyError(error: unknown) {
  if (passkeyRequestRejected(error)) {
    return 'Passkey request cancelled or unavailable. Unlock and sync Bitwarden, then try again and choose Bitwarden. No wallet was confirmed.'
  }
  return error instanceof Error && /^(Open the configured|Browser storage|Your passkey was created|Wallet creation is already|This browser cannot|Passkeys are unavailable)/.test(error.message) ? error.message
    : 'Unable to prepare the wallet. Unlock Bitwarden and check browser support and the Base Sepolia connection. Any saved passkey will be reused.'
}
