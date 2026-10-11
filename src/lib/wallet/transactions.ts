import { writable } from 'svelte/store'
import { getAddress, isAddress, parseEther, zeroAddress, type Address, type Hex } from 'viem'
import { entryPoint06Address, getUserOperationHash, sendUserOperation, type UserOperation, type UserOperationReceipt } from 'viem/account-abstraction'
import { passkeyRequestRejected, toPasskeyAccount, type PreparedPasskey } from './passkey.js'
import { createPrefundedBundler, networkError, networkUnavailableReason, publicClient } from './network.js'

class TransferError extends Error {}

type Operation = UserOperation<'0.6'>
type Account = Pick<Awaited<ReturnType<typeof toPasskeyAccount>>, 'address' | 'signUserOperation'>
type Submission = { hash: Hex; recipient: Address; amount: string }
type Quote = { recipient: Address; amount: string; value: bigint; maxFee: bigint; operation: Operation }
export type TransferState = {
  status: 'idle' | 'preparing' | 'review' | 'signing' | 'sending' | 'pending' | 'success' | 'failed' | 'error' | 'cancelled'
  balance: bigint | null
  balanceMessage: string | null
  message: string | null
  quote: Quote | null
  submission: Submission | null
  receipt: UserOperationReceipt<'0.6'> | null
  checking: boolean
}
export type TransferDependencies = {
  account: (prepared: PreparedPasskey, signal: AbortSignal) => Promise<Account>
  quote: (account: Account, recipient: Address, value: bigint) => Promise<{
    operation: Operation
    send: (operation: Operation) => Promise<Hex>
    receipt: (hash: Hex) => Promise<UserOperationReceipt<'0.6'>>
  }>
  balance: (address: Address) => Promise<bigint>
  receipt: (hash: Hex) => Promise<UserOperationReceipt<'0.6'>>
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  lock: (action: () => Promise<void>) => Promise<void>
  unavailable: () => string | null
}

export function transferDetails(recipient: string, amount: string, sender: Address) {
  if (!isAddress(recipient, { strict: true }) || getAddress(recipient) === zeroAddress) throw new TransferError('Enter a valid, nonzero Ethereum recipient address.')
  const address = getAddress(recipient)
  if (address.toLowerCase() === sender.toLowerCase()) throw new TransferError('Choose a recipient other than this wallet.')
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount)) throw new TransferError('Enter an ETH amount with at most 18 decimal places. Exponents and commas are not accepted.')
  const value = parseEther(amount)
  if (value <= 0n) throw new TransferError('Enter an ETH amount greater than zero.')
  return { recipient: address, amount, value }
}

export function sendSignedOperation(bundler: Parameters<typeof sendUserOperation>[0], operation: Operation) {
  return sendUserOperation({ ...bundler, account: undefined }, { ...operation, account: undefined, entryPointAddress: entryPoint06Address })
}

export function submissionRejected(error: unknown) {
  let cause = error
  for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
    if ('code' in cause && typeof cause.code === 'number' && (cause.code === -32602 || (cause.code <= -32500 && cause.code >= -32510))) return true
    cause = 'cause' in cause ? cause.cause : undefined
  }
  return false
}

