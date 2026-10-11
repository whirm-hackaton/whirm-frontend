/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPublicClient, http } from 'viem'
import { entryPoint06Address, toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { createPrefundedBundler, networkError, walletServiceUnavailableReason } from './network.js'

const rpcUrl = 'https://sepolia.base.org'
const bundlerUrl = 'https://public.pimlico.io/v2/84532/rpc'
const makeAccount = () => toCoinbaseSmartAccount({
  client: createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) }),
  // Test-only owner; no production key or WebAuthn assertion is used.
  owners: [privateKeyToAccount('0x' + '01'.repeat(32) as `0x${string}`)],
  address: '0x1111111111111111111111111111111111111111', version: '1.1',
})

test('service configuration is optional and requires a public HTTPS URL without secrets', () => {
  assert.match(walletServiceUnavailableReason('')!, /not configured/)
  assert.equal(walletServiceUnavailableReason(bundlerUrl), null)
  assert.equal(walletServiceUnavailableReason('https://another-public-bundler.example/rpc'), null)
  for (const url of ['invalid', 'https://api.pimlico.io/v2/84532/rpc?apikey=secret',
    'http://localhost:3000/rpc', 'https://user:secret@provider.example/rpc',
    bundlerUrl + '?apikey=secret', bundlerUrl + '#secret', 'file:///rpc']) {
    assert.ok(walletServiceUnavailableReason(url))
  }
})

test('native bundler omits credentials and validates Base Sepolia, EP06 and validated Pimlico fees without a paymaster', async (context) => {
  const requests: string[] = []
  let rpcChain = '0x14a34'
  let bundlerChain = '0x14a34'
  let supported: unknown = [entryPoint06Address]
  let standard: unknown = { maxFeePerGas: '0x64', maxPriorityFeePerGas: '0x2' }
  context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    const request = JSON.parse(options!.body as string)
    requests.push(request.method)
    const isBundler = String(url) === bundlerUrl
    assert.equal(isBundler || String(url) === rpcUrl, true)
    assert.equal(options!.credentials, 'omit')
    const result = request.method === 'eth_chainId' ? isBundler ? bundlerChain : rpcChain
      : request.method === 'eth_supportedEntryPoints' ? supported
        : request.method === 'pimlico_getUserOperationGasPrice' ? { standard }
          : assert.fail('Unexpected RPC method: ' + request.method)
    return Response.json({ jsonrpc: '2.0', id: request.id, result })
  })
  const account = await makeAccount()
  const bundler = await createPrefundedBundler(account)
  assert.equal(bundler.account, account)
  assert.equal(bundler.chain.id, 84532)
  assert.equal(bundler.paymaster, undefined)
  assert.equal(bundler.pollingInterval, 6_000)
  assert.deepEqual(requests.sort(), ['eth_chainId', 'eth_chainId', 'eth_supportedEntryPoints'])
  const estimate = () => bundler.userOperation!.estimateFeesPerGas!({ account, bundlerClient: bundler, userOperation: {} })
  assert.deepEqual(await estimate(), { maxFeePerGas: 100n, maxPriorityFeePerGas: 2n })
  for (const invalid of [undefined, { maxFeePerGas: '0x0', maxPriorityFeePerGas: '0x0' },
    { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x2' }, { maxFeePerGas: ['0x1'], maxPriorityFeePerGas: '0x0' },
    { maxFeePerGas: '0x01', maxPriorityFeePerGas: '0x0' }, { maxFeePerGas: '0x' + 'f'.repeat(65), maxPriorityFeePerGas: '0x0' }]) {
    standard = invalid
    await assert.rejects(estimate, /invalid gas prices/)
  }
  supported = []
  await assert.rejects(() => createPrefundedBundler(account), /does not support/)
  supported = [entryPoint06Address]
  rpcChain = '0x1'
  await assert.rejects(() => createPrefundedBundler(account), /84532/)
  rpcChain = '0x14a34'
  bundlerChain = '0x1'
  await assert.rejects(() => createPrefundedBundler(account), /84532/)
  await assert.rejects(() => createPrefundedBundler({ ...account,
    entryPoint: { ...account.entryPoint, address: '0x2222222222222222222222222222222222222222' },
  }), /EntryPoint 0.6 configuration/)
})

test('network errors classify funding/signature/provider failures without exposing provider secrets', () => {
  assert.match(networkError(new Error('AA21 did not pay prefund https://provider?apikey=secret')), /more Base Sepolia ETH/)
  assert.match(networkError(new Error('AA24 signature error')), /signature was rejected/)
  assert.match(networkError(new Error('AA13 initCode failed')), /could not be deployed/)
  assert.match(networkError(new Error('AA23 reverted')), /rejected by the network/)
  assert.match(networkError({ cause: { status: 401 } }), /service refused access/)
  assert.doesNotMatch(networkError({ cause: { status: 401 } }), /bank|session|sign in/i)
  assert.match(networkError({ cause: { status: 429 } }), /rate limit/)
  assert.match(networkError(new Error('fetch timed out')), /status before retrying/)
  assert.match(networkError(new Error('secret'), '0x1234'), /submitted.*unknown/)
  assert.doesNotMatch(networkError(new Error('https://provider?apikey=secret')), /provider|apikey|secret/)
})
