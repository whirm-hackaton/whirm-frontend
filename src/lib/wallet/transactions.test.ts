/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from 'svelte/store'
import { createBundlerClient, entryPoint06Address, getUserOperationHash, type UserOperation, type UserOperationReceipt } from 'viem/account-abstraction'
import { custom, type Hex } from 'viem'
import { createTransfer, transferDetails, submissionRejected, sendSignedOperation, type TransferDependencies } from './transactions.js'
import { factoryAddress, type PreparedPasskey } from './passkey.js'

const sender = '0x1111111111111111111111111111111111111111' as const
const recipient = '0x2222222222222222222222222222222222222222' as const
const signature = '0xabcd' as const
const txHash = `0x${'bb'.repeat(32)}` as Hex
const prepared: PreparedPasskey = { address: sender, passkey: {
  credentialId: 'd2hpcm0', publicKey: `0x${'11'.repeat(64)}`, origin: 'http://localhost:5173', rpId: 'localhost',
  accountVersion: '1.1', accountNonce: '0', factoryAddress,
} }
const operation: UserOperation<'0.6'> = {
  sender, nonce: 1n, initCode: '0x', callData: '0x1234', callGasLimit: 20n,
  verificationGasLimit: 800_000n, preVerificationGas: 10n, maxFeePerGas: 3n,
  maxPriorityFeePerGas: 1n, paymasterAndData: '0x', signature: '0x00',
}
const hash = getUserOperationHash({ chainId: 84532, entryPointAddress: entryPoint06Address, entryPointVersion: '0.6', userOperation: operation })
function receipt(success = true, status: 'success' | 'reverted' = 'success'): UserOperationReceipt<'0.6'> {
  return { userOpHash: hash, sender, entryPoint: entryPoint06Address, success, actualGasCost: 100n,
    actualGasUsed: 100n, nonce: operation.nonce, logs: [],
    receipt: { transactionHash: txHash, status, blockHash: txHash, blockNumber: 1n,
      contractAddress: null, cumulativeGasUsed: 100n, effectiveGasPrice: 1n,
      from: sender, to: entryPoint06Address, gasUsed: 100n, logs: [],
      logsBloom: `0x${'00'.repeat(256)}` as Hex, transactionIndex: 0, type: 'eip1559',
    },
  } satisfies UserOperationReceipt<'0.6'>
}
function fixture(expectedValue = 10_000_000_000_000n) {
  const saved = new Map<string, string>()
  const calls = { sign: 0, send: 0, quote: 0, balance: 0 }
  let signal: AbortSignal | undefined
  const deps: TransferDependencies = {
    account: async (_prepared, nextSignal) => {
      signal = nextSignal
      return { address: sender, signUserOperation: async (signed) => {
        calls.sign++
        assert.deepEqual(signed, { ...operation, chainId: 84532 })
        return signature
      } }
    },
    quote: async (_account, to, value) => {
      calls.quote++
      assert.equal(to, recipient)
      assert.equal(value, expectedValue)
      return { operation, send: async (signed) => {
        calls.send++
        assert.deepEqual(signed, { ...operation, signature })
        return hash
      }, receipt: async () => receipt() }
    },
    balance: async () => { calls.balance++; return 1_000_000_000_000_000n },
    receipt: async () => receipt(),
    storage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value) }, removeItem: (key) => { saved.delete(key) } },
    lock: async (action) => action(), unavailable: () => null,
  }
  return { deps, saved, calls, signal: () => signal }
}

test('ETH amounts and recipients are validated without float rounding', () => {
  assert.equal(transferDetails(recipient, '0.000000000000000001', sender).value, 1n)
  for (const amount of ['0', '-1', '1e-5', '1,2', '01', '0.0000000000000000001', 'Infinity', '']) {
    assert.throws(() => transferDetails(recipient, amount, sender))
  }
  for (const address of [sender, '0x0000000000000000000000000000000000000000', '0x123', 'abc']) {
    assert.throws(() => transferDetails(address, '1', sender))
  }
})

test('review precedes fresh signing; double clicks submit only once and execution refreshes balance', async () => {
  const f = fixture()
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  assert.equal(get(transfer).status, 'review')
  assert.equal(f.calls.sign, 0)
  assert.equal(get(transfer).quote?.maxFee, 2_400_090n)
  const sending = transfer.confirm()
  assert.equal(f.calls.sign, 1, 'Signing is invoked directly from the confirmation action before another async step')
  await transfer.confirm()
  await sending
  assert.equal(f.calls.send, 1)
  assert.equal(get(transfer).status, 'success')
  assert.equal(get(transfer).submission?.hash, hash)
  assert.equal(get(transfer).receipt?.receipt.transactionHash, txHash)
  assert.notEqual(hash, txHash)
  assert.equal(f.calls.balance, 4)
  assert.equal(f.saved.size, 0)
})

