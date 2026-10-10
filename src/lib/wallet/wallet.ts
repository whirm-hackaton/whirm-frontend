import { writable } from 'svelte/store'
import { env } from '../env.js'

type WalletMetadata = {
  id: string
  userId: string
  address: string
  chainId: 84532
  status: 'candidate' | 'unverified' | 'verified'
  createdAt: string
  verifiedAt: string | null
}

type WalletState = {
  status: 'loading' | 'idle' | 'creating' | 'ready' | 'error' | 'cancelled' | 'expired'
  wallets: WalletMetadata[]
  message: string | null
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

export function createWallet(userId: string, onSessionExpired: () => void) {
  let current: WalletState = { status: 'loading', wallets: [], message: null }
  const state = writable<WalletState>(current)
  let pending: AbortController | undefined
  let destroyed = false
  let candidateAddress: string | undefined

  function setState(next: WalletState) {
    current = next
    state.set(next)
  }

  async function request(create: boolean) {
    if (destroyed || pending || current.status === 'expired') return
    if (create && current.status !== 'idle') return
    const controller = new AbortController()
    pending = controller
    let hasResponse = false
    setState({ ...current, status: create ? 'creating' : 'loading', message: null })

    try {
      if (create && !candidateAddress) {
        // Simulation: random public address only, with no key or ownership proof.
        candidateAddress = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20)),
          (byte) => byte.toString(16).padStart(2, '0')).join('')
      }
      const response = await fetch(`${env.BACKEND_URL.replace(/\/+$/, '')}/wallets`, {
        method: create ? 'POST' : 'GET',
        credentials: 'include',
        signal: controller.signal,
        ...(create ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: candidateAddress, chainId: 84532 }),
        } : {}),
      })
      hasResponse = true
      if (destroyed || pending !== controller) return
      if (response.status === 401) {
        setState({ status: 'expired', wallets: [], message: null })
        onSessionExpired()
        return
      }
      if (!response.ok) {
        if (response.status === 409) candidateAddress = undefined
        setState({ ...current, status: 'error', message: response.status === 409
          ? 'This address is already associated with another account. Refresh before trying a new simulated address.'
          : response.status >= 500 ? 'The wallet service is unavailable. Please refresh and try again.'
            : response.status === 400 ? 'The wallet details were rejected. Please refresh and try again.'
              : 'The server refused this request. Please refresh and try again.' })
        return
      }
      const data: unknown = await response.json()
      if (destroyed || pending !== controller) return
      const wallets = typeof data === 'object' && data !== null
        ? create && 'wallet' in data ? [data.wallet] : !create && 'wallets' in data ? data.wallets : null
        : null
      if ((!create && response.status !== 200) || (create && ![200, 201].includes(response.status))
        || !Array.isArray(wallets) || !wallets.every((wallet) => isWallet(wallet, userId))
        || new Set(wallets.map((wallet) => wallet.id)).size !== wallets.length
        || (create && wallets[0]?.address !== candidateAddress)) {
        throw new Error('Invalid wallet response')
      }
      setState({ status: wallets.length ? 'ready' : 'idle', wallets, message: null })
    } catch {
      if (destroyed || pending !== controller) return
      setState({ ...current, status: 'error', message: hasResponse
        ? 'The server returned an invalid wallet response. Please refresh and try again.'
        : 'Unable to reach the wallet service. Refresh to check whether your request was saved.' })
    } finally {
      if (pending === controller) pending = undefined
    }
  }

  return {
    subscribe: state.subscribe,
    restore: () => request(false),
    create: () => request(true),
    cancel() {
      if (destroyed || !pending) return
      pending.abort()
      pending = undefined
      setState({ ...current, status: 'cancelled', message: 'Request cancelled. The server may already have saved it. Refresh to check your wallets before trying again.' })
    },
    destroy() {
      destroyed = true
      pending?.abort()
    },
  }
}
