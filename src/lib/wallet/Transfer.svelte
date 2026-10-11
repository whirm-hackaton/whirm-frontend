<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { formatEther } from 'viem'
  import { Button } from '$lib/components/ui/button'
  import { createTransfer } from './transactions'
  import { networkUnavailableReason } from './network'
  import type { PreparedPasskey } from './passkey'

  let { prepared, metadataRefreshing = false, onActivityChange }: {
    prepared: PreparedPasskey
    metadataRefreshing?: boolean
    onActivityChange?: (active: boolean) => void
  } = $props()
  const transfer = untrack(() => createTransfer(prepared))
  const unavailable = networkUnavailableReason()
  let recipient = $state('')
  let amount = $state('')
  let newTransfer = $state(false)
  let stageHeading = $state<HTMLHeadingElement>()
  const locked = $derived(['preparing', 'review', 'signing', 'sending', 'pending'].includes($transfer.status))
  const busy = $derived(['preparing', 'signing', 'sending'].includes($transfer.status))
  const stage = $derived(newTransfer ? 'form' : ['review', 'signing'].includes($transfer.status) ? 'review'
    : ['sending', 'pending'].includes($transfer.status) ? 'pending'
    : ['success', 'failed'].includes($transfer.status) ? 'result' : 'form')
  const heading = $derived(stage === 'review' ? 'Review transfer' : stage === 'pending' ? 'Transfer in progress'
    : stage === 'result' ? ($transfer.status === 'success' ? 'Transfer confirmed' : 'Transfer not confirmed') : 'Send ETH')
  const receiptJson = $derived($transfer.receipt ? JSON.stringify($transfer.receipt, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) : '')

  // Report synchronously so metadata refresh cannot start between a click and the next render.
  const stopActivity = untrack(() => transfer.subscribe((state) => {
    onActivityChange?.(['preparing', 'review', 'signing', 'sending', 'pending'].includes(state.status))
  }))
  let previousStage: string | undefined
  $effect(() => {
    const currentStage = stage
    if (previousStage !== undefined && previousStage !== currentStage) stageHeading?.focus()
    previousStage = currentStage
  })

  function prepareTransfer(event: SubmitEvent) {
    event.preventDefault()
    if (metadataRefreshing || locked || unavailable) return
    newTransfer = false
    void transfer.prepare(recipient.trim(), amount.trim())
  }

  async function cancelTransfer() {
    transfer.cancel()
    await tick()
    stageHeading?.focus()
  }

  function startNewTransfer() {
    if (!['success', 'failed'].includes($transfer.status) || $transfer.checking) return
    newTransfer = true
  }

  onMount(() => { void transfer.refreshBalance() })
  onDestroy(() => {
    stopActivity()
    transfer.destroy()
    onActivityChange?.(false)
  })
</script>

