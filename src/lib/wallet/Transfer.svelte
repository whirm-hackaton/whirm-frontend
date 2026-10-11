<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { formatEther, parseEther } from 'viem'
  import { Button } from '$lib/components/ui/button'
  import { createTransfer } from './transactions'
  import { formatEth } from './format'
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
  let amountInput = $state<HTMLInputElement>()
  let showFunding = $state(false)
  let copyMessage = $state('')
  let copyFailed = $state(false)
  const locked = $derived(['preparing', 'review', 'signing', 'sending', 'pending'].includes($transfer.status))
  const busy = $derived(['preparing', 'signing', 'sending'].includes($transfer.status))
  const stage = $derived(newTransfer ? 'form' : ['review', 'signing'].includes($transfer.status) ? 'review'
    : ['sending', 'pending'].includes($transfer.status) ? 'pending'
    : ['success', 'failed'].includes($transfer.status) ? 'result' : 'form')
  const heading = $derived(stage === 'review' ? 'Send' : stage === 'pending' ? ($transfer.status === 'sending' ? 'Sending transfer' : 'Waiting for confirmation')
    : stage === 'result' ? ($transfer.status === 'success' ? 'Transfer confirmed' : 'Transfer not confirmed') : 'Send ETH')
  const fundingTotal = $derived($transfer.funding?.maxFee == null ? null : $transfer.funding.value + $transfer.funding.maxFee)
  const shortfall = $derived($transfer.funding?.balance == null ? null
    : (fundingTotal ?? $transfer.funding.value) > $transfer.funding.balance ? (fundingTotal ?? $transfer.funding.value) - $transfer.funding.balance : 0n)

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
    showFunding = false
    copyMessage = ''
    void transfer.prepare(recipient.trim(), amount.trim())
  }

  async function cancelTransfer() {
    transfer.cancel()
    await tick()
    stageHeading?.focus()
  }

  async function copyRecipient(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      copyFailed = false
      copyMessage = 'Recipient address copied.'
    } catch {
      copyFailed = true
      copyMessage = 'Copy failed. Copy the address above.'
    }
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
        <input id="transfer-amount" bind:this={amountInput} bind:value={amount} required disabled={locked || !!unavailable || metadataRefreshing} inputmode="decimal" autocomplete="off" aria-describedby="amount-help" class="field-input" placeholder="0.00001" />
        <p id="amount-help" class="text-sm text-muted-foreground">Use a decimal point, with up to 18 decimal places. Keep enough ETH for network fees.</p>
      </div>
      {#if metadataRefreshing}<p role="status" class="notice">Wait for wallet details to finish refreshing before sending.</p>{/if}
      <div class="action-row">
        <Button type="submit" class="w-full sm:w-auto" disabled={locked || !!unavailable || metadataRefreshing}>{$transfer.status === 'preparing' ? 'Preparing transfer…' : 'Send'}</Button>
        {#if $transfer.status === 'preparing'}<Button variant="outline" onclick={cancelTransfer}>Cancel</Button>{/if}
      </div>
    </form>
  {:else if stage === 'review' && $transfer.quote}
    <p class="text-sm text-muted-foreground">Network: <span class="font-semibold text-foreground">Base Sepolia (84532)</span></p>
    <dl class="financial-summary">
      <div class="financial-primary"><dt>Recipient</dt><dd class="font-mono text-base">{$transfer.quote.recipient}</dd></div>
      <div class="financial-primary"><dt>Amount to send</dt><dd class="amount-value">{formatEth($transfer.quote.value)}</dd></div>
    </dl>
    <div class="relative flex">
      <Button variant="outline" size="sm" onclick={() => copyRecipient($transfer.quote!.recipient)}>Copy recipient address</Button>
      <p role="status" class={`absolute inset-x-0 top-full mt-1 text-sm ${copyFailed ? 'text-destructive' : 'text-[var(--success)]'}`}>{copyMessage}</p>
    </div>
    <dl class="financial-summary fee-summary">
      <div><dt>Maximum network fee</dt><dd>{formatEth($transfer.quote.maxFee)}</dd></div>
      <div class="financial-total"><dt>Maximum total debited</dt><dd>{formatEth($transfer.quote.value + $transfer.quote.maxFee)}</dd></div>
    </dl>
    <details class="details-panel">
      <summary>Exact amounts</summary>
      <p class="mb-4 text-sm text-muted-foreground">Values marked ≈ are rounded up for display. Your exact amount and fee limits below are used for confirmation.</p>
      <dl class="financial-summary">
        <div><dt>Amount entered</dt><dd>{$transfer.quote.amount} ETH</dd></div>
        <div><dt>Maximum network fee</dt><dd>{formatEther($transfer.quote.maxFee)} ETH</dd></div>
        <div><dt>Maximum total debited</dt><dd>{formatEther($transfer.quote.value + $transfer.quote.maxFee)} ETH</dd></div>
      </dl>
    </details>
    <p class="text-sm text-muted-foreground">Check the recipient, amount and network. Confirm this transfer in the window that opens.</p>
    <div class="action-row">
      <Button disabled={$transfer.status !== 'review' || metadataRefreshing} onclick={() => { if (!metadataRefreshing && $transfer.status === 'review') void transfer.confirm() }}>{$transfer.status === 'signing' ? 'Waiting for your confirmation…' : 'Confirm and send'}</Button>
      <Button variant="outline" onclick={cancelTransfer}>Cancel</Button>
    </div>
  {:else if $transfer.submission}
    <dl class="financial-summary">
      <div class="financial-primary"><dt>Recipient</dt><dd class="font-mono">{$transfer.submission.recipient}</dd></div>
      <div class="financial-primary"><dt>Amount requested</dt><dd class="amount-value">{formatEth(parseEther($transfer.submission.amount))}</dd></div>
      <div><dt>Network</dt><dd>Base Sepolia (84532)</dd></div>
      {#if $transfer.receipt}
        <div><dt>Transaction</dt><dd><a class="text-link" href={`https://sepolia.basescan.org/tx/${$transfer.receipt.receipt.transactionHash}`} target="_blank" rel="noreferrer">View transaction on explorer</a></dd></div>
        <div><dt>Actual network fee</dt><dd>{formatEth($transfer.receipt.actualGasCost)}</dd></div>
        {#if $transfer.status === 'success'}
          <div class="financial-total"><dt>Actual total debited</dt><dd>{formatEth(parseEther($transfer.submission.amount) + $transfer.receipt.actualGasCost)}</dd></div>
        {/if}
      {/if}
    </dl>
    <details class="details-panel">
      <summary>Transfer details</summary>
      <p class="mb-4 text-sm text-muted-foreground">Values marked ≈ are rounded up for display.</p>
      <dl class="financial-summary">
        <div><dt>Tracking reference <span class="block text-xs">Not the transaction hash</span></dt><dd class="font-mono">{$transfer.submission.hash}</dd></div>
        <div><dt>Amount entered</dt><dd>{$transfer.submission.amount} ETH</dd></div>
        {#if $transfer.receipt}
          <div><dt>Exact network fee charged</dt><dd>{formatEther($transfer.receipt.actualGasCost)} ETH</dd></div>
          {#if $transfer.status === 'success'}
            <div><dt>Exact total debited</dt><dd>{formatEther(parseEther($transfer.submission.amount) + $transfer.receipt.actualGasCost)} ETH</dd></div>
          {/if}
        {/if}
      </dl>
    </details>
  {/if}

  {#if $transfer.message && !newTransfer}
    <p role={['error', 'failed'].includes($transfer.status) ? 'alert' : 'status'} class={['error', 'failed'].includes($transfer.status) ? 'notice notice-error' : $transfer.status === 'success' ? 'notice notice-success' : ['sending', 'pending'].includes($transfer.status) ? 'notice notice-pending' : 'notice'}>{$transfer.message}</p>
  {/if}
  {#if stage === 'form' && $transfer.status === 'error' && $transfer.funding}
    <section aria-labelledby="funding-summary-title" class="space-y-4">
      <h3 id="funding-summary-title" class="font-semibold">Last transfer check</h3>
      <dl class="financial-summary">
        <div><dt>Checked balance</dt><dd>{$transfer.funding.balance === null ? 'Unavailable' : `${formatEther($transfer.funding.balance)} ETH`}</dd></div>
        <div><dt>Amount</dt><dd>{formatEther($transfer.funding.value)} ETH</dd></div>
        <div><dt>Maximum network fee</dt><dd>{$transfer.funding.maxFee === null ? 'Unavailable' : `${formatEther($transfer.funding.maxFee)} ETH`}</dd></div>
        <div><dt>Maximum total required</dt><dd>{fundingTotal === null ? 'Unavailable until fees are estimated' : `${formatEther(fundingTotal)} ETH`}</dd></div>
        {#if shortfall !== null && (fundingTotal !== null || shortfall > 0n)}
          <div class="financial-total"><dt>{fundingTotal === null ? 'Shortfall before network fees' : 'Shortfall'}</dt><dd>{formatEther(shortfall)} ETH</dd></div>
        {/if}
      </dl>
      {#if $transfer.funding.maxFee === null}
        <p class="text-sm text-muted-foreground">No network fee estimate is available. Sending is blocked; fees are not assumed to be zero.</p>
      {/if}
      <div class="action-row">
        <Button variant="outline" disabled={!!unavailable || metadataRefreshing} onclick={() => { amountInput?.focus(); amountInput?.select() }}>Edit amount</Button>
        <Button variant="outline" aria-expanded={showFunding} aria-controls="wallet-funding" onclick={() => showFunding = !showFunding}>Add funds to wallet</Button>
      </div>
      {#if showFunding}
        <div id="wallet-funding" class="notice space-y-2">
          <p class="font-semibold">Fund this wallet on Base Sepolia (84532)</p>
          <p class="text-sm">Send Base Sepolia test ETH to this address, then refresh the balance and review your transfer again. Keep enough ETH for the amount and network fees.</p>
          <p class="break-all font-mono text-sm">{prepared.address}</p>
        </div>
      {/if}
    </section>
  {/if}
  {#if stage === 'pending' && $transfer.status === 'pending'}
    <div class="action-row">
      <Button variant="outline" disabled={$transfer.checking} onclick={() => transfer.checkReceipt()}>{$transfer.checking ? 'Checking receipt…' : 'Check receipt'}</Button>
      <a class="text-link text-sm" href={`https://sepolia.basescan.org/address/${prepared.address}`} target="_blank" rel="noreferrer">View wallet activity</a>
    </div>
  {/if}
  {#if stage === 'result'}
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
  .financial-primary { font-weight: 600; }
  .financial-primary dt { color: inherit; }
  .amount-value { font-size: 2rem; line-height: 2.25rem; }
  .fee-summary { border-radius: var(--radius); background: var(--secondary); padding: 16px; }
  @media (min-width: 768px) {
    .balance-value { font-size: 2.5rem; line-height: 2.75rem; }
    .financial-summary > div { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 16px; }
    .financial-summary dd { text-align: right; }
  }
</style>
