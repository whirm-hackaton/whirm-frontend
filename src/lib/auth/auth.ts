import { writable } from 'svelte/store'
import { env } from '../env.js'

export type AuthSession = {
  id: string
  email: string
  displayName: string
}

export type AuthState = {
  status: 'checking' | 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'refused' | 'expired' | 'error'
  session: AuthSession | null
  message: string | null
}

const invalidResponseMessage = 'The server returned an invalid response. Please try again.'
const backendUrl = env.BACKEND_URL.replace(/\/+$/, '')

export function createAuth() {
  let current: AuthState = { status: 'checking', session: null, message: null }
  const state = writable<AuthState>(current)
  let pending: AbortController | undefined
  let pendingRestore = false
  let destroyed = false

  async function request(action: 'restore' | 'connect' | 'disconnect', credentials?: { email: string; password: string }) {
    if (destroyed) return
    if (action === 'connect' && current.session) return
    if (action === 'disconnect' && !current.session) return
    if (pending) {
      if (action !== 'disconnect' || !pendingRestore) return
      pending.abort()
    }

    const controller = new AbortController()
    pending = controller
    pendingRestore = action === 'restore'
    const session = current.session
    let hasResponse = false

    function setState(next: AuthState) {
      if (destroyed || pending !== controller) return
      current = next
      state.set(next)
    }

    function fail(message: string) {
      setState({ status: 'error', session, message })
    }

    setState({
      status: action === 'restore' ? (session ? 'connected' : 'checking')
        : action === 'connect' ? 'connecting' : 'disconnecting',
      session,
      message: null,
    })

    try {
      const endpoint = action === 'restore' ? 'me' : action === 'connect' ? 'login' : 'logout'
      const response = await fetch(`${backendUrl}/auth/${endpoint}`, {
        method: action === 'restore' ? 'GET' : 'POST',
        credentials: 'include',
        signal: controller.signal,
        ...(credentials ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        } : {}),
      })
      hasResponse = true
      if (destroyed || pending !== controller) return

      if (action === 'restore' && response.status === 401) {
        setState({ status: session ? 'expired' : 'disconnected', session: null, message: null })
        return
      }
      if (action === 'connect' && response.status === 401) {
        setState({ status: 'refused', session: null, message: 'Incorrect email or password.' })
        return
      }
      if (action === 'disconnect' && response.status === 204) {
        setState({ status: 'disconnected', session: null, message: null })
        return
      }
      if (!response.ok) {
        fail(response.status >= 500
          ? 'The sign-in service is unavailable. Please try again.'
          : response.status === 400
            ? 'The sign-in details are invalid.'
            : 'The server refused this request. Please try again.')
        return
      }
      if (action === 'disconnect' || response.status !== 200) {
        fail(invalidResponseMessage)
        return
      }

      const data: unknown = await response.json()
      const user = typeof data === 'object' && data !== null && 'user' in data ? data.user : null
      if (typeof user !== 'object' || user === null
        || !('id' in user) || typeof user.id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)
        || !('email' in user) || typeof user.email !== 'string'
        || !('displayName' in user) || typeof user.displayName !== 'string') {
        fail(invalidResponseMessage)
        return
      }
      setState({
        status: 'connected',
        session: { id: user.id, email: user.email, displayName: user.displayName },
        message: null,
      })
    } catch {
      fail(hasResponse ? invalidResponseMessage : 'Unable to reach the server. Check your connection and try again.')
    } finally {
      if (pending === controller) pending = undefined
    }
  }

  return {
    subscribe: state.subscribe,
    restore: () => request('restore'),
    connect: (email: string, password: string) => request('connect', { email, password }),
    disconnect: () => request('disconnect'),
    expire() {
      if (destroyed) return
      pending?.abort()
      pending = undefined
      current = { status: 'expired', session: null, message: null }
      state.set(current)
    },
    destroy() {
      destroyed = true
      pending?.abort()
    },
  }
}