test('operation failure and reverted enclosing transactions cannot report success', async () => {
  for (const [success, status] of [[false, 'success'], [true, 'reverted']] as const) {
    const f = fixture()
    const baseQuote = f.deps.quote
    f.deps.quote = async (...args) => ({ ...await baseQuote(...args), receipt: async () => receipt(success, status) })
    const transfer = createTransfer(prepared, f.deps)
    await transfer.prepare(recipient, '0.00001')
    await transfer.confirm()
    assert.equal(get(transfer).status, 'failed')
    assert.ok(get(transfer).receipt)
    assert.equal(f.saved.size, 0)
  }
})

test('rejected signing, cancellation and unmount do not submit late signatures', async () => {
  for (const action of ['cancel', 'destroy', 'reject'] as const) {
    const f = fixture()
    let finish!: (signature: Hex) => void
    let signingSignal!: AbortSignal
    f.deps.account = async (_prepared, signal) => {
      signingSignal = signal
      return { address: sender, signUserOperation: async () => {
        if (action === 'reject') throw new DOMException('Refused', 'NotAllowedError')
        return new Promise<Hex>((resolve) => { finish = resolve })
      } }
    }
    const transfer = createTransfer(prepared, f.deps)
    await transfer.prepare(recipient, '0.00001')
    const sending = transfer.confirm()
    if (action !== 'reject') { transfer[action](); assert.equal(signingSignal.aborted, true); finish(signature) }
    await sending
    assert.equal(f.calls.send, 0)
    assert.equal(f.saved.size, 0)
    if (action !== 'destroy') assert.equal(get(transfer).status, 'cancelled')
  }
})

test('cancelled preparation cannot overwrite a later review', async () => {
  const f = fixture()
  let finish!: () => void
  let started!: () => void
  const quoting = new Promise<void>((resolve) => { started = resolve })
  const baseQuote = f.deps.quote
  f.deps.quote = async (...args) => { started(); await new Promise<void>((resolve) => { finish = resolve }); return baseQuote(...args) }
  const transfer = createTransfer(prepared, f.deps)
  const preparing = transfer.prepare(recipient, '0.00001')
  await quoting
  transfer.cancel()
  assert.equal(f.signal()?.aborted, true)
  finish()
  await preparing
  assert.equal(get(transfer).status, 'cancelled')
  assert.equal(f.calls.sign, 0)
  assert.equal(f.calls.send, 0)
})

test('timeout and uncertain submission persist the hash and block resend across reload', async () => {
  const f = fixture()
  const baseQuote = f.deps.quote
  f.deps.quote = async (...args) => ({ ...await baseQuote(...args),
    send: async () => { f.calls.send++; throw new Error('connection lost') },
    receipt: async () => { throw new Error('timeout') },
  })
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  await transfer.confirm()
  assert.equal(get(transfer).status, 'pending')
  assert.equal(get(transfer).submission?.hash, hash)
  assert.equal(f.saved.size, 1)
  transfer.cancel()
  await transfer.prepare(recipient, '0.00001')
  await transfer.confirm()
  assert.equal(f.calls.send, 1)
  const reopened = createTransfer(prepared, f.deps)
  assert.equal(get(reopened).status, 'pending')
  await reopened.prepare(recipient, '0.00001')
  assert.equal(f.calls.quote, 1)
  await reopened.checkReceipt()
  assert.equal(get(reopened).status, 'success')
  assert.equal(f.saved.size, 0)
})

test('deterministic RPC validation rejection clears pending; generic HTTP failure stays uncertain', async () => {
  assert.equal(submissionRejected(Object.assign(new Error('invalid'), { code: -32500 })), true)
  assert.equal(submissionRejected(new Error('wrapped', { cause: Object.assign(new Error('invalid'), { code: -32602 }) })), true)
  assert.equal(submissionRejected(Object.assign(new Error('unknown'), { code: -32000 })), false)
  const f = fixture()
  const baseQuote = f.deps.quote
  f.deps.quote = async (...args) => ({ ...await baseQuote(...args), send: async () => { throw Object.assign(new Error('invalid'), { code: -32500 }) } })
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  await transfer.confirm()
  assert.equal(get(transfer).status, 'failed')
  assert.equal(f.saved.size, 0)
})

