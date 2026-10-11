/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from 'svelte/store'
import { createWallet } from './wallet.js'
import { factoryAddress, type PasskeyCredential, type PasskeyMetadata } from './passkey.js'

const userId = '3e2854f2-219f-4d6b-9fc3-5239c439bc04'
const credential: PasskeyCredential = {
  credentialId: 'd2hpcm0',
  publicKey: '0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
  rpId: 'localhost', origin: 'http://localhost:5173',
}
const passkey: PasskeyMetadata = { ...credential, accountVersion: '1.1' as const, accountNonce: '0' as const, factoryAddress }
const metadata = {
  id: 'a52c86b3-eb08-4fab-9357-631b096d0867', userId,
  address: '0x1111111111111111111111111111111111111111' as const,
  chainId: 84532, status: 'candidate', createdAt: '2026-10-10T20:00:00.000Z', verifiedAt: null,
}
const noSessionExpiry = () => { assert.fail('Unexpected session expiration') }
const storageKey = `whirm-passkey:${userId}:${credential.origin}`

function fixture() {
  const saved = new Map<string, string>()
  let registrations = 0
  const deps = {
    storage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
      removeItem: (key: string) => { saved.delete(key) },
    },
    register: async () => { registrations++; return credential },
    prepare: async () => ({ address: metadata.address, passkey }),
    context: () => ({ origin: credential.origin, rpId: credential.rpId }),
    lock: async (action: () => Promise<void>) => { await action() },
  }
  return { saved, deps, registrations: () => registrations }
}

async function confirm(wallet: ReturnType<typeof createWallet>) {
  await wallet.restore()
  await wallet.create()
  assert.equal(get(wallet).status, 'confirming')
}

test('confirmed empty vault and fresh API absence allow clearing only the interrupted marker before normal creation', async context => {
  const f = fixture()
  f.saved.set(storageKey, JSON.stringify({ registering: true }))
  const fetch = context.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, options?: RequestInit) => options?.method === 'PUT'
    ? Response.json({ wallet: metadata }, { status: 201 }) : new Response(null, { status: 404 }))
  const wallet = createWallet(userId, noSessionExpiry, f.deps)
  await wallet.restore()
  assert.equal(get(wallet).canRestartSetup, true)
  await wallet.restartSetup(false)
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(f.saved.has(storageKey), true)
  await wallet.restartSetup(true)
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(f.saved.has(storageKey), false)
  assert.equal(get(wallet).status, 'idle')
  assert.equal(f.registrations(), 0)
  await confirm(wallet)
  await wallet.create()
  assert.equal(get(wallet).status, 'ready')
  assert.equal(f.registrations(), 1)
  wallet.destroy()
})

test('restart preserves data when a wallet exists, auth expires, API fails, lock is busy or another tab saves a credential', async context => {
  for (const scenario of ['wallet', 'expired', 'server', 'invalid', 'race', 'lock'] as const) {
    const f = fixture()
    const marker = JSON.stringify({ registering: true })
    f.saved.set(storageKey, marker)
    let expired = 0
    let calls = 0
    context.mock.method(globalThis, 'fetch', async () => {
      if (++calls === 1) return new Response(null, { status: 404 })
      if (scenario === 'wallet') return Response.json({ wallet: metadata })
      if (scenario === 'expired') return new Response(null, { status: 401 })
      if (scenario === 'server') return new Response(null, { status: 500 })
      if (scenario === 'invalid') return Response.json({ wallet: { ...metadata, userId: 'other' } })
      f.saved.set(storageKey, JSON.stringify(credential))
      return new Response(null, { status: 404 })
    })
    const wallet = createWallet(userId, () => { expired++ }, f.deps)
    await wallet.restore()
    if (scenario === 'lock') f.deps.lock = async () => { throw new Error('Busy lock') }
    await wallet.restartSetup(true)
    assert.equal(f.saved.get(storageKey), scenario === 'race' ? JSON.stringify(credential) : marker)
    assert.equal(f.registrations(), 0)
    assert.equal(expired, scenario === 'expired' ? 1 : 0)
    if (scenario === 'wallet') assert.deepEqual(get(wallet).wallets, [metadata])
    if (scenario === 'expired') assert.equal(get(wallet).status, 'expired')
    wallet.destroy()
    context.mock.restoreAll()
  }
})

