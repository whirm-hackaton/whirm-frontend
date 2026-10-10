/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeFunctionData, encodeAbiParameters, parseAbi } from 'viem'
import { createPasskey, factoryAddress, isPasskeyMetadata, passkeyContext, preparePasskeyAccount, type PasskeyCredential } from './passkey.js'

const credential: PasskeyCredential = {
  credentialId: 'd2hpcm0',
  publicKey: '0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
  rpId: 'localhost', origin: 'http://localhost:5173',
}
const metadata = { ...credential, accountVersion: '1.1', accountNonce: '0', factoryAddress }

test('validates P256 point and fixed reconstruction parameters/context', () => {
  assert.ok(isPasskeyMetadata(metadata))
  const fieldModulus = 'ffffffff00000001000000000000000000000000ffffffffffffffffffffffff'
  const fieldModulusPlusOne = 'ffffffff00000001000000000000000000000001000000000000000000000000'
  const x = credential.publicKey.slice(2, 66)
  const y = credential.publicKey.slice(66)
  for (const change of [
    { credentialId: 'bad+=' }, { publicKey: '0x' + '00'.repeat(64) },
    { publicKey: '0x' + fieldModulus + y }, { publicKey: '0x' + x + fieldModulus },
    { publicKey: '0x' + fieldModulusPlusOne + y },
    { publicKey: credential.publicKey.slice(0, -1) + '4' },
    { publicKey: credential.publicKey.slice(0, -2) },
    { publicKey: credential.publicKey + '00' },
    { publicKey: '0x04' + credential.publicKey.slice(2) },
    { rpId: 'vault.whirm.dev' }, { origin: 'https://app.whirm.dev' },
    { accountVersion: '1' }, { accountNonce: '1' }, { factoryAddress: '0x' + '00'.repeat(20) },
  ]) assert.equal(isPasskeyMetadata({ ...metadata, ...change }), false)
})

test('uses configured secure origin, same-RP context, one owner and fixed factory nonce', async (context) => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const browserWindow = { location: { origin: credential.origin }, isSecureContext: true, PublicKeyCredential: class {} }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow })
  // Node has no browser credential container; no assertion is requested during preparation.
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { create() {}, get() {} } } })
  try {
    assert.deepEqual(passkeyContext(), { origin: credential.origin, rpId: credential.rpId })
    const expected = '0x1111111111111111111111111111111111111111'
    const fetch = context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
      const request = JSON.parse(options!.body as string)
      assert.equal(request.method, 'eth_call')
      assert.equal(request.params[0].to, factoryAddress)
      const decoded = decodeFunctionData({ abi: parseAbi(['function getAddress(bytes[] owners, uint256 nonce) view returns (address)']), data: request.params[0].data })
      assert.deepEqual(decoded.args, [[credential.publicKey], 0n])
      return Response.json({ jsonrpc: '2.0', id: request.id, result: encodeAbiParameters([{ type: 'address' }], [expected]) })
    })
    const prepared = await preparePasskeyAccount(credential)
    assert.deepEqual(prepared, { address: expected, passkey: metadata })
    assert.equal(fetch.mock.callCount(), 1)
    browserWindow.location.origin = 'http://wrong.test'
    assert.throws(passkeyContext, /configured secure wallet origin/)
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})


test('real viem creation adapter requests ES256, discoverable credential, UV and abort signal without choosing a provider', async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const spki = await crypto.subtle.exportKey('spki', key.publicKey)
  let requested: CredentialCreationOptions | undefined
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: credential.origin }, isSecureContext: true, PublicKeyCredential: class {} } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: {
    create(options: CredentialCreationOptions) { requested = options; return Promise.resolve({ id: credential.credentialId, response: { getPublicKey: () => spki } }) },
    get() {},
  } } })
  try {
    const controller = new AbortController()
    const result = await createPasskey('bank-user', controller.signal)
    assert.ok(isPasskeyMetadata({ ...metadata, ...result }))
    assert.deepEqual(Object.keys(result).sort(), ['credentialId', 'origin', 'publicKey', 'rpId'])
    assert.equal(requested?.signal, controller.signal)
    assert.deepEqual(requested?.publicKey?.pubKeyCredParams, [{ type: 'public-key', alg: -7 }])
    assert.deepEqual(requested?.publicKey?.authenticatorSelection, { residentKey: 'required', requireResidentKey: true, userVerification: 'required' })
    assert.deepEqual(requested?.publicKey?.rp, { id: 'localhost', name: 'Whirm wallet' })
    assert.equal(requested?.publicKey?.attestation, 'none')
    assert.equal(requested?.publicKey?.user.name, 'bank-user')
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