test('wrong receipt hash/sender/entry point and unavailable storage never permit a duplicate transfer', async () => {
  for (const wrong of ['hash', 'sender', 'entryPoint', 'storage'] as const) {
    const f = fixture()
    const baseQuote = f.deps.quote
    f.deps.quote = async (...args) => ({ ...await baseQuote(...args), receipt: async () => {
      const result = receipt()
      if (wrong === 'hash') result.userOpHash = txHash
      if (wrong === 'sender') result.sender = recipient
      if (wrong === 'entryPoint') result.entryPoint = recipient
      return result
    } })
    if (wrong === 'storage') f.deps.storage.setItem = () => { throw new Error('storage unavailable') }
    const transfer = createTransfer(prepared, f.deps)
    await transfer.prepare(recipient, '0.00001')
    await transfer.confirm()
    assert.equal(get(transfer).status, wrong === 'storage' ? 'error' : 'pending')
    assert.equal(f.calls.send, wrong === 'storage' ? 0 : 1)
  }
})

test('insufficient prefunded balance and unexpected paymaster fail before signing', async () => {
  for (const scenario of ['balance', 'paymaster', 'network'] as const) {
    const f = fixture()
    if (scenario === 'balance') f.deps.balance = async () => 10_000_000_000_000n
    if (scenario === 'paymaster') {
      const baseQuote = f.deps.quote
      f.deps.quote = async (...args) => ({ ...await baseQuote(...args), operation: { ...operation, paymasterAndData: recipient } })
    }
    if (scenario === 'network') f.deps.unavailable = () => 'Configure the public bundler first.'
    const transfer = createTransfer(prepared, f.deps)
    await transfer.prepare(recipient, '0.00001')
    assert.equal(get(transfer).status, 'error')
    assert.equal(f.calls.sign, 0)
    assert.equal(f.calls.send, 0)
  }
})

test('amount above balance is refused before estimation, with exact known funding details', async () => {
  const f = fixture()
  f.deps.balance = async () => 9_999_999_999_999n
  f.deps.quote = async () => { assert.fail('Do not estimate an amount already above balance') }
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  const state = get(transfer)
  assert.equal(state.status, 'error')
  assert.match(state.message ?? '', /amount exceeds your balance/i)
  assert.ok('funding' in state)
  assert.deepEqual(state.funding, { value: 10_000_000_000_000n, balance: 9_999_999_999_999n, maxFee: null })
  await transfer.confirm()
  assert.equal(f.calls.sign, 0)
  assert.equal(f.calls.send, 0)
})

test('the real balance adapter verifies the RPC chain before diagnosing insufficient funds', async (context) => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fixture().deps.storage })
  context.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
  let rpcChain: string | null = '0x1'
  const requests: string[] = []
  context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
    const request = JSON.parse(options!.body as string)
    requests.push(request.method)
    assert.equal(options!.credentials, 'omit')
    if (request.method === 'eth_chainId' && rpcChain === null) throw new Error('fetch failed')
    const result = request.method === 'eth_chainId' ? rpcChain
      : request.method === 'eth_getBalance' ? '0x0' : assert.fail('No account preparation or submission expected')
    return Response.json({ jsonrpc: '2.0', id: request.id, result })
  })
  for (rpcChain of ['0x1', null, '0x14a34']) {
    requests.length = 0
    const transfer = createTransfer(prepared)
    await transfer.prepare(recipient, '0.00001')
    const state = get(transfer)
    assert.equal(state.status, 'error')
    if (rpcChain === '0x14a34') {
      assert.deepEqual(requests, ['eth_chainId', 'eth_getBalance'])
      assert.equal(state.funding?.balance, 0n)
      assert.match(state.message ?? '', /amount exceeds your balance/)
    } else {
      assert.deepEqual(requests, ['eth_chainId'])
      assert.equal(state.funding?.balance, null)
      assert.match(state.message ?? '', rpcChain === null ? /service could not confirm/ : /RPC must use Base Sepolia/)
      assert.doesNotMatch(state.message ?? '', /amount exceeds|add funds|balance must cover/i)
    }
    await transfer.confirm()
    transfer.destroy()
  }
})