test('valid credentials, corrupt storage and unknown marker shapes never expose restart or erase browser data', async context => {
  for (const raw of [JSON.stringify(credential), '{broken', JSON.stringify({ registering: true, other: 'data' }), JSON.stringify({ registering: false })]) {
    const f = fixture()
    f.saved.set(storageKey, raw)
    context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
    const wallet = createWallet(userId, noSessionExpiry, f.deps)
    await wallet.restore()
    assert.equal(get(wallet).canRestartSetup, false)
    await wallet.restartSetup(true)
    assert.equal(f.saved.get(storageKey), raw)
    assert.equal(f.registrations(), 0)
    wallet.destroy()
    context.mock.restoreAll()
  }
})

test('reads one current-user wallet, treats GET 404 as absence, and never treats PUT 404 as success', async (context) => {
  const f = fixture()
  const fetch = context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    assert.ok(String(url).endsWith('/wallet'))
    assert.equal(options?.method, 'GET')
    return Response.json({ wallet: metadata })
  })
  const wallet = createWallet(userId, noSessionExpiry, f.deps)
  await wallet.restore()
  assert.deepEqual(get(wallet).wallets, [metadata])
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }))
  await wallet.restore()
  assert.equal(get(wallet).status, 'idle')
  assert.deepEqual(get(wallet).wallets, [])
  await wallet.create()
  assert.equal(get(wallet).status, 'confirming')
  await wallet.create()
  assert.equal(get(wallet).status, 'error')
  assert.deepEqual(get(wallet).draft, credential)
  assert.equal(fetch.mock.calls.at(-1)?.arguments[1]?.method, 'PUT')
  for (const body of [{ wallets: [metadata] }, { wallet: null }]) {
    fetch.mock.mockImplementation(async () => Response.json(body))
    await wallet.restore()
    assert.equal(get(wallet).status, 'error')
  }
  wallet.destroy()
})

test('refresh before registration, address-only payload, candidate response and cross-tab receipt reuse', async (context) => {
  const f = fixture()
  const fetch = context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), 'http://localhost:3000/wallet')
    assert.ok(['GET', 'PUT'].includes(options!.method!))
    return options?.method === 'PUT'
      ? Response.json({ wallet: metadata }, { status: 201 })
      : new Response(null, { status: 404 })
  })
  const first = createWallet(userId, noSessionExpiry, f.deps)
  const second = createWallet(userId, noSessionExpiry, f.deps)
  await first.create()
  assert.equal(fetch.mock.callCount(), 0)
  await confirm(first)
  await confirm(second)
  assert.equal(f.registrations(), 0)
  const creating = first.create()
  await first.create()
  await creating
  assert.equal(get(first).status, 'ready')
  assert.equal(get(first).wallets[0]?.status, 'candidate')
  const put = fetch.mock.calls.find(({ arguments: args }) => args[1]?.method === 'PUT')!
  assert.deepEqual(JSON.parse(put.arguments[1]!.body as string), { address: metadata.address, chainId: 84532 })
  assert.equal(put.arguments[1]?.credentials, 'include')
  assert.ok(put.arguments[1]?.signal instanceof AbortSignal)
  await second.create()
  assert.equal(f.registrations(), 1)
  assert.equal(get(second).status, 'ready')
  assert.ok(f.saved.has(storageKey))
  assert.deepEqual(JSON.parse(f.saved.get(storageKey)!), credential)
  assert.equal(get(first).draft, null)
  first.destroy(); second.destroy()
})

test('GET 404 enables creation, but a wallet found during confirmation prevents a new passkey', async (context) => {
  const f = fixture()
  const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
  const wallet = createWallet(userId, noSessionExpiry, f.deps)
  await wallet.restore()
  assert.equal(get(wallet).status, 'idle')
  assert.equal(get(wallet).message, null)
  assert.deepEqual(get(wallet).wallets, [])
  assert.equal(f.registrations(), 0)
  fetch.mock.mockImplementation(async () => Response.json({ wallet: metadata }))
  await wallet.create()
  assert.equal(get(wallet).status, 'ready')
  assert.deepEqual(get(wallet).wallets, [metadata])
  await wallet.create()
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(f.registrations(), 0)
  wallet.destroy()
})

test('GET failures and obsolete list responses stay blocked; PUT 404 is a registration error', async (context) => {
  const f = fixture()
  const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }))
  const wallet = createWallet(userId, noSessionExpiry, f.deps)
  for (const status of [403, 500]) {
    fetch.mock.mockImplementation(async () => new Response(null, { status }))
    await wallet.restore()
    assert.equal(get(wallet).status, 'error')
    await wallet.create()
    assert.equal(f.registrations(), 0)
  }
  fetch.mock.mockImplementation(async () => Response.json({ wallets: [] }))
  await wallet.restore()
  assert.equal(get(wallet).status, 'error')
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }))
  await confirm(wallet)
  await wallet.create()
  assert.equal(get(wallet).status, 'error')
  assert.deepEqual(get(wallet).wallets, [])
  assert.equal(f.registrations(), 1)
  assert.deepEqual(JSON.parse(f.saved.get(storageKey)!), credential)
  wallet.destroy()
})

