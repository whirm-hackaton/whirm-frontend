/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from 'svelte/store'
import { createWallet } from './wallet.js'
import { factoryAddress, type PasskeyMetadata } from './passkey.js'

const userId = '3e2854f2-219f-4d6b-9fc3-5239c439bc04'
const passkey: PasskeyMetadata = {
  credentialId: 'd2hpcm0',
  publicKey: '0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
  rpId: 'localhost', origin: 'http://localhost:5173',
  accountVersion: '1.1', accountNonce: '0', factoryAddress,
}
const metadata = {
  id: 'a52c86b3-eb08-4fab-9357-631b096d0867', userId,
  address: '0x1111111111111111111111111111111111111111' as const,
  chainId: 84532 as const, status: 'candidate', createdAt: '2026-10-10T20:00:00.000Z', verifiedAt: null,
}

function fixture() {
  const calls: string[] = []
  const deps = {
    storage: { getItem: () => null, setItem: () => assert.fail('Recovery must not write browser storage'), removeItem: () => assert.fail('Recovery must not remove browser storage') },
    register: async () => assert.fail('Recovery must never create a passkey'),
    prepare: async () => assert.fail('Recovery must not run creation preparation'),
    context: () => ({ origin: passkey.origin, rpId: passkey.rpId }),
    lock: async (action: () => Promise<void>) => action(),
    recover: async (address: string, signal: AbortSignal) => {
      assert.equal(address, metadata.address)
      assert.equal(signal.aborted, false)
      calls.push(address)
      return { address: metadata.address, passkey }
    },
  }
  const route = async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(options?.credentials, 'include')
    assert.ok(!options?.method || options.method === 'GET')
    assert.ok(String(url).endsWith('/wallet'), 'Only the address-only API is used')
    return Response.json({ wallet: metadata })
  }
  return { deps, calls, route }
}

test('a fresh profile recovers on confirmation using only GET /wallet and retains candidate status', async (context) => {
  const f = fixture()
  const fetch = context.mock.method(globalThis, 'fetch', f.route)
  const wallet = createWallet(userId, () => assert.fail('Unexpected expiration'), f.deps)
  await wallet.restore()
  await wallet.reopen(metadata.id)
  assert.equal(get(wallet).status, 'awaiting-passkey')
  assert.equal(get(wallet).openedWalletId, null)
  assert.equal(get(wallet).openedPasskey, undefined)
  assert.deepEqual(f.calls, [])
  await wallet.confirmReopen()
  assert.equal(fetch.mock.callCount(), 2)
  assert.deepEqual(f.calls, [metadata.address])
  assert.equal(get(wallet).openedWalletId, metadata.id)
  assert.deepEqual(get(wallet).openedPasskey, { address: metadata.address, passkey })
  assert.deepEqual(get(wallet).wallets, [metadata])
  await wallet.restore()
  assert.equal(get(wallet).openedWalletId, null)
  assert.equal(get(wallet).openedPasskey, undefined)
})

test('mismatch, absent passkey, rejection and RPC failures never replace or promote the wallet', async (context) => {
  for (const scenario of ['address', 'cancel', 'missing', 'rpc']) {
    const f = fixture()
    f.deps.recover = async () => {
      if (scenario !== 'address') throw scenario === 'rpc' ? new Error('RPC unavailable') : new DOMException('No credential', 'NotAllowedError')
      return { address: '0x2222222222222222222222222222222222222222' as typeof metadata.address, passkey }
    }
    const fetch = context.mock.method(globalThis, 'fetch', f.route)
    const wallet = createWallet(userId, () => assert.fail('Unexpected expiration'), f.deps)
    await wallet.restore()
    await wallet.reopen(metadata.id)
    await wallet.confirmReopen()
    assert.equal(get(wallet).status, 'error')
    assert.equal(get(wallet).openedWalletId, null)
    assert.equal(get(wallet).openedPasskey, undefined)
    assert.deepEqual(get(wallet).wallets, [metadata])
    assert.equal(fetch.mock.callCount(), 2)
    fetch.mock.restore()
  }
})

test('GET 404, server refusal, invalid user/chain and session expiry never request a passkey', async (context) => {
  for (const scenario of [404, 500, 401, 'user', 'chain'] as const) {
    const f = fixture()
    let expired = 0
    const fetch = context.mock.method(globalThis, 'fetch', f.route)
    const wallet = createWallet(userId, () => { expired++ }, f.deps)
    await wallet.restore()
    fetch.mock.mockImplementation(async () => typeof scenario === 'number' ? new Response(null, { status: scenario })
      : Response.json({ wallet: { ...metadata, ...(scenario === 'user' ? { userId: 'another' } : { chainId: 1 }) } }))
    await wallet.reopen(metadata.id)
    await wallet.confirmReopen()
    assert.deepEqual(f.calls, [])
    assert.equal(get(wallet).openedWalletId, null)
    assert.equal(get(wallet).openedPasskey, undefined)
    assert.equal(get(wallet).status, scenario === 404 ? 'idle' : scenario === 401 ? 'expired' : 'error')
    assert.equal(expired, scenario === 401 ? 1 : 0)
    if (scenario === 404) assert.deepEqual(get(wallet).wallets, [])
    fetch.mock.restore()
  }
})

test('cancel or unmount discards a late recovered account and aborts the provider', async (context) => {
  for (const action of ['cancel', 'destroy'] as const) {
    const f = fixture()
    let resolve!: (value: { address: typeof metadata.address; passkey: PasskeyMetadata }) => void
    let signal!: AbortSignal
    f.deps.recover = async (_address, nextSignal) => {
      signal = nextSignal
      return new Promise((done) => { resolve = done })
    }
    const fetch = context.mock.method(globalThis, 'fetch', f.route)
    const wallet = createWallet(userId, () => assert.fail('Unexpected expiration'), f.deps)
    await wallet.restore()
    await wallet.reopen(metadata.id)
    const recovering = wallet.confirmReopen()
    wallet[action]()
    assert.equal(signal.aborted, true)
    resolve({ address: metadata.address, passkey })
    await recovering
    assert.equal(get(wallet).openedWalletId, null)
    assert.equal(get(wallet).openedPasskey, undefined)
    assert.deepEqual(get(wallet).wallets, [metadata])
    fetch.mock.restore()
  }
})
