/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from 'svelte/store'
import { createWallet } from './wallet.js'

const userId = '3e2854f2-219f-4d6b-9fc3-5239c439bc04'
const metadata = {
  id: 'a52c86b3-eb08-4fab-9357-631b096d0867',
  userId,
  address: '0x1111111111111111111111111111111111111111',
  chainId: 84532,
  status: 'candidate',
  createdAt: '2026-10-10T20:00:00.000Z',
  verifiedAt: null,
}
const noSessionExpiry = () => { assert.fail('Unexpected session expiration') }

test('restores persisted metadata and posts only a public candidate address and chain', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => options?.method === 'POST'
    ? Response.json({ wallet: { ...metadata, ...JSON.parse(options.body as string) } }, { status: 201 })
    : Response.json({ wallets: [] }))
  const wallet = createWallet(userId, noSessionExpiry)
  await wallet.create()
  assert.equal(fetch.mock.callCount(), 0)
  await wallet.restore()
  assert.equal(get(wallet).status, 'idle')
  const creating = wallet.create()
  assert.equal(get(wallet).status, 'creating')
  await wallet.create()
  await creating
  assert.equal(get(wallet).status, 'ready')
  const saved = get(wallet).wallets[0]!
  assert.equal(saved.status, 'candidate')
  assert.equal(saved.verifiedAt, null)
  const payload = JSON.parse(fetch.mock.calls[1].arguments[1]!.body as string)
  assert.deepEqual(Object.keys(payload).sort(), ['address', 'chainId'])
  assert.match(payload.address, /^0x[0-9a-f]{40}$/)
  assert.equal(payload.chainId, 84532)
  await wallet.create()
  assert.equal(fetch.mock.callCount(), 2)
  for (const { arguments: args } of fetch.mock.calls) {
    assert.equal(args[0], 'http://localhost:3000/wallets')
    assert.equal(args[1]?.credentials, 'include')
    assert.ok(args[1]?.signal instanceof AbortSignal)
  }
  wallet.destroy()
  fetch.mock.mockImplementation(async () => Response.json({ wallets: [saved] }))
  const reloaded = createWallet(userId, noSessionExpiry)
  await reloaded.restore()
  assert.deepEqual(get(reloaded).wallets, [saved])
  reloaded.destroy()
})

test('restores every association with its persisted verification status', async (context) => {
  const verified = { ...metadata, id: '4d66ca6b-55de-4d14-9fbb-51a3c9ae5f95', status: 'verified', verifiedAt: metadata.createdAt }
  context.mock.method(globalThis, 'fetch', async () => Response.json({ wallets: [metadata, verified] }))
  const wallet = createWallet(userId, noSessionExpiry)
  await wallet.restore()
  assert.deepEqual(get(wallet).wallets, [metadata, verified])
  wallet.destroy()
})

test('a wallet 401 clears data and expires auth for reads and writes', async (context) => {
  for (const create of [false, true]) {
    let expirations = 0
    const fetch = context.mock.method(globalThis, 'fetch', async () => Response.json({ wallets: create ? [] : [metadata] }))
    const wallet = createWallet(userId, () => { expirations++ })
    await wallet.restore()
    fetch.mock.mockImplementation(async () => new Response(null, { status: 401 }))
    await (create ? wallet.create() : wallet.restore())
    assert.equal(get(wallet).status, 'expired')
    assert.deepEqual(get(wallet).wallets, [])
    assert.equal(expirations, 1)
    await wallet.restore()
    assert.equal(fetch.mock.callCount(), 2)
    wallet.destroy()
    fetch.mock.restore()
  }
})

test('handles conflicts, server refusal and unavailable API without inventing metadata', async (context) => {
  for (const status of [400, 403, 409, 500]) {
    const fetch = context.mock.method(globalThis, 'fetch', async () => Response.json({ wallets: [] }))
    const wallet = createWallet(userId, noSessionExpiry)
    await wallet.restore()
    fetch.mock.mockImplementation(async () => new Response(null, { status }))
    await wallet.create()
    assert.equal(get(wallet).status, 'error')
    assert.deepEqual(get(wallet).wallets, [])
    assert.match(get(wallet).message!, status === 409 ? /already associated/ : status === 500 ? /unavailable/ : /rejected|refused/)
    await wallet.create()
    assert.equal(fetch.mock.callCount(), 2)
    fetch.mock.mockImplementation(async () => Response.json({ wallets: [] }))
    await wallet.restore()
    assert.equal(get(wallet).status, 'idle')
    wallet.destroy()
    fetch.mock.restore()
  }
})

