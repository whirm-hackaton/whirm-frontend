<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { formatEther } from 'viem'
  import { Button } from '$lib/components/ui/button'
  import { createTransfer } from './transactions'
  import { networkUnavailableReason } from './network'
  import type { PreparedPasskey } from './passkey'

  let { prepared }: { prepared: PreparedPasskey } = $props()
  const transfer = untrack(() => createTransfer(prepared))
  const unavailable = networkUnavailableReason()
  let recipient = $state('')
  let amount = $state('')
  let reviewHeading = $state<HTMLHeadingElement>()
  const locked = $derived(['preparing', 'review', 'signing', 'sending', 'pending'].includes($transfer.status))
  const busy = $derived(['preparing', 'signing', 'sending'].includes($transfer.status))
  const receiptJson = $derived($transfer.receipt ? JSON.stringify($transfer.receipt, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) : '')

  $effect(() => { if ($transfer.status === 'review') reviewHeading?.focus() })
  onMount(() => { void transfer.refreshBalance() })
  onDestroy(() => transfer.destroy())
</script>

<section lang="en" aria-labelledby="transfer-title" class="mt-6 space-y-5 border-t pt-6" aria-busy={busy}>
  <h2 id="transfer-title" class="text-2xl">Send test ETH</h2>
  <p class="text-sm">Base Sepolia (84532). This wallet pays its network fees in test ETH; sponsoring is not enabled.</p>
  <div class="flex flex-wrap items-center gap-3">
    <p>Balance: {$transfer.balance === null ? 'Not loaded' : `${formatEther($transfer.balance)} ETH`}</p>
    <Button variant="outline" disabled={busy} onclick={() => transfer.refreshBalance()}>Refresh balance</Button>
  </div>
  {#if $transfer.balanceMessage}<p role="status" class="text-sm">{$transfer.balanceMessage}</p>{/if}
  {#if unavailable}<p role="status" class="rounded-lg border p-4">{unavailable}</p>{/if}

  <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void transfer.prepare(recipient.trim(), amount.trim()) }}>
    <div class="space-y-2">
      <label for="transfer-recipient" class="block font-semibold">Recipient address</label>
      <input id="transfer-recipient" bind:value={recipient} required disabled={locked || !!unavailable} autocomplete="off" spellcheck="false" class="w-full min-w-0 rounded-md border bg-background px-3 py-2 font-mono text-sm" placeholder="0x…" />
    </div>
    <div class="space-y-2">
      <label for="transfer-amount" class="block font-semibold">Amount in ETH</label>
      <input id="transfer-amount" bind:value={amount} required disabled={locked || !!unavailable} inputmode="decimal" autocomplete="off" aria-describedby="amount-help" class="w-full min-w-0 rounded-md border bg-background px-3 py-2" placeholder="0.00001" />
      <p id="amount-help" class="text-sm text-muted-foreground">Use a decimal point, with up to 18 decimal places. Keep enough ETH for fees.</p>
    </div>
    <Button type="submit" disabled={locked || !!unavailable}>Review transfer and fees</Button>
  </form>

  {#if $transfer.quote && ['review', 'signing'].includes($transfer.status)}
    <div class="space-y-4 rounded-lg border bg-accent p-4">
      <h3 tabindex="-1" bind:this={reviewHeading} class="text-xl outline-none">Confirm transfer details</h3>
      <dl class="space-y-3">
        <div><dt>From</dt><dd class="break-all font-mono text-sm">{prepared.address}</dd></div>
        <div><dt>Recipient</dt><dd class="break-all font-mono text-sm">{$transfer.quote.recipient}</dd></div>
        <div><dt>Amount</dt><dd>{formatEther($transfer.quote.value)} ETH</dd></div>
        <div><dt>Network</dt><dd>Base Sepolia (84532)</dd></div>
        <div><dt>Maximum network fee paid by this wallet</dt><dd>{formatEther($transfer.quote.maxFee)} ETH</dd></div>
        <div><dt>Maximum total</dt><dd>{formatEther($transfer.quote.value + $transfer.quote.maxFee)} ETH</dd></div>
      </dl>
      <p class="text-sm">Approve only if the recipient and amount are correct. A fresh passkey signature authorizes this operation. This does not verify your bank association.</p>
      <Button disabled={$transfer.status !== 'review'} onclick={() => transfer.confirm()}>Authorize and send with my passkey</Button>
    </div>
  {/if}

  {#if $transfer.message}
    <p role={['error', 'failed'].includes($transfer.status) ? 'alert' : 'status'} aria-live="polite" class="rounded-lg border bg-secondary p-4">{$transfer.message}</p>
  {/if}
  {#if ['preparing', 'review', 'signing'].includes($transfer.status)}
    <Button variant="outline" onclick={() => transfer.cancel()}>Cancel transfer</Button>
  {/if}
  {#if $transfer.submission}
    <dl class="space-y-3 text-sm">
      <div><dt>Submitted recipient</dt><dd class="break-all font-mono">{$transfer.submission.recipient}</dd></div>
      <div><dt>Submitted amount</dt><dd>{$transfer.submission.amount} ETH</dd></div>
      <div><dt>UserOperation hash (not the transaction hash)</dt><dd class="break-all font-mono">{$transfer.submission.hash}</dd></div>
      {#if $transfer.receipt}
        <div><dt>Blockchain transaction hash</dt><dd class="break-all font-mono"><a class="underline" href={`https://sepolia.basescan.org/tx/${$transfer.receipt.receipt.transactionHash}`} target="_blank" rel="noreferrer">{$transfer.receipt.receipt.transactionHash}</a></dd></div>
        <div><dt>Operation execution</dt><dd>{$transfer.receipt.success && $transfer.receipt.receipt.status === 'success' ? 'Succeeded' : 'Failed'}</dd></div>
        <div><dt>Actual network cost</dt><dd>{formatEther($transfer.receipt.actualGasCost)} ETH</dd></div>
      {/if}
    </dl>
    {#if $transfer.status === 'pending'}
      <Button variant="outline" disabled={$transfer.checking} onclick={() => transfer.checkReceipt()}>{$transfer.checking ? 'Checking receipt…' : 'Check execution receipt'}</Button>
      <a class="block text-sm underline" href={`https://sepolia.basescan.org/address/${prepared.address}`} target="_blank" rel="noreferrer">Inspect wallet activity on Base Sepolia</a>
    {/if}
  {/if}
  {#if receiptJson}
    <details class="rounded-lg border p-4"><summary class="cursor-pointer">Execution receipt evidence</summary><pre class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{receiptJson}</pre></details>
  {/if}
</section>