export function createTransfer(prepared: PreparedPasskey, dependencies?: TransferDependencies) {
  const key = `whirm-transfer:84532:${prepared.address.toLowerCase()}`
  const deps: TransferDependencies = dependencies ?? {
    account: (settings, signal) => toPasskeyAccount(settings.passkey, signal),
    quote: async (account, recipient, value) => {
      const bundler = await createPrefundedBundler(account as Awaited<ReturnType<typeof toPasskeyAccount>>)
      const operation = await bundler.prepareUserOperation({ calls: [{ to: recipient, value }] }) as Operation
      return { operation,
        // All reviewed fields and the real signature are supplied; no second preparation changes the signed quote.
        send: (signed) => sendSignedOperation(bundler, signed),
        receipt: (hash) => bundler.waitForUserOperationReceipt({ hash, timeout: 45_000 }),
      }
    },
    balance: (address) => publicClient.getBalance({ address }),
    receipt: async (hash) => {
      // Receipt lookup uses the same validated relay as preparation, without asking for another passkey.
      const account = await toPasskeyAccount(prepared.passkey)
      const bundler = await createPrefundedBundler(account)
      return bundler.waitForUserOperationReceipt({ hash, timeout: 45_000 })
    },
    get storage() { return localStorage },
    lock: async (action) => {
      if (!navigator.locks) throw new Error('This browser cannot coordinate transfers safely. Use a browser with Web Locks support.')
      await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('A transfer is already being submitted in another tab. Check its receipt before continuing.')
        await action()
      })
    },
    unavailable: networkUnavailableReason,
  }
  let current: TransferState = { status: 'idle', balance: null, balanceMessage: null, message: null, quote: null, submission: null, receipt: null, checking: false }
  const state = writable(current)
  let controller: AbortController | undefined
  let attempt: { account: Account; send: (operation: Operation) => Promise<Hex>; receipt: (hash: Hex) => Promise<UserOperationReceipt<'0.6'>> } | undefined
  let destroyed = false
  let balancePending = false
  function update(next: Partial<TransferState>) {
    current = { ...current, ...next }
    if (!destroyed) state.set(current)
  }
  function savedSubmission(): Submission | null {
    const raw = deps.storage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('hash' in value) || typeof value.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value.hash)
      || !('recipient' in value) || typeof value.recipient !== 'string' || !('amount' in value) || typeof value.amount !== 'string') throw new Error('Saved transfer details are invalid. Check this wallet on the explorer before sending again.')
    const details = transferDetails(value.recipient, value.amount, prepared.address)
    return { hash: value.hash as Hex, recipient: details.recipient, amount: details.amount }
  }
  try {
    const submission = savedSubmission()
    if (submission) update({ status: 'pending', submission, message: 'A previous submission needs a receipt check. Sending is blocked until its outcome is known.' })
  } catch { update({ status: 'error', message: 'Unable to read saved transfer details. Restore browser storage and check the explorer before sending again.' }) }

  async function refreshBalance() {
    if (destroyed || balancePending) return
    balancePending = true
    try { const balance = await deps.balance(prepared.address); if (!destroyed) update({ balance, balanceMessage: null }) }
    catch { if (!destroyed) update({ balanceMessage: 'Unable to load the Base Sepolia balance. Try refreshing.' }) }
    finally { balancePending = false }
  }

  async function checkReceipt() {
    if (destroyed || current.checking || !current.submission || !['pending', 'sending'].includes(current.status)) return
    const submission = current.submission
    update({ checking: true })
    try {
      const receipt = await (attempt?.receipt ?? deps.receipt)(submission.hash)
      if (receipt.userOpHash.toLowerCase() !== submission.hash.toLowerCase() || receipt.sender.toLowerCase() !== prepared.address.toLowerCase()
        || receipt.entryPoint.toLowerCase() !== entryPoint06Address.toLowerCase() || typeof receipt.success !== 'boolean'
        || !/^0x[0-9a-f]{64}$/i.test(receipt.receipt.transactionHash) || !['success', 'reverted'].includes(receipt.receipt.status)) throw new Error('Invalid receipt')
      const success = receipt.success && receipt.receipt.status === 'success'
      deps.storage.removeItem(key)
      update({ receipt, status: success ? 'success' : 'failed', message: success ? 'Transfer confirmed successfully on Base Sepolia.' : 'The operation was included but failed. The ETH transfer was not confirmed; network fees may have been charged.' })
      await refreshBalance()
    } catch { update({ status: 'pending', message: 'The outcome is still unknown. Check the receipt again or inspect the explorer. Do not send the transfer again.' }) }
    finally { update({ checking: false }) }
  }

  async function prepare(recipient: string, amount: string) {
    if (destroyed || ['preparing', 'review', 'signing', 'sending', 'pending'].includes(current.status)) return
    const next = new AbortController()
    controller = next
    attempt = undefined
    update({ status: 'preparing', message: null, quote: null, receipt: null, submission: null })
    try {
      const existing = savedSubmission()
      if (existing) { update({ status: 'pending', submission: existing, message: 'Another submission needs a receipt check before sending.' }); return }
      const unavailable = deps.unavailable()
      if (unavailable) throw new TransferError(unavailable)
      const details = transferDetails(recipient, amount, prepared.address)
      const account = await deps.account(prepared, next.signal)
      next.signal.throwIfAborted()
      if (account.address.toLowerCase() !== prepared.address.toLowerCase()) throw new TransferError('The passkey account does not match this wallet.')
      const quoted = await deps.quote(account, details.recipient, details.value)
      next.signal.throwIfAborted()
      const operation = quoted.operation
      if (operation.sender.toLowerCase() !== prepared.address.toLowerCase() || (operation.paymasterAndData && operation.paymasterAndData !== '0x')) throw new TransferError('The operation does not match the prefunded account.')
      const maxFee = (operation.callGasLimit + operation.verificationGasLimit + operation.preVerificationGas) * operation.maxFeePerGas
      const balance = await deps.balance(prepared.address)
      next.signal.throwIfAborted()
      if (maxFee <= 0n || balance < details.value + maxFee) throw new TransferError('The wallet needs enough Base Sepolia ETH for the amount and maximum network fee.')
      if (destroyed || controller !== next) return
      attempt = { account, send: quoted.send, receipt: quoted.receipt }
      update({ status: 'review', balance, balanceMessage: null, quote: { ...details, maxFee, operation } })
    } catch (error) {
      if (!destroyed && controller === next) update({ status: next.signal.aborted ? 'cancelled' : 'error', message: error instanceof TransferError ? error.message : networkError(error) })
    }
  }

  async function confirm() {
    if (destroyed || current.status !== 'review' || !current.quote || !attempt || !controller) return
    const quote = current.quote
    const signing = attempt
    const active = controller
    update({ status: 'signing', message: 'Authorize this exact transfer with your passkey.' })
    try {
      // Keep signing first: mobile providers require the confirmation click's user activation.
      const signature = await signing.account.signUserOperation({ ...quote.operation, chainId: 84532 })
      active.signal.throwIfAborted()
      if (destroyed || controller !== active) return
      const operation = { ...quote.operation, signature }
      const hash = getUserOperationHash({ chainId: 84532, entryPointAddress: entryPoint06Address, entryPointVersion: '0.6', userOperation: operation })
      await deps.lock(async () => {
        active.signal.throwIfAborted()
        const existing = savedSubmission()
        if (existing) { update({ status: 'pending', submission: existing, message: 'Another submission needs a receipt check before sending.' }); return }
        const submission = { hash, recipient: quote.recipient, amount: quote.amount }
        deps.storage.setItem(key, JSON.stringify(submission))
        update({ status: 'sending', submission, message: 'Submitting the signed operation. It can no longer be cancelled safely.' })
        try {
          const returnedHash = await signing.send(operation)
          if (returnedHash.toLowerCase() !== hash.toLowerCase()) throw new Error('Bundler returned an unexpected hash')
          update({ status: 'pending', message: 'Operation submitted. Waiting for its execution receipt…' })
        } catch (error) {
          if (submissionRejected(error)) {
            deps.storage.removeItem(key)
            update({ status: 'failed', message: 'The bundler rejected this operation before acceptance. No transfer was confirmed. Review the recipient, balance and fees before trying again.' })
          } else update({ status: 'pending', message: 'Submission has an uncertain result. Keep the operation hash and check its receipt before sending again.' })
        }
      })
      if (current.submission && !destroyed) await checkReceipt()
    } catch (error) {
      if (!destroyed && controller === active) update({ status: passkeyRequestRejected(error) ? 'cancelled' : 'error', message: passkeyRequestRejected(error)
        ? 'Passkey authorization cancelled or refused. No operation was submitted.'
        : 'Unable to authorize or save this transfer. No operation was submitted. Review it again before retrying.' })
    }
  }

  return { subscribe: state.subscribe, prepare, confirm, checkReceipt, refreshBalance,
    cancel() {
      if (!['preparing', 'review', 'signing'].includes(current.status)) return
      controller?.abort()
      controller = undefined
      attempt = undefined
      update({ status: 'cancelled', quote: null, message: 'Transfer cancelled before submission.' })
    },
    destroy() { destroyed = true; controller?.abort() },
  }
}
