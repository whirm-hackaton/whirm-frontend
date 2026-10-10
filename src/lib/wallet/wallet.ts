import { writable } from 'svelte/store'
import { env } from '../env.js'
import { createPasskey, preparePasskeyAccount, isPasskeyCredential, passkeyContext, passkeyError, passkeyRequestRejected, type PasskeyCredential, type PreparedPasskey } from './passkey.js'

export type WalletMetadata = {
  id: string
  userId: string
  address: string
  chainId: 84532
  status: 'candidate' | 'unverified' | 'verified'
  createdAt: string
  verifiedAt: string | null
}

type WalletState = {
  status: 'loading' | 'idle' | 'confirming' | 'creating' | 'ready' | 'error' | 'cancelled' | 'expired'
  wallets: WalletMetadata[]
  message: string | null
  draft: PasskeyCredential | null
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))

function isWallet(value: unknown, userId: string): value is WalletMetadata {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' && uuid.test(value.id)
    && 'userId' in value && value.userId === userId
    && 'address' in value && typeof value.address === 'string' && /^0x[0-9a-f]{40}$/.test(value.address)
    && 'chainId' in value && value.chainId === 84532
    && 'createdAt' in value && isDate(value.createdAt)
    && 'status' in value && 'verifiedAt' in value
    && (value.status === 'verified' ? isDate(value.verifiedAt)
      : (value.status === 'candidate' || value.status === 'unverified') && value.verifiedAt === null)
}

type WalletDependencies = {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  register: typeof createPasskey
  prepare: typeof preparePasskeyAccount
  context: typeof passkeyContext
  lock: (action: () => Promise<void>) => Promise<void>
}