test('fee ceiling blocks equal balance and a one-wei shortfall; exact total is sufficient', async () => {
  const value = 1_000_000_000_000_000_000n
  const maxFee = 2_400_090n
  for (const balance of [value, value + maxFee - 1n, value + maxFee]) {
    const f = fixture(value)
    f.deps.balance = async () => balance
    const transfer = createTransfer(prepared, f.deps)
    await transfer.prepare(recipient, '1')
    const state = get(transfer)
    assert.ok('funding' in state)
    assert.deepEqual(state.funding, { value, balance, maxFee })
    assert.equal(state.status, balance < value + maxFee ? 'error' : 'review')
    if (state.status === 'error') {
      assert.match(state.message ?? '', /balance must cover the amount and network fees/i)
      assert.match(state.message ?? '', /smaller amount or add funds/i)
      await transfer.confirm()
    }
    assert.equal(f.calls.sign, 0)
    assert.equal(f.calls.send, 0)
  }
})

test('failed estimation retains balance and amount without inventing fees or funding diagnosis', async () => {
  for (const error of ['AA13 initCode failed', 'fetch timed out; initCode: 0x123; prefund calculation unavailable', 'AA21 did not pay prefund']) {
    const f = fixture()
    const balance = error.startsWith('AA21') ? 10_000_000_000_000n : 1_000_000_000_000_000n
    f.deps.balance = async () => balance
    f.deps.quote = async () => { throw new Error(error) }
    const transfer = createTransfer(prepared, f.deps)
    await transfer.prepare(recipient, '0.00001')
    const state = get(transfer)
    assert.equal(state.status, 'error')
    assert.ok('funding' in state)
    assert.deepEqual(state.funding, { value: 10_000_000_000_000n, balance, maxFee: null })
    if (error.startsWith('AA13')) assert.match(state.message ?? '', /could not be deployed/)
    if (error.startsWith('fetch')) assert.match(state.message ?? '', /service could not confirm/)
    if (error.startsWith('AA21')) assert.match(state.message ?? '', /balance must cover/)
    await transfer.confirm()
    assert.equal(f.calls.sign, 0)
    assert.equal(f.calls.send, 0)
  }
})

test('balance lookup failure blocks preparation without reusing a stale displayed balance', async () => {
  const f = fixture()
  const transfer = createTransfer(prepared, f.deps)
  await transfer.refreshBalance()
  f.deps.balance = async () => { throw new Error('fetch failed') }
  await transfer.prepare(recipient, '0.00001')
  const state = get(transfer)
  assert.equal(state.status, 'error')
  assert.ok('funding' in state)
  assert.deepEqual(state.funding, { value: 10_000_000_000_000n, balance: null, maxFee: null })
  assert.equal(f.calls.quote, 0)
  assert.equal(f.calls.send, 0)
})

test('balance dropping after review blocks submission and leaves no pending marker', async () => {
  const f = fixture()
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  assert.equal(get(transfer).status, 'review')
  f.deps.balance = async () => 10_000_000_000_000n
  await transfer.confirm()
  assert.equal(get(transfer).status, 'error')
  assert.match(get(transfer).message ?? '', /balance must cover/)
  assert.equal(f.calls.send, 0)
  assert.equal(f.saved.size, 0)
})

test('RPC failure after signing identifies the balance check and leaves no submission', async () => {
  const f = fixture()
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  assert.equal(get(transfer).status, 'review')
  f.deps.balance = async () => { throw new Error('fetch failed https://provider?apikey=secret') }
  await transfer.confirm()
  const state = get(transfer)
  assert.equal(state.status, 'error')
  assert.match(state.message ?? '', /Base Sepolia RPC could not verify your balance/)
  assert.match(state.message ?? '', /No operation was submitted/)
  assert.doesNotMatch(state.message ?? '', /authorize or save|provider|apikey|secret/)
  assert.equal(state.submission, null)
  assert.equal(f.calls.sign, 1)
  assert.equal(f.calls.send, 0)
  assert.equal(f.saved.size, 0)
})

test('cancellation during the final balance check cannot submit a signed operation', async () => {
  const f = fixture()
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  let finish!: (balance: bigint) => void
  let started!: () => void
  const checking = new Promise<void>((resolve) => { started = resolve })
  f.deps.balance = async () => { started(); return new Promise((resolve) => { finish = resolve }) }
  const sending = transfer.confirm()
  await checking
  transfer.cancel()
  finish(1_000_000_000_000_000n)
  await sending
  assert.equal(get(transfer).status, 'cancelled')
  assert.equal(f.calls.send, 0)
  assert.equal(f.saved.size, 0)
})

test('zero fee estimates cannot promise a free transfer', async () => {
  const f = fixture()
  const baseQuote = f.deps.quote
  f.deps.quote = async (...args) => ({ ...await baseQuote(...args), operation: { ...operation, maxFeePerGas: 0n } })
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  assert.equal(get(transfer).status, 'error')
  assert.match(get(transfer).message ?? '', /fee estimate is unavailable/)
  assert.equal(get(transfer).funding?.maxFee, null)
  await transfer.confirm()
  assert.equal(f.calls.sign, 0)
  assert.equal(f.calls.send, 0)
})

