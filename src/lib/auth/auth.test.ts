/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from 'svelte/store'
import { createAuth } from './auth.js'

const user = { id: '3e2854f2-219f-4d6b-9fc3-5239c439bc04', email: 'alice@example.com', displayName: 'Alice' }
const userResponse = () => Response.json({ user })

test('restores the cookie session, signs in, and signs out through the backend endpoints', async (context) => {
  const responses = [new Response(null, { status: 401 }), userResponse(), userResponse(), new Response(null, { status: 204 })]
  const fetch = context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const auth = createAuth()
  assert.deepEqual(get(auth), { status: 'checking', session: null, message: null })

  await auth.restore()
  assert.deepEqual(get(auth), { status: 'disconnected', session: null, message: null })
  await auth.connect('alice@example.com', 'correct-password')
  assert.deepEqual(get(auth), { status: 'connected', session: user, message: null })
  await auth.restore()
  assert.deepEqual(get(auth), { status: 'connected', session: user, message: null })
  await auth.disconnect()
  assert.deepEqual(get(auth), { status: 'disconnected', session: null, message: null })

  assert.deepEqual(fetch.mock.calls.map(({ arguments: args }) => args[0]), ['http://localhost:3000/auth/me', 'http://localhost:3000/auth/login', 'http://localhost:3000/auth/me', 'http://localhost:3000/auth/logout'])
  assert.deepEqual(fetch.mock.calls.map(({ arguments: args }) => args[1]?.method), ['GET', 'POST', 'GET', 'POST'])
  for (const { arguments: args } of fetch.mock.calls) {
    assert.equal(args[1]?.credentials, 'include')
    assert.ok(args[1]?.signal instanceof AbortSignal)
  }
  assert.deepEqual(fetch.mock.calls[1].arguments[1]?.headers, { 'Content-Type': 'application/json' })
  assert.deepEqual(JSON.parse(fetch.mock.calls[1].arguments[1]?.body as string), { email: 'alice@example.com', password: 'correct-password' })
  assert.equal(fetch.mock.calls[0].arguments[1]?.body, undefined)
  assert.equal(fetch.mock.calls[3].arguments[1]?.body, undefined)
  auth.destroy()
})

test('restores an existing session immediately and distinguishes refusal from expiration', async (context) => {
  const responses = [userResponse(), new Response(null, { status: 401 }), new Response(null, { status: 401 }), userResponse()]
  context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const auth = createAuth()
  await auth.restore()
  assert.deepEqual(get(auth), { status: 'connected', session: user, message: null })
  const restore = auth.restore()
  assert.equal(get(auth).status, 'connected')
  assert.deepEqual(get(auth).session, user)
  await restore
  assert.deepEqual(get(auth), { status: 'expired', session: null, message: null })
  await auth.connect('alice@example.com', 'wrong-password')
  assert.equal(get(auth).status, 'refused')
  assert.equal(get(auth).session, null)
  assert.match(get(auth).message!, /Incorrect email or password/)
  await auth.connect('alice@example.com', 'correct-password')
  assert.deepEqual(get(auth), { status: 'connected', session: user, message: null })
  auth.destroy()
})

test('failed logout preserves the user and allows retry; failed refresh also keeps the session', async (context) => {
  const responses = [userResponse(), new Response(null, { status: 403 }), new Response(null, { status: 500 }), new Response(null, { status: 204 })]
  context.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const auth = createAuth()
  await auth.restore()
  await auth.disconnect()
  assert.equal(get(auth).status, 'error')
  assert.deepEqual(get(auth).session, user)
  assert.match(get(auth).message!, /refused/)
  await auth.restore()
  assert.equal(get(auth).status, 'error')
  assert.deepEqual(get(auth).session, user)
  assert.match(get(auth).message!, /unavailable/)
  await auth.disconnect()
  assert.deepEqual(get(auth), { status: 'disconnected', session: null, message: null })
  auth.destroy()
})

test('network failures and invalid payloads never create a session', async (context) => {
  const responses = [
    new Response('not JSON'),
    Response.json({ user: { ...user, id: 'invalid-id' } }),
    Response.json({ user: { ...user, email: null } }),
    Response.json({ user: { ...user, displayName: 1 } }),
    Response.json({ session: user }),
    new Response(null, { status: 400 }),
    new Response(null, { status: 500 }),
    new Response(null, { status: 204 }),
  ]
  let networkFailure = true
  context.mock.method(globalThis, 'fetch', async () => {
    if (networkFailure) {
      networkFailure = false
      throw new TypeError('Failed to fetch')
    }
    return responses.shift()!
  })
  const auth = createAuth()
  await auth.connect('alice@example.com', 'correct-password')
  assert.equal(get(auth).status, 'error')
  assert.equal(get(auth).session, null)
  assert.match(get(auth).message!, /Unable to reach/)
  for (let index = 0; index < 8; index++) {
    await auth.connect('alice@example.com', 'correct-password')
    assert.equal(get(auth).status, 'error')
    assert.equal(get(auth).session, null)
    assert.ok(get(auth).message)
  }
  auth.destroy()
})