test('PUT refuses conflicts and responses for a different wallet without losing the public credential', async (context) => {
  for (const response of [
    new Response(null, { status: 409 }),
    Response.json({ wallet: { ...metadata, address: '0x2222222222222222222222222222222222222222' } }),
    Response.json({ wallet: { ...metadata, userId: 'other' } }),
    Response.json({ wallet: { ...metadata, chainId: 1 } }),
  ]) {
    const f = fixture()
    const fetch = context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) =>
      options?.method === 'PUT' ? response : new Response(null, { status: 404 }))
    const wallet = createWallet(userId, noSessionExpiry, f.deps)
    await confirm(wallet)
    await wallet.create()
    assert.equal(get(wallet).status, 'error')
    assert.deepEqual(get(wallet).wallets, [])
    assert.equal(f.registrations(), 1)
    assert.deepEqual(JSON.parse(f.saved.get(storageKey)!), credential)
    wallet.destroy()
    fetch.mock.restore()
  }
})

test('API rejection, network loss and RPC failure preserve the credential across reload and retry', async (context) => {
  for (const failure of ['api', 'network', 'rpc']) {
    const f = fixture()
    let fails = true
    const originalPrepare = f.deps.prepare
    f.deps.prepare = async () => { if (failure === 'rpc' && fails) throw new Error('RPC unavailable'); return originalPrepare() }
    context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
      if (options?.method !== 'PUT') return new Response(null, { status: 404 })
      if (fails && failure === 'network') throw new TypeError('Failed to fetch')
      if (fails && failure === 'api') return new Response(null, { status: 400 })
      return Response.json({ wallet: metadata })
    })
    const first = createWallet(userId, noSessionExpiry, f.deps)
    await confirm(first)
    await first.create()
    assert.equal(get(first).status, 'error')
    assert.deepEqual(JSON.parse(f.saved.get(storageKey)!), credential)
    first.destroy()
    fails = false
    const reloaded = createWallet(userId, noSessionExpiry, f.deps)
    await confirm(reloaded)
    await reloaded.create()
    assert.equal(get(reloaded).status, 'ready')
    assert.equal(f.registrations(), 1)
    reloaded.destroy()
    context.mock.restoreAll()
  }
})

test('late credential after cancel or destroy is saved, without RPC or PUT', async (context) => {
  for (const action of ['cancel', 'destroy'] as const) {
    const f = fixture()
    let resolve!: (value: PasskeyCredential) => void
    f.deps.register = () => new Promise((done) => { resolve = done })
    let prepared = 0
    f.deps.prepare = async () => { prepared++; return { address: metadata.address, passkey } }
    const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
    const wallet = createWallet(userId, noSessionExpiry, f.deps)
    await confirm(wallet)
    const creating = wallet.create()
    assert.equal(JSON.parse(f.saved.get(storageKey)!).registering, true)
    wallet[action]()
    resolve(credential)
    await creating
    assert.deepEqual(JSON.parse(f.saved.get(storageKey)!), credential)
    assert.equal(prepared, 0)
    assert.equal(fetch.mock.callCount(), 2)
    wallet.destroy()
    context.mock.restoreAll()
  }
})

test('settled provider rejection allows retry; uncertain marker blocks new credential; storage denied prevents request', async (context) => {
  const f = fixture()
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
  f.deps.register = async () => { throw new DOMException('cancelled', 'NotAllowedError') }
  const wallet = createWallet(userId, noSessionExpiry, f.deps)
  await confirm(wallet)
  await wallet.create()
  assert.equal(get(wallet).status, 'idle')
  assert.match(get(wallet).message!, /cancelled or unavailable.*try again/)
  assert.equal(f.saved.has(storageKey), false)
  await confirm(wallet)
  f.saved.set(storageKey, JSON.stringify({ registering: true }))
  await wallet.create()
  assert.equal(get(wallet).status, 'error')
  assert.match(get(wallet).message!, /uncertain/)
  wallet.destroy()
  const blocked = createWallet(userId, noSessionExpiry, f.deps)
  await blocked.restore()
  await blocked.create()
  assert.equal(get(blocked).status, 'error')
  assert.equal(f.registrations(), 0)
  blocked.destroy()
  f.saved.clear()
  f.deps.storage.setItem = () => { throw new Error('quota') }
  const denied = createWallet(userId, noSessionExpiry, f.deps)
  await confirm(denied)
  await denied.create()
  assert.match(get(denied).message!, /Browser storage/)
  denied.destroy()
})