test('uncertain creation retains its candidate for an idempotent retry after refresh', async (context) => {
  const addresses: string[] = []
  const fetch = context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
    if (options?.method !== 'POST') return Response.json({ wallets: [] })
    const payload = JSON.parse(options.body as string)
    addresses.push(payload.address)
    if (addresses.length === 1) throw new TypeError('Failed to fetch')
    return Response.json({ wallet: { ...metadata, ...payload } })
  })
  const wallet = createWallet(userId, noSessionExpiry)
  await wallet.restore()
  await wallet.create()
  assert.equal(get(wallet).status, 'error')
  assert.match(get(wallet).message!, /whether your request was saved/)
  await wallet.restore()
  await wallet.create()
  assert.equal(get(wallet).status, 'ready')
  assert.equal(addresses[0], addresses[1])
  assert.equal(fetch.mock.callCount(), 4)
  wallet.destroy()
})

test('rejects malformed responses, unsupported chains, foreign owners and incoherent verification', async (context) => {
  const responses = [
    new Response('not JSON'),
    Response.json({ wallets: null }),
    Response.json({ wallets: [metadata, metadata] }),
    Response.json({ wallets: [{ ...metadata, id: 'invalid' }] }),
    Response.json({ wallets: [{ ...metadata, userId: 'another-user' }] }),
    Response.json({ wallets: [{ ...metadata, address: 'invalid' }] }),
    Response.json({ wallets: [{ ...metadata, chainId: 1 }] }),
    Response.json({ wallets: [{ ...metadata, status: 'unknown' }] }),
    Response.json({ wallets: [{ ...metadata, createdAt: 'invalid' }] }),
    Response.json({ wallets: [{ ...metadata, status: 'verified' }] }),
    Response.json({ wallets: [{ ...metadata, verifiedAt: metadata.createdAt }] }),
    Response.json({ wallets: [metadata] }, { status: 201 }),
  ]
  context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const wallet = createWallet(userId, noSessionExpiry)
  while (responses.length) {
    await wallet.restore()
    assert.equal(get(wallet).status, 'error')
    assert.deepEqual(get(wallet).wallets, [])
    assert.match(get(wallet).message!, /invalid wallet response/)
  }
  wallet.destroy()
})

test('cancellation ignores late responses and refresh recovers a saved POST', async (context) => {
  let resolve!: (response: Response) => void
  const fetch = context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => options?.method === 'POST'
    ? new Promise<Response>((done) => { resolve = done }) : Response.json({ wallets: [] }))
  const wallet = createWallet(userId, noSessionExpiry)
  await wallet.restore()
  const creating = wallet.create()
  const payload = JSON.parse(fetch.mock.calls[1].arguments[1]!.body as string)
  wallet.cancel()
  assert.equal(fetch.mock.calls[1].arguments[1]?.signal?.aborted, true)
  assert.equal(get(wallet).status, 'cancelled')
  assert.match(get(wallet).message!, /may already have saved/)
  const saved = { ...metadata, ...payload }
  resolve(Response.json({ wallet: saved }, { status: 201 }))
  await creating
  assert.deepEqual(get(wallet).wallets, [])
  await wallet.create()
  assert.equal(fetch.mock.callCount(), 2)
  fetch.mock.mockImplementation(async () => Response.json({ wallets: [saved] }))
  await wallet.restore()
  assert.deepEqual(get(wallet).wallets, [saved])
  wallet.destroy()
})

test('unmount aborts requests and discards responses still being decoded', async (context) => {
  let resolveBody!: (body: unknown) => void
  const response = Response.json({ wallets: [metadata] })
  context.mock.method(response, 'json', () => new Promise<unknown>((done) => { resolveBody = done }))
  const fetch = context.mock.method(globalThis, 'fetch', async () => response)
  const wallet = createWallet(userId, noSessionExpiry)
  let notifications = 0
  const unsubscribe = wallet.subscribe(() => { notifications++ })
  const loading = wallet.restore()
  await Promise.resolve()
  const beforeDestroy = notifications
  wallet.destroy()
  assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true)
  resolveBody({ wallets: [metadata] })
  await loading
  await wallet.restore()
  await wallet.create()
  assert.equal(notifications, beforeDestroy)
  assert.deepEqual(get(wallet).wallets, [])
  unsubscribe()
})