test('ignores competing actions until the pending request settles', async (context) => {
  let resolve!: (response: Response) => void
  const fetch = context.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done }))
  const auth = createAuth()
  const connect = auth.connect('alice@example.com', 'correct-password')
  await auth.connect('bob@example.com', 'another-password')
  await auth.restore()
  await auth.disconnect()
  assert.equal(fetch.mock.callCount(), 1)
  assert.deepEqual(get(auth), { status: 'connecting', session: null, message: null })
  resolve(userResponse())
  await connect
  await auth.connect('bob@example.com', 'another-password')
  assert.equal(fetch.mock.callCount(), 1)
  const disconnect = auth.disconnect()
  await auth.restore()
  await auth.disconnect()
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(get(auth).status, 'disconnecting')
  resolve(new Response(null, { status: 204 }))
  await disconnect
  assert.deepEqual(get(auth), { status: 'disconnected', session: null, message: null })
  auth.destroy()
})

test('destroy aborts requests and prevents stale results or later subscriber notifications', async (context) => {
  let resolve!: (response: Response) => void
  const fetch = context.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done }))
  const auth = createAuth()
  let notifications = 0
  const unsubscribe = auth.subscribe(() => { notifications++ })
  const connect = auth.connect('alice@example.com', 'correct-password')
  const beforeDestroy = notifications
  auth.destroy()
  assert.equal(fetch.mock.calls[0].arguments[1]?.signal?.aborted, true)
  resolve(userResponse())
  await connect
  await auth.restore()
  await auth.connect('alice@example.com', 'correct-password')
  await auth.disconnect()
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(notifications, beforeDestroy)
  assert.equal(get(auth).session, null)
  unsubscribe()
})

test('logout supersedes background refresh and ignores the stale refresh result', async (context) => {
  for (const staleResponse of [new Response(null, { status: 401 }), userResponse()]) {
    let resolveRefresh!: (response: Response) => void
    const fetch = context.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      if (url === 'http://localhost:3000/auth/login') return userResponse()
      if (url === 'http://localhost:3000/auth/logout') return new Response(null, { status: 204 })
      return new Promise<Response>((done) => { resolveRefresh = done })
    })
    const auth = createAuth()
    await auth.connect('alice@example.com', 'correct-password')
    const restore = auth.restore()
    assert.equal(get(auth).status, 'connected')
    await auth.disconnect()
    assert.equal(fetch.mock.calls[1].arguments[1]?.signal?.aborted, true)
    assert.deepEqual(fetch.mock.calls.map(({ arguments: args }) => args[0]), ['http://localhost:3000/auth/login', 'http://localhost:3000/auth/me', 'http://localhost:3000/auth/logout'])
    assert.deepEqual(get(auth), { status: 'disconnected', session: null, message: null })
    resolveRefresh(staleResponse)
    await restore
    assert.deepEqual(get(auth), { status: 'disconnected', session: null, message: null })
    auth.destroy()
    fetch.mock.restore()
  }
})

test('destroy also discards a response whose body was still being read', async (context) => {
  let resolveBody!: (body: unknown) => void
  const response = userResponse()
  context.mock.method(response, 'json', () => new Promise<unknown>((done) => { resolveBody = done }))
  context.mock.method(globalThis, 'fetch', async () => response)
  const auth = createAuth()
  const connect = auth.connect('alice@example.com', 'correct-password')
  await Promise.resolve()
  assert.ok(resolveBody)
  auth.destroy()
  resolveBody({ user })
  await connect
  assert.equal(get(auth).status, 'connecting')
  assert.equal(get(auth).session, null)
})

test('a protected module can expire auth and prevent a stale refresh restoring the user', async (context) => {
  let resolveRefresh!: (response: Response) => void
  const fetch = context.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => url === 'http://localhost:3000/auth/login'
    ? userResponse() : new Promise<Response>((done) => { resolveRefresh = done }))
  const auth = createAuth()
  await auth.connect(user.email, 'correct-password')
  const refreshing = auth.restore()
  auth.expire()
  assert.equal(fetch.mock.calls[1].arguments[1]?.signal?.aborted, true)
  assert.deepEqual(get(auth), { status: 'expired', session: null, message: null })
  resolveRefresh(userResponse())
  await refreshing
  assert.equal(get(auth).session, null)
  fetch.mock.mockImplementation(async () => userResponse())
  await auth.connect(user.email, 'correct-password')
  assert.equal(get(auth).status, 'connected')
  auth.destroy()
})