<section lang="en" aria-labelledby="transfer-title" class="mt-6 max-w-[640px] space-y-6 border-t pt-6" aria-busy={busy}>
  {#if stage === 'form'}
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0">
        <p class="text-sm text-muted-foreground">Available balance</p>
        <p class="balance-value break-all tabular-nums">{$transfer.balance === null ? 'Not loaded' : `${formatEther($transfer.balance)} ETH`}</p>
      </div>
      <Button variant="outline" disabled={busy} onclick={() => { if (!busy) void transfer.refreshBalance() }}>Refresh balance</Button>
    </div>
    {#if $transfer.balanceMessage}<p role="status" class="notice">{$transfer.balanceMessage}</p>{/if}
  {/if}

  <h2 id="transfer-title" tabindex="-1" bind:this={stageHeading} class="section-title">{heading}</h2>

  {#if stage === 'form'}
    {#if unavailable}<p role="status" class="notice">{unavailable}</p>{/if}
    <form class="space-y-6" onsubmit={prepareTransfer}>
      <div class="space-y-2">
        <label for="transfer-recipient" class="block font-semibold">Recipient address</label>
        <input id="transfer-recipient" bind:value={recipient} required disabled={locked || !!unavailable || metadataRefreshing} autocomplete="off" spellcheck="false" class="field-input font-mono" placeholder="0x…" />
      </div>
      <div class="space-y-2">
        <label for="transfer-amount" class="block font-semibold">Amount in ETH</label>
        <input id="transfer-amount" bind:value={amount} required disabled={locked || !!unavailable || metadataRefreshing} inputmode="decimal" autocomplete="off" aria-describedby="amount-help" class="field-input" placeholder="0.00001" />
        <p id="amount-help" class="text-sm text-muted-foreground">Use a decimal point, with up to 18 decimal places. Keep enough test ETH for network fees.</p>
      </div>
      {#if metadataRefreshing}<p role="status" class="notice">Wait for wallet details to finish refreshing before reviewing a transfer.</p>{/if}
      <div class="action-row">
        <Button type="submit" class="w-full sm:w-auto" disabled={locked || !!unavailable || metadataRefreshing}>{$transfer.status === 'preparing' ? 'Preparing transfer…' : 'Review transfer'}</Button>
        {#if $transfer.status === 'preparing'}<Button variant="outline" onclick={cancelTransfer}>Cancel transfer</Button>{/if}
      </div>
    </form>
  {:else if stage === 'review' && $transfer.quote}
    <dl class="financial-summary">
      <div><dt>Recipient</dt><dd class="font-mono">{$transfer.quote.recipient}</dd></div>
      <div><dt>Network</dt><dd>Base Sepolia (84532)</dd></div>
      <div><dt>Amount</dt><dd>{formatEther($transfer.quote.value)} ETH</dd></div>
      <div><dt>Maximum network fee</dt><dd>{formatEther($transfer.quote.maxFee)} ETH</dd></div>
      <div class="financial-total"><dt>Maximum total</dt><dd>{formatEther($transfer.quote.value + $transfer.quote.maxFee)} ETH</dd></div>
    </dl>
    <p class="text-sm text-muted-foreground">Check the recipient and amount. A fresh passkey signature authorizes this transfer; it does not verify your bank association.</p>
    <div class="action-row">
      <Button disabled={$transfer.status !== 'review' || metadataRefreshing} onclick={() => { if (!metadataRefreshing && $transfer.status === 'review') void transfer.confirm() }}>{$transfer.status === 'signing' ? 'Waiting for your passkey…' : 'Authorize and send'}</Button>
      <Button variant="outline" onclick={cancelTransfer}>Cancel transfer</Button>
    </div>
  {:else if $transfer.submission}
    <dl class="financial-summary">
      <div><dt>Recipient</dt><dd class="font-mono">{$transfer.submission.recipient}</dd></div>
      <div><dt>Amount</dt><dd>{$transfer.submission.amount} ETH</dd></div>
      <div><dt>Network</dt><dd>Base Sepolia (84532)</dd></div>
      <div><dt>UserOperation hash <span class="block text-xs">Not the transaction hash</span></dt><dd class="font-mono">{$transfer.submission.hash}</dd></div>
      {#if $transfer.receipt}
        <div><dt>Transaction hash</dt><dd class="font-mono"><a class="text-link" href={`https://sepolia.basescan.org/tx/${$transfer.receipt.receipt.transactionHash}`} target="_blank" rel="noreferrer">{$transfer.receipt.receipt.transactionHash}</a></dd></div>
        <div><dt>Operation execution</dt><dd>{$transfer.receipt.success && $transfer.receipt.receipt.status === 'success' ? 'Succeeded' : 'Failed'}</dd></div>
        <div class="financial-total"><dt>Actual network cost</dt><dd>{formatEther($transfer.receipt.actualGasCost)} ETH</dd></div>
      {/if}
    </dl>
  {/if}

  {#if $transfer.message && !newTransfer}
    <p role={['error', 'failed'].includes($transfer.status) ? 'alert' : 'status'} class={['error', 'failed'].includes($transfer.status) ? 'notice notice-error' : $transfer.status === 'success' ? 'notice notice-success' : ['sending', 'pending'].includes($transfer.status) ? 'notice notice-pending' : 'notice'}>{$transfer.message}</p>
  {/if}
  {#if stage === 'pending' && $transfer.status === 'pending'}
    <div class="action-row">
      <Button variant="outline" disabled={$transfer.checking} onclick={() => transfer.checkReceipt()}>{$transfer.checking ? 'Checking receipt…' : 'Check receipt'}</Button>
      <a class="text-link text-sm" href={`https://sepolia.basescan.org/address/${prepared.address}`} target="_blank" rel="noreferrer">View wallet activity</a>
    </div>
  {/if}
  {#if stage === 'result'}
    {#if receiptJson}
      <details class="details-panel"><summary>Execution receipt details</summary><pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{receiptJson}</pre></details>
    {/if}
    <Button variant="outline" disabled={$transfer.checking} onclick={startNewTransfer}>New transfer</Button>
  {/if}
</section>

<style>
  .balance-value { font-size: 2rem; line-height: 2.25rem; font-weight: 600; }
  .financial-summary { display: grid; gap: 12px; }
  .financial-summary > div { display: grid; gap: 4px; }
  .financial-summary dt { color: var(--muted-foreground); }
  .financial-summary dd { min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .financial-summary .financial-total { border-top: 1px solid var(--border); padding-top: 16px; margin-top: 4px; font-size: 1.25rem; line-height: 1.75rem; font-weight: 600; }
  .financial-summary .financial-total dt { color: inherit; }
  @media (min-width: 768px) {
    .balance-value { font-size: 2.5rem; line-height: 2.75rem; }
    .financial-summary > div { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 16px; }
    .financial-summary dd { text-align: right; }
  }
</style>
