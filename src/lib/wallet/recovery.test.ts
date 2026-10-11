/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { p256 } from '@noble/curves/p256'
import { bytesToHex, decodeFunctionData, encodeAbiParameters, parseAbi } from 'viem'
import { factoryAddress, recoverPasskeyAccount } from './passkey.js'

const origin = 'http://localhost:5173'
const address = '0x1111111111111111111111111111111111111111'
const wrongAddress = '0x2222222222222222222222222222222222222222'
const secret = '01'.padStart(64, '0')
const publicKey = bytesToHex(p256.getPublicKey(secret, false).slice(1))

async function assertion(options: CredentialRequestOptions, highS = false) {
  assert.equal(options.publicKey?.allowCredentials, undefined, 'Discovery must work without an old browser credential list')
  assert.equal(options.publicKey?.rpId, 'localhost')
  assert.equal(options.publicKey?.userVerification, 'required')
  const challenge = options.publicKey!.challenge as Uint8Array
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({
    type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin, crossOrigin: false,
  })).buffer
  const authenticatorData = new Uint8Array(37)
  authenticatorData.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('localhost'))))
  authenticatorData[32] = 5
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON))
  const data = new Uint8Array(69)
  data.set(authenticatorData)
  data.set(clientHash, 37)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  const signed = p256.sign(hash, secret, { prehash: false })
  const signature = highS ? new p256.Signature(signed.r, p256.CURVE.n - signed.s) : signed
  return {
    id: 'AQID', type: 'public-key', rawId: new Uint8Array([1, 2, 3]).buffer,
    response: { clientDataJSON, authenticatorData: authenticatorData.buffer, signature: signature.toDERRawBytes().slice().buffer },
  }
}

async function browser<T>(getCredential: (options: CredentialRequestOptions) => Promise<unknown>, run: () => Promise<T>) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin }, isSecureContext: true, PublicKeyCredential: class {} } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: {
    create: () => assert.fail('Recovery must never register a credential'), get: getCredential,
  } } })
  try { return await run() }
  finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
}

function rpc(url: string | URL | Request, options?: RequestInit) {
  assert.equal(String(url), 'https://sepolia.base.org')
  const request = JSON.parse(options!.body as string)
  assert.equal(request.method, 'eth_call')
  assert.equal(request.params[0].to, factoryAddress)
  const call = decodeFunctionData({ abi: parseAbi(['function getAddress(bytes[] owners, uint256 nonce) view returns (address)']), data: request.params[0].data })
  assert.equal(call.args![0].length, 1)
  assert.equal(call.args![1], 0n)
  const result = call.args![0][0] === publicKey ? address : wrongAddress
  return Response.json({ jsonrpc: '2.0', id: request.id, result: encodeAbiParameters([{ type: 'address' }], [result]) })
}

test('recovers the actual P-256 key from a discoverable assertion, including high-S, using viem address selection', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => rpc(url, options))
  for (const highS of [false, true]) {
    await browser((options) => assertion(options, highS), async () => {
      const result = await recoverPasskeyAccount(address, new AbortController().signal)
      assert.equal(result.address, address)
      assert.equal(result.passkey.publicKey, publicKey)
      assert.equal(result.passkey.credentialId, 'AQID')
      assert.equal(result.passkey.origin, origin)
      assert.equal(result.passkey.rpId, 'localhost')
    })
  }
  assert.ok(fetch.mock.callCount() >= 2)
})

test('wrong wallet address and altered signature cannot reopen the registered account', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => rpc(url, options))
  await browser((options) => assertion(options), () => assert.rejects(recoverPasskeyAccount('0x3333333333333333333333333333333333333333', new AbortController().signal), /does not match/))
  await browser(async (options) => {
    const credential = await assertion(options)
    const signature = p256.Signature.fromDER(new Uint8Array(credential.response.signature))
    credential.response.signature = new p256.Signature(signature.r, signature.s === 1n ? 2n : 1n).toDERRawBytes().slice().buffer
    return credential
  }, () => assert.rejects(recoverPasskeyAccount(address, new AbortController().signal), /does not match/))
  assert.ok(fetch.mock.callCount() > 0)
})

test('malformed/domain/challenge/UV assertions are rejected before any RPC', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => assert.fail('Invalid assertion must not reach RPC'))
  for (const scenario of ['origin', 'challenge', 'cross', 'flags', 'rp', 'id', 'signature', 'null']) {
    await browser(async (options) => {
      if (scenario === 'null') return null
      const credential = await assertion(options)
      if (['origin', 'challenge', 'cross'].includes(scenario)) {
        const client = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON))
        if (scenario === 'origin') client.origin = 'https://other.test'
        if (scenario === 'challenge') client.challenge = 'wrong'
        if (scenario === 'cross') client.crossOrigin = true
        credential.response.clientDataJSON = new TextEncoder().encode(JSON.stringify(client)).buffer
      }
      if (scenario === 'flags') new Uint8Array(credential.response.authenticatorData)[32] = 1
      if (scenario === 'rp') new Uint8Array(credential.response.authenticatorData)[0] ^= 1
      if (scenario === 'id') credential.id = 'wrong'
      if (scenario === 'signature') credential.response.signature = new Uint8Array([0, 1]).buffer
      return credential
    }, () => assert.rejects(recoverPasskeyAccount(address, new AbortController().signal)))
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('provider cancellation and an aborted late assertion never reach RPC', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => assert.fail('Cancelled recovery must not reach RPC'))
  await browser(async () => { throw new DOMException('Cancelled', 'NotAllowedError') },
    () => assert.rejects(recoverPasskeyAccount(address, new AbortController().signal), { name: 'NotAllowedError' }))
  const controller = new AbortController()
  await browser(async (options) => {
    assert.equal(options.signal, controller.signal)
    const credential = await assertion(options)
    controller.abort()
    return credential
  }, () => assert.rejects(recoverPasskeyAccount(address, controller.signal), { name: 'AbortError' }))
  assert.equal(fetch.mock.callCount(), 0)
})
