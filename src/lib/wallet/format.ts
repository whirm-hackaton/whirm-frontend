import { formatEther } from 'viem'

export function formatEth(value: bigint): string {
  const digits = (value < 0n ? -value : value).toString().length
  const step = 10n ** BigInt(Math.max(0, digits - 6))
  // Round upward so a displayed fee ceiling never understates the signed maximum.
  const rounded = value >= 0n ? ((value + step - 1n) / step) * step : (value / step) * step
  return `${rounded === value ? '' : '≈ '}${formatEther(rounded)} ETH`
}