test('viem accountless submission serializes exactly the signed fields without another preparation', async () => {
  const requests: { method: string; params?: unknown }[] = []
  const bundler = createBundlerClient({ transport: custom({ request: async (request) => {
    requests.push(request)
    assert.equal(request.method, 'eth_sendUserOperation', 'No nonce, gas, fee or paymaster lookups after signing')
    return hash
  } }) })
  const signed = { ...operation, signature }
  const boundBundler = { ...bundler, account: { signUserOperation: async () => assert.fail('Do not sign again') } } as unknown as Parameters<typeof sendSignedOperation>[0]
  const result = await sendSignedOperation(boundBundler, signed)
  assert.equal(result, hash)
  assert.deepEqual(requests, [{ method: 'eth_sendUserOperation', params: [{
    sender, nonce: '0x1', initCode: '0x', callData: '0x1234', callGasLimit: '0x14',
    verificationGasLimit: '0xc3500', preVerificationGas: '0xa', maxFeePerGas: '0x3',
    maxPriorityFeePerGas: '0x1', paymasterAndData: '0x', signature,
  }, entryPoint06Address] }])
})

test('a pending submission created by another tab is rechecked after signing and never resubmitted', async () => {
  const f = fixture()
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  f.saved.set(`whirm-transfer:84532:${sender}`, JSON.stringify({ hash, recipient, amount: '0.00001' }))
  await transfer.confirm()
  assert.equal(f.calls.send, 0)
  assert.equal(get(transfer).status, 'success')
})

test('corrupt persisted pending details block preparation before any account or bundler operation', async () => {
  const f = fixture()
  f.saved.set(`whirm-transfer:84532:${sender}`, 'invalid JSON')
  const transfer = createTransfer(prepared, f.deps)
  assert.equal(get(transfer).status, 'error')
  await transfer.prepare(recipient, '0.00001')
  assert.equal(get(transfer).status, 'error')
  assert.equal(f.calls.quote, 0)
  assert.equal(f.calls.sign, 0)
  assert.equal(f.calls.send, 0)
})

test('provider diagnostics never expose raw service URLs or credentials in the transfer UI', async () => {
  const f = fixture()
  f.deps.quote = async () => { throw new Error('The provider at https://secret.example/?key=private rejected request') }
  const transfer = createTransfer(prepared, f.deps)
  await transfer.prepare(recipient, '0.00001')
  assert.equal(get(transfer).status, 'error')
  assert.doesNotMatch(get(transfer).message ?? '', /secret|private|https:/)
})

test('a late initial balance lookup cannot overwrite the refreshed post-transfer balance', async () => {
  const f = fixture()
  let balanceCalls = 0
  let finish!: (balance: bigint) => void
  f.deps.balance = async () => {
    balanceCalls++
    if (balanceCalls === 1) return new Promise<bigint>((resolve) => { finish = resolve })
    return balanceCalls <= 4 ? 1_000_000_000_000_000n : 900_000_000_000_000n
  }
  const transfer = createTransfer(prepared, f.deps)
  const initial = transfer.refreshBalance()
  await transfer.prepare(recipient, '0.00001')
  await transfer.confirm()
  assert.equal(get(transfer).balance, 900_000_000_000_000n)
  finish(1_000_000_000_000_000n)
  await initial
  assert.equal(get(transfer).balance, 900_000_000_000_000n)
})

test('an old receipt lookup cannot erase a newer pending marker created by another tab', async () => {
  const f = fixture()
  const key = `whirm-transfer:84532:${sender}`
  f.saved.set(key, JSON.stringify({ hash, recipient, amount: '0.00001' }))
  let finish!: (result: UserOperationReceipt<'0.6'>) => void
  f.deps.receipt = async () => new Promise((resolve) => { finish = resolve })
  const transfer = createTransfer(prepared, f.deps)
  const checking = transfer.checkReceipt()
  const newer = { hash: txHash, recipient, amount: '0.00002' }
  f.saved.set(key, JSON.stringify(newer))
  finish(receipt())
  await checking
  assert.deepEqual(JSON.parse(f.saved.get(key)!), newer)
  await transfer.prepare(recipient, '0.00001')
  assert.equal(get(transfer).status, 'pending')
  assert.equal(get(transfer).submission?.hash, txHash)
  assert.equal(f.calls.send, 0)
})
