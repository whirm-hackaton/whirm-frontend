/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseEnv } from './env.js'

test('parses a required backend URL without changing its value', () => {
  const BACKEND_URL = 'https://api.example.test/base/'
  assert.equal(parseEnv({ BACKEND_URL }).BACKEND_URL, BACKEND_URL)
})

test('throws when the backend URL is missing, empty or invalid', (context) => {
  context.mock.method(console, 'error', () => {})
  for (const source of [{}, { BACKEND_URL: '' }, { BACKEND_URL: 'not-a-url' }]) {
    assert.throws(() => parseEnv(source), /BACKEND_URL/)
  }
})
