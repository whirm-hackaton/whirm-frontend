import { createClient, createPublicClient, http, rpcSchema, type Hex } from 'viem'
import { createBundlerClient, entryPoint06Address } from 'viem/account-abstraction'
import { baseSepolia } from 'viem/chains'
import { env } from '../env.js'
import type { toPasskeyAccount } from './passkey.js'

type PimlicoRpcSchema = [{
  Method: 'pimlico_getUserOperationGasPrice'
  Parameters: []
  ReturnType: { standard: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } }
}]

class NetworkError extends Error {}

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(env.BASE_SEPOLIA_RPC_URL, { fetchOptions: { credentials: 'omit' }, retryCount: 0, timeout: 15_000 }),
})

export function walletServiceUnavailableReason(serviceUrl: string): string | null {
  if (!serviceUrl) return 'The wallet service is not configured. Transfers are unavailable.'
  try {
    const service = new URL(serviceUrl)
    if (service.protocol !== 'https:' || service.username || service.password || service.search || service.hash) {
      return 'The wallet service must use a public HTTPS URL without credentials, query parameters or a fragment.'
    }
    return null
  } catch {
    return 'The wallet service URL is invalid. Transfers are unavailable.'
  }
}

export function networkUnavailableReason() {
  return walletServiceUnavailableReason(env.BUNDLER_URL)
}

export async function createPrefundedBundler(account: Awaited<ReturnType<typeof toPasskeyAccount>>) {
  const reason = networkUnavailableReason()
  if (reason) throw new NetworkError(reason)
  if (account.entryPoint.version !== '0.6' || account.entryPoint.address.toLowerCase() !== entryPoint06Address.toLowerCase()) {
    throw new NetworkError('This wallet requires the Coinbase EntryPoint 0.6 configuration. Sending is blocked.')
  }
  const transport = http(env.BUNDLER_URL, {
    fetchOptions: { credentials: 'omit' }, retryCount: 0, timeout: 15_000,
  })
  const pimlico = createClient({ chain: baseSepolia, transport, rpcSchema: rpcSchema<PimlicoRpcSchema>() })
  const bundler = createBundlerClient({
    account, client: publicClient, transport,
    // The public endpoint allows 20 requests/minute/IP; leave room for preparation and submission.
    pollingInterval: 6_000,
    userOperation: {
      async estimateFeesPerGas() {
        const result = await pimlico.request({ method: 'pimlico_getUserOperationGasPrice', params: [] })
        const fees = result?.standard
        const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i
        if (!fees || typeof fees.maxFeePerGas !== 'string' || typeof fees.maxPriorityFeePerGas !== 'string'
          || !quantity.test(fees.maxFeePerGas) || !quantity.test(fees.maxPriorityFeePerGas)) {
          throw new NetworkError('The bundler returned invalid gas prices. Sending is blocked.')
        }
        const maxFeePerGas = BigInt(fees.maxFeePerGas)
        const maxPriorityFeePerGas = BigInt(fees.maxPriorityFeePerGas)
        if (maxFeePerGas <= 0n || maxPriorityFeePerGas > maxFeePerGas) {
          throw new NetworkError('The bundler returned invalid gas prices. Sending is blocked.')
        }
        return { maxFeePerGas, maxPriorityFeePerGas }
      },
    },
  })
  const [rpcChain, bundlerChain, entryPoints] = await Promise.all([
    publicClient.getChainId(), bundler.getChainId(), bundler.getSupportedEntryPoints(),
  ])
  if (rpcChain !== baseSepolia.id || bundlerChain !== baseSepolia.id) {
    throw new NetworkError('The RPC and bundler must both use Base Sepolia (84532). Sending is blocked.')
  }
  if (!Array.isArray(entryPoints) || !entryPoints.some((address) => typeof address === 'string' && address.toLowerCase() === entryPoint06Address.toLowerCase())) {
    throw new NetworkError('The bundler does not support Coinbase EntryPoint 0.6. Sending is blocked.')
  }
  return bundler
}

export function networkError(error: unknown, submittedHash?: Hex): string {
  if (submittedHash) return 'The operation was submitted, but its final result is unknown. Check its status before sending again.'
  if (error instanceof NetworkError) return error.message
  // Inspect provider diagnostics for classification, never display raw URLs or response bodies.
  const messages: string[] = []
  let cause: unknown = error
  for (let depth = 0; depth < 10 && cause && typeof cause === 'object'; depth++) {
    if ('status' in cause && (cause.status === 401 || cause.status === 403)) return 'The wallet service refused access. Check its public endpoint configuration.'
    if ('status' in cause && cause.status === 429) return 'The wallet service rate limit was reached. Wait before trying again.'
    if ('message' in cause && typeof cause.message === 'string') messages.push(cause.message)
    cause = 'cause' in cause ? cause.cause : null
  }
  const diagnostic = messages.join(' ')
  if (/\bAA1[345]\b|initCode (?:failed|must|does not)|Failed to simulate deployment/i.test(diagnostic)) return 'The smart account could not be deployed. Check its factory configuration and deployment diagnostics before trying again.'
  if (/\bAA31\b/i.test(diagnostic)) return 'The paymaster deposit is too low. This wallet uses its own ETH for fees; check the bundler configuration before trying again.'
  if (/\bAA21\b|insufficient funds|does not have sufficient funds|did not pay prefund/i.test(diagnostic)) return 'Your balance must cover the amount and network fees. Send a smaller amount or add funds to your wallet.'
  if (/AA24|invalid signature|signature.*invalid/i.test(diagnostic)) return 'The wallet signature was rejected. Reopen the same wallet and try again.'
  if (/revert|AA23/i.test(diagnostic)) return 'The operation was rejected by the network. Check the recipient, amount and wallet balance.'
  if (/timeout|timed out|network|fetch|HTTP/i.test(diagnostic)) return 'The wallet service could not confirm this request. Check operation status before retrying a send.'
  return 'The wallet service rejected this request. Check your connection and operation status before trying again.'
}
