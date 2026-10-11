/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseEther } from 'viem'
import { formatEth } from './format.js'

test('ETH presentation retains tiny and exact amounts without exponents', () => {
  for (const [value, expected] of [
    [0n, '0 ETH'], [1n, '0.000000000000000001 ETH'],
    [parseEther('0.0004'), '0.0004 ETH'], [parseEther('1.2300'), '1.23 ETH'],
    [parseEther('0.0000071613843'), '≈ 0.00000716139 ETH'],
    [parseEther('0.0004071613843'), '≈ 0.000407162 ETH'],
    [parseEther('999999.999999999999999999'), '≈ 1000000 ETH'],
    [parseEther('12345678901234567890.123456789012345678'), '≈ 12345700000000000000 ETH'],
  ] as const) assert.equal(formatEth(value), expected)
})

test('approximate ceilings never understate exact bigint values', () => {
  for (let digits = 1; digits <= 78; digits++) {
    for (const value of [10n ** BigInt(digits), 10n ** BigInt(digits) + 1n, 10n ** BigInt(digits) - 1n]) {
      const display = formatEth(value)
      const shown = parseEther(display.replace('≈ ', '').replace(' ETH', ''))
      assert.ok(shown >= value)
      assert.equal(display.startsWith('≈ '), shown !== value)
      assert.ok(shown > 0n)
      assert.doesNotMatch(display, /[eE][+-]?\d/)
    }
  }
})