test('wrapped cancellation clears only the attempt marker, survives reload, and retries only after user confirmation', async context => {
  const f = fixture()
  let attempts = 0
  let preparations = 0
  f.deps.register = async () => {
    attempts++
    if (attempts === 1) throw new Error('SDK wrapper', { cause: { name: 'NotAllowedError' } })
    return credential
  }
  f.deps.prepare = async () => { preparations++; return { address: metadata.address, passkey } }
  const fetch = context.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, options?: RequestInit) => options?.method === 'PUT'
    ? Response.json({ wallet: metadata }, { status: 201 }) : new Response(null, { status: 404 }))
  const wallet = createWallet(userId, noSessionExpiry, f.deps)
  await confirm(wallet)
  await wallet.create()
  assert.equal(get(wallet).status, 'idle')
  assert.equal(f.saved.has(storageKey), false)
  assert.equal(attempts, 1)
  assert.equal(preparations, 0)
  assert.equal(fetch.mock.calls.some(call => call.arguments[1]?.method === 'PUT'), false)
  wallet.destroy()
  const reloaded = createWallet(userId, noSessionExpiry, f.deps)
  await reloaded.restore()
  assert.equal(get(reloaded).status, 'idle')
  assert.equal(attempts, 1)
  await reloaded.create()
  assert.equal(attempts, 1)
  await reloaded.create()
  assert.equal(attempts, 2)
  assert.equal(get(reloaded).status, 'ready')
  reloaded.destroy()
})

test('unknown creation failure stays blocked and a changed public draft is never deleted by cancellation cleanup', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
  for (const changedDraft of [false, true]) {
    const f = fixture()
    let attempts = 0
    f.deps.register = async () => {
      attempts++
      if (changedDraft) f.saved.set(storageKey, JSON.stringify(credential))
      throw changedDraft ? new DOMException('cancelled', 'NotAllowedError') : new Error('Provider outcome unknown')
    }
    const wallet = createWallet(userId, noSessionExpiry, f.deps)
    await confirm(wallet)
    await wallet.create()
    assert.equal(get(wallet).status, 'error')
    assert.match(get(wallet).message!, /uncertain result/)
    assert.deepEqual(JSON.parse(f.saved.get(storageKey)!), changedDraft ? credential : { registering: true })
    await wallet.create()
    assert.equal(attempts, 1)
    wallet.destroy()
  }
})

test('restores API metadata, expires 401, and rejects foreign or invalid wallet responses', async (context) => {
  const f = fixture()
  const fetch = context.mock.method(globalThis, 'fetch', async () => Response.json({ wallet: metadata }))
  let expired = 0
  const wallet = createWallet(userId, () => { expired++ }, f.deps)
  await wallet.restore()
  assert.equal(get(wallet).status, 'ready')
  for (const invalid of [ { ...metadata, userId: 'other' }, { ...metadata, address: 'invalid' }, { ...metadata, chainId: 1 }, { ...metadata, status: 'verified' } ]) {
    fetch.mock.mockImplementation(async () => Response.json({ wallet: invalid }))
    await wallet.restore()
    assert.equal(get(wallet).status, 'error')
  }
  fetch.mock.mockImplementation(async () => new Response(null, { status: 401 }))
  await wallet.restore()
  assert.equal(get(wallet).status, 'expired')
  assert.deepEqual(get(wallet).wallets, [])
  assert.equal(expired, 1)
  wallet.destroy()
})


test('storage failure after creation preserves memory and can repair the receipt without another credential', async (context) => {
  const f = fixture()
  let fail = true
  const write = f.deps.storage.setItem
  f.deps.storage.setItem = (key, value) => {
    if (fail && 'credentialId' in JSON.parse(value)) throw new Error('quota')
    write(key, value)
  }
  context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => options?.method === 'PUT'
    ? Response.json({ wallet: metadata }) : new Response(null, { status: 404 }))
  const wallet = createWallet(userId, noSessionExpiry, f.deps)
  await confirm(wallet)
  await wallet.create()
  assert.equal(get(wallet).status, 'error')
  assert.deepEqual(get(wallet).draft, credential)
  assert.match(get(wallet).message!, /Keep this tab open/)
  fail = false
  await confirm(wallet)
  await wallet.create()
  assert.equal(get(wallet).status, 'ready')
  assert.equal(f.registrations(), 1)
  assert.deepEqual(JSON.parse(f.saved.get(storageKey)!), credential)
  wallet.destroy()
})