export function createWallet(userId: string, onSessionExpired: () => void, dependencies?: WalletDependencies) {
  const deps = dependencies ?? {
    get storage() { return localStorage },
    register: createPasskey,
    prepare: preparePasskeyAccount,
    context: passkeyContext,
    lock: async (action: () => Promise<void>) => {
      if (!navigator.locks) throw new Error('This browser cannot safely coordinate wallet creation. Use a browser with Web Locks support.')
      await navigator.locks.request(`whirm-passkey:${userId}:${env.WALLET_ORIGIN}`, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Wallet creation is already open in another tab. Finish there, then refresh.')
        await action()
      })
    },
  }
  let current: WalletState = { status: 'loading', wallets: [], message: null, draft: null }
  const state = writable<WalletState>(current)
  const storageKey = `whirm-passkey:${userId}:${env.WALLET_ORIGIN}`
  let pending: AbortController | undefined
  let destroyed = false
  let uncertain = false
  let prepared: PreparedPasskey | undefined

  function setState(next: WalletState) {
    current = next
    state.set(next)
  }

  function loadDraft() {
    if (current.draft) {
      try { deps.storage.setItem(storageKey, JSON.stringify(current.draft)) }
      catch { throw new Error('Your passkey was created, but browser storage could not save its public settings. Keep this tab open and restore storage before retrying. Reload recovery is not assured.') }
      uncertain = false
      return
    }
    const raw = deps.storage.getItem(storageKey)
    if (!raw) return
    const value: unknown = JSON.parse(raw)
    if (!isPasskeyCredential(value)) {
      uncertain = true
      throw new Error('A previous passkey request has an uncertain result. Do not create another passkey. Unlock Bitwarden and recover the existing wallet.')
    }
    setState({ ...current, draft: { credentialId: value.credentialId, publicKey: value.publicKey, rpId: value.rpId, origin: value.origin } })
  }

  async function request(create: boolean, confirm = false) {
    if (destroyed || pending || current.status === 'expired') return
    if (create && current.status !== 'confirming') return
    const controller = new AbortController()
    pending = controller
    let hasResponse = false
    setState({ ...current, status: create ? 'creating' : 'loading', message: null })

    try {
      if (create) {
        await deps.lock(async () => {
          if (destroyed || pending !== controller || controller.signal.aborted) return
          deps.context()
          loadDraft()
          if (uncertain) throw new Error('A previous passkey request has an uncertain result. Recover the existing wallet before creating another.')
          if (!current.draft) {
            try { deps.storage.setItem(storageKey, JSON.stringify({ registering: true })) }
            catch { throw new Error('Browser storage is unavailable. No new passkey was requested. Enable browser storage before continuing.') }
            uncertain = true
            let credential: PasskeyCredential
            try { credential = await deps.register(userId, controller.signal) }
            catch (error) {
              if (passkeyRequestRejected(error)) {
                deps.storage.removeItem(storageKey)
                uncertain = false
              }
              throw error
            }
            // Keep any returned credential even when cancellation/unmount raced the provider.
            current = { ...current, draft: credential }
            try { deps.storage.setItem(storageKey, JSON.stringify(credential)) }
            catch { throw new Error('Your passkey was created, but browser storage could not save its public settings. Keep this tab open and restore storage before retrying. Reload recovery is not assured.') }
            uncertain = false
            if (!destroyed) setState(current)
          }
          if (destroyed || pending !== controller) return
          deps.storage.setItem(storageKey, JSON.stringify(current.draft))
          uncertain = false
          prepared = await deps.prepare(current.draft!)
        })
        if (destroyed || pending !== controller) return
        if (!prepared) throw new Error('Wallet preparation failed')
      }
      const response = await fetch(`${env.BACKEND_URL.replace(/\/+$/, '')}/wallet`, {
        method: create ? 'PUT' : 'GET',
        credentials: 'include',
        signal: controller.signal,
        ...(create ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: prepared!.address, chainId: 84532 }) } : {}),
      })
      hasResponse = true
      if (destroyed || pending !== controller) return
      if (response.status === 401) {
        setState({ status: 'expired', wallets: [], message: null, draft: null })
        onSessionExpired()
        return
      }
      const missing = !create && response.status === 404
      if (!response.ok && !missing) {
        setState({ ...current, status: 'error', message: response.status === 400
          ? 'Wallet registration is temporarily unavailable. Your public passkey settings have been kept in this browser. Refresh to retry without creating another passkey.'
          : response.status === 409 ? 'Your account already has a wallet or this address is already associated. Refresh to load your wallet. Your passkey has been kept.'
            : response.status >= 500 ? 'The wallet service is unavailable. Please refresh and try again.'
              : 'The server refused this request. Please refresh and try again.' })
        return
      }
      const data: unknown = missing ? null : await response.json()
      if (destroyed || pending !== controller) return
      const wallets = missing ? [] : typeof data === 'object' && data !== null
        ? 'wallet' in data ? [data.wallet] : null
        : null
      if ((!create && ![200, 404].includes(response.status)) || (create && ![200, 201].includes(response.status))
        || !Array.isArray(wallets) || !wallets.every((wallet) => isWallet(wallet, userId))
        || (create && (wallets.length !== 1 || wallets[0]?.address !== prepared?.address))) {
        throw new Error('Invalid wallet response')
      }
      let message: string | null = null
      if (!create) {
        try { loadDraft() } catch (error) { uncertain = true; message = error instanceof Error ? error.message : 'Unable to read the saved passkey. Wallet creation is blocked.' }
      }
      if (current.draft && prepared && wallets.some((wallet) => wallet.address === prepared!.address)) {
        // Keep the public receipt so another already-confirmed tab reuses this credential.
        current = { ...current, draft: null }
        uncertain = false
      }
      setState({ ...current, status: wallets.length ? 'ready' : message ? 'error' : confirm ? 'confirming' : 'idle', wallets, message })
    } catch (error) {
      if (destroyed || pending !== controller) return
      setState({ ...current, status: 'error', message: hasResponse
        ? 'The server returned an invalid wallet response. Please refresh and try again. Your passkey has been kept.'
        : create ? uncertain && !current.draft
          ? 'The passkey request has an uncertain result. Unlock Bitwarden and recover the existing passkey before trying again.'
          : passkeyError(error)
          : 'Unable to reach the wallet service. Refresh to check whether your request was saved.' })
    } finally {
      if (pending === controller) pending = undefined
    }
  }

  return {
    subscribe: state.subscribe,
    restore: () => request(false),
    create: () => current.status === 'idle' ? request(false, true) : request(true),
    cancel() {
      if (destroyed || !pending) return
      pending.abort()
      pending = undefined
      setState({ ...current, status: 'cancelled', message: 'Request cancelled. Any returned passkey is kept. Refresh to check your wallets before trying again.' })
    },
    destroy() {
      destroyed = true
      pending?.abort()
    },
  }
}
