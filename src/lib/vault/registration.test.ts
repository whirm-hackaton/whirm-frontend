/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDecipheriv, createHmac, createPrivateKey, createPublicKey, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { encryptedRegistration, kdfIterations, registerVault, registrationDetails } from './registration.js'

const password = 'test-only master passphrase 🎈'
const email = 'vault-test@example.test'
function decrypt(cipher: string, key: Buffer) {
  assert.match(cipher, /^2\./)
  const [iv, ciphertext, mac] = cipher.slice(2).split('|').map(value => Buffer.from(value, 'base64'))
  const expected = createHmac('sha256', key.subarray(32)).update(Buffer.concat([iv, ciphertext])).digest()
  assert.ok(timingSafeEqual(mac, expected))
  const aes = createDecipheriv('aes-256-cbc', key.subarray(0, 32), iv)
  return Buffer.concat([aes.update(ciphertext), aes.final()])
}

test('Bitwarden-compatible PBKDF2 verifier and authenticated key wrapping decrypt with independent Node crypto', async () => {
  const payload = await encryptedRegistration(email, password)
  assert.equal(payload.kdf, 0)
  assert.equal(payload.kdfIterations, 600_000)
  const master = pbkdf2Sync(password, email, kdfIterations, 32, 'sha256')
  const verifier = pbkdf2Sync(master, password, 1, 32, 'sha256').toString('base64')
  assert.equal(payload.masterPasswordHash, verifier)
  const stretched = Buffer.concat(['enc', 'mac'].map(label => createHmac('sha256', master).update(Buffer.concat([Buffer.from(label), Buffer.from([1])])).digest()))
  const userKey = decrypt(payload.key, stretched)
  assert.equal(userKey.length, 64)
  const privateDer = decrypt(payload.keys.encryptedPrivateKey, userKey)
  const privateKey = createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' })
  assert.equal(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64'), payload.keys.publicKey)
  assert.ok(!JSON.stringify(payload).includes(password))
  const different = await encryptedRegistration(email, password)
  assert.notEqual(payload.key, different.key)
  assert.notEqual(payload.keys.publicKey, different.keys.publicKey)
  assert.throws(() => decrypt(payload.key, Buffer.alloc(64)))
})

test('registration validates confirmation and preserves spaces/Unicode in the master password', () => {
  assert.equal(registrationDetails(' VAULT-TEST@EXAMPLE.TEST ', password, password), email)
  assert.throws(() => registrationDetails(email, 'short', 'short'))
  assert.throws(() => registrationDetails(email, password, 'different'))
  assert.throws(() => registrationDetails('not an email', password, password))
  assert.equal(registrationDetails(email, ` ${password} `, ` ${password} `), email)
})

test('only fixed registration routes receive a verifier/encrypted keys, with no cookies or plaintext master password', async context => {
  const requests: { url: string; options: RequestInit }[] = []
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    requests.push({ url, options })
    return url.endsWith('/start') ? Response.json('abc.def.ghi') : Response.json({ object: 'registerFinish' })
  })
  await registerVault(email, password, password, new AbortController().signal)
  assert.deepEqual(requests.map(request => request.url), ['/vault-registration/start', '/vault-registration/finish'])
  for (const { options } of requests) {
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.ok(!(options.body as string).includes(password))
    assert.equal(options.method, 'POST')
  }
  const payload = JSON.parse(requests[1].options.body as string)
  assert.equal(payload.emailVerificationToken, 'abc.def.ghi')
  assert.match(payload.key, /^2\./)
  assert.ok(!('password' in payload))
})

test('disabled registration, email verification, invalid tokens and aborts do not submit account creation', async context => {
  for (const response of [new Response(null, { status: 403 }), new Response(null, { status: 204 }), Response.json({ unexpected: true })]) {
    const fetch = context.mock.method(globalThis, 'fetch', async () => response)
    await assert.rejects(registerVault(email, password, password, new AbortController().signal))
    assert.equal(fetch.mock.callCount(), 1)
    fetch.mock.restore()
  }
  const active = new AbortController()
  const fetch = context.mock.method(globalThis, 'fetch', async () => { active.abort(); return Response.json('abc.def.ghi') })
  await assert.rejects(registerVault(email, password, password, active.signal))
  assert.equal(fetch.mock.callCount(), 1)
})

test('ambiguous completion never retries automatically or reports success', async context => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return Response.json('abc.def.ghi')
    throw new Error('network lost')
  })
  await assert.rejects(registerVault(email, password, password, new AbortController().signal), /result is unknown/)
  assert.equal(calls, 2)
})

test('a proxy HTML response or unexpected completion cannot claim successful registration', async context => {
  for (const response of [new Response('<html>SPA</html>'), Response.json({ object: 'wrong' }), Response.json({ object: 'registerFinish' }, { status: 201 })]) {
    let calls = 0
    const fetch = context.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? Response.json('abc.def.ghi') : response)
    await assert.rejects(registerVault(email, password, password, new AbortController().signal), /result is unknown/)
    assert.equal(calls, 2)
    fetch.mock.restore()
  }
})
