/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateWalletAssertion } from './assertion.js'

test('checks the requested credential, actual SDK challenge, origin, RP ID and UP/UV flags', async () => {
  const rawId = new Uint8Array([1, 2, 3]).buffer
  const challenge = new Uint8Array(32).fill(7)
  const passkey = { credentialId: 'AQID', rpId: 'app.whirm.dev', origin: 'https://app.whirm.dev' }
  const clientData = { type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin: passkey.origin, crossOrigin: false }
  const data = new Uint8Array(37)
  data.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passkey.rpId))))
  data[32] = 5
  const credential = {
    id: passkey.credentialId,
    rawId,
    type: 'public-key',
    response: {
      authenticatorData: data.buffer,
      clientDataJSON: new TextEncoder().encode(JSON.stringify(clientData)).buffer,
    },
  }
  const check = (value: unknown) => validateWalletAssertion(value as Credential, challenge, passkey)
  await check(credential)
  for (const value of [null, { ...credential, id: 'another-credential' },
    { ...credential, rawId: new Uint8Array([4, 5]).buffer },
    { ...credential, type: 'password' }, { ...credential, response: {} }]) {
    await assert.rejects(check(value), /does not match/)
  }
  for (const changed of [
    { type: 'webauthn.create' }, { challenge: 'wrong-challenge' },
    { origin: 'https://vault.whirm.dev' }, { crossOrigin: true },
  ]) await assert.rejects(check({ ...credential, response: {
    ...credential.response,
    clientDataJSON: new TextEncoder().encode(JSON.stringify({ ...clientData, ...changed })).buffer,
  } }), /does not match/)
  for (const flags of [0, 1, 4, 21]) {
    const missingFlags = data.slice()
    missingFlags[32] = flags
    await assert.rejects(check({ ...credential, response: { ...credential.response, authenticatorData: missingFlags.buffer } }), /does not match/)
  }
  data[0] = data[0]! ^ 1
  await assert.rejects(check(credential), /does not match/)
})
