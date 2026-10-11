<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { createWallet } from './wallet'
  import Transfer from './Transfer.svelte'

  let { userId, onSessionExpired }: { userId: string; onSessionExpired: () => void } = $props()
  const wallet = untrack(() => createWallet(userId, onSessionExpired))
  let transactionActive = $state(false)
  let noSavedPasskey = $state(false)
  let messageRegion = $state<'creation' | 'opening' | 'details'>('details')
  let creationTitle = $state<HTMLHeadingElement>()
  let accessTitle = $state<HTMLHeadingElement>()
  let openButton = $state<HTMLButtonElement | HTMLAnchorElement | null>(null)
  let refreshButton = $state<HTMLButtonElement | HTMLAnchorElement | null>(null)
  const busy = $derived(['creating', 'loading', 'opening', 'verifying'].includes($wallet.status))
  const opening = $derived(['opening', 'awaiting-passkey', 'verifying'].includes($wallet.status))
  const refreshDisabled = $derived(busy || opening || transactionActive)

  async function create() {
    messageRegion = 'creation'
    await wallet.create()
    await tick()
    if ($wallet.status === 'confirming') creationTitle?.focus()
    else if ($wallet.wallets.length) accessTitle?.focus()
  }

  async function open(id: string) {
    messageRegion = 'opening'
    await wallet.reopen(id)
    await tick()
    if ($wallet.status === 'awaiting-passkey') accessTitle?.focus()
  }

  async function confirmOpening() {
    await wallet.confirmReopen()
    await tick()
    if ($wallet.openedWalletId) accessTitle?.focus()
  }

  async function cancel() {
    const wasOpening = opening
    wallet.cancel()
    await tick()
    if (wasOpening) openButton?.focus()
    else refreshButton?.focus()
  }

  function refresh() {
    if (refreshDisabled) return
    messageRegion = 'details'
    void wallet.restore()
  }

  async function restartSetup() {
    messageRegion = 'creation'
    await wallet.restartSetup(noSavedPasskey)
    await tick()
    if ($wallet.wallets.length) accessTitle?.focus()
    else creationTitle?.focus()
  }

  $effect(() => { if (!$wallet.canRestartSetup) noSavedPasskey = false })

  onMount(() => { void wallet.restore() })
  onDestroy(() => wallet.destroy())
</script>

{#snippet feedback()}
  {#if $wallet.message && !$wallet.openedWalletId}
    <p role={$wallet.status === 'error' ? 'alert' : 'status'} class="notice mt-4" class:notice-error={$wallet.status === 'error'}>{$wallet.message}</p>
  {:else if $wallet.status === 'error' && $wallet.message}
    <p role="alert" class="notice notice-error mt-4">{$wallet.message}</p>
  {/if}
{/snippet}

<section lang="en" aria-labelledby="wallet-title">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4 md:mb-12">
    <h1 id="wallet-title" class="display-title">{$wallet.wallets.length ? 'Your wallet' : 'Create your wallet'}</h1>
  </div>

  {#if !$wallet.wallets.length}
    <div class="surface-panel p-4 md:p-6">
      {#if $wallet.status === 'loading'}
        <p role="status" class="text-muted-foreground">Loading your saved wallet…</p>
      {:else}
        <p class="max-w-2xl text-muted-foreground">Connect your personal Bitwarden vault, then save a passkey for this wallet.</p>
        <ol class="mt-6 max-w-2xl space-y-6">
          <li class="flex gap-4">
            <span aria-hidden="true" class="pt-1 font-semibold text-brand">01</span>
            <div class="min-w-0">
              <h2 class="text-lg font-semibold">Create your vault</h2>
              <p class="mt-2 text-muted-foreground">Create a personal vault account and choose a master password, or use your existing vault account.</p>
              <a class="text-link mt-2 inline-flex min-h-11 items-center" href="https://vault.whirm.dev" target="_blank" rel="noopener noreferrer">Open vault (new tab)</a>
            </div>
          </li>
          <li class="flex gap-4">
            <span aria-hidden="true" class="pt-1 font-semibold text-brand">02</span>
            <div class="min-w-0">
              <h2 class="text-lg font-semibold">Connect Bitwarden</h2>
              <p class="mt-2 text-muted-foreground">Install the <a class="text-link" href="https://bitwarden.com/download/" target="_blank" rel="noopener noreferrer">Bitwarden extension or app</a>. Select a self-hosted server and enter <span class="break-all font-medium text-foreground">https://vault.whirm.dev</span>.</p>
              <p class="mt-2 text-sm text-muted-foreground">Sign in to the same vault on each device. Signing in on the website does not sign in to the extension or app. On mobile, enable Bitwarden as your passkey provider.</p>
            </div>
          </li>
          <li class="flex gap-4">
            <span aria-hidden="true" class="pt-1 font-semibold text-brand">03</span>
            <div class="min-w-0">
              <h2 tabindex="-1" bind:this={creationTitle} class="text-lg font-semibold">Save your passkey</h2>
              <p class="mt-2 text-muted-foreground">Unlock and sync Bitwarden, then create your wallet below. Choose Bitwarden when prompted to save the passkey.</p>
            </div>
          </li>
        </ol>

        <details class="details-panel mt-6">
          <summary>About your vault and wallet</summary>
          <div class="space-y-3 text-sm text-muted-foreground">
            <p>Your vault account is separate from your Whirm account. Whirm never asks for or receives your master password, vault secrets or private key.</p>
            <p>The wallet uses its own origin and RP ID, separately from vault.whirm.dev. Connect the Bitwarden extension or app before creating your wallet.</p>
            <p>Creating a passkey calculates your smart account address. It does not deploy the account or verify a bank association. Each transfer requires a fresh passkey signature validated on-chain.</p>
          </div>
        </details>

        <div class="mt-6" aria-busy={$wallet.status === 'creating'}>
          {#if $wallet.status === 'confirming'}
            <p role="status" class="notice mb-4">No wallet is registered yet. Continue to {$wallet.draft ? 'reuse your saved passkey.' : 'save a passkey in Bitwarden.'}</p>
          {:else if $wallet.status === 'creating'}
            <p role="status" class="notice mb-4">Preparing and saving your passkey wallet…</p>
          {/if}
          {#if $wallet.draft}
            <p class="notice mb-4">Your public passkey settings are saved in this browser for retry. Keep this browser data until registration succeeds. Refresh and resume to reuse the same passkey.</p>
          {/if}
          {@render feedback()}
          {#if $wallet.canRestartSetup}
            <section aria-labelledby="restart-setup-title" class="mt-4 space-y-4">
              <h2 id="restart-setup-title" class="text-lg font-semibold">Resume an interrupted setup</h2>
              <p class="text-sm">Unlock and sync Bitwarden. Look for a Whirm wallet passkey for app.whirm.dev. If you find one, keep it and ask the team to recover it. Do not restart setup.</p>
              <label class="flex items-start gap-3 text-sm">
                <input type="checkbox" bind:checked={noSavedPasskey} class="mt-1" />
                <span>I checked my synced Bitwarden vault: no Whirm wallet passkey was saved for this account.</span>
              </label>
              <Button disabled={!noSavedPasskey || busy} onclick={restartSetup}>Restart wallet setup</Button>
              <p class="text-sm text-muted-foreground">We check again that no wallet is registered before clearing only the interrupted request marker. This does not create a passkey automatically.</p>
            </section>
          {/if}
          <div class="action-row mt-4">
            {#if !$wallet.canRestartSetup}
              <Button disabled={$wallet.status !== 'idle' && $wallet.status !== 'confirming'} onclick={create}>
                {$wallet.status === 'confirming' ? $wallet.draft ? 'Continue with saved passkey' : 'Save passkey in Bitwarden' : $wallet.draft ? 'Resume wallet creation' : 'Create wallet'}
              </Button>
            {/if}
            {#if $wallet.status === 'creating'}
              <Button variant="outline" onclick={cancel}>Cancel creation</Button>
            {/if}
            {#if ['error', 'cancelled'].includes($wallet.status)}
              <Button bind:ref={refreshButton} variant="outline" disabled={refreshDisabled} onclick={refresh}>Refresh wallet details</Button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#each $wallet.wallets as metadata (metadata.id)}
    <div class="surface-panel p-4 md:p-6">
      <dl>
        <dt class="text-sm text-muted-foreground">Wallet address</dt>
        <dd class="mt-2 break-all font-mono text-base leading-relaxed md:text-lg">{metadata.address}</dd>
      </dl>

      <details class="details-panel mt-6">
        <summary>Wallet details</summary>
        <dl class="grid gap-4 text-sm md:grid-cols-2">
          <div><dt class="text-muted-foreground">Association status</dt><dd class="mt-1 font-semibold capitalize">{metadata.status}</dd></div>
          <div><dt class="text-muted-foreground">Chain ID</dt><dd class="mt-1 font-semibold">{metadata.chainId}</dd></div>
          <div><dt class="text-muted-foreground">Registered at</dt><dd class="mt-1 break-words">{metadata.createdAt}</dd></div>
          <div><dt class="text-muted-foreground">Verified at</dt><dd class="mt-1 break-words">{metadata.verifiedAt ?? 'Not verified'}</dd></div>
        </dl>
        <p class="mt-4 text-sm text-muted-foreground">Calculated smart account address. Deployment has not been checked.</p>
      </details>
      <div class="mt-4">
        <Button bind:ref={refreshButton} variant="outline" disabled={refreshDisabled} onclick={refresh}>{$wallet.status === 'loading' ? 'Refreshing wallet details…' : 'Refresh wallet details'}</Button>
        {#if transactionActive}<p class="mt-2 text-sm text-muted-foreground">Finish the transfer before refreshing wallet details.</p>{/if}
        {#if $wallet.status === 'loading'}<p role="status" class="mt-2 text-sm text-muted-foreground">Refreshing saved metadata. Your current wallet remains visible.</p>{/if}
        {#if messageRegion === 'details'}{@render feedback()}{/if}
      </div>

      <div class="mt-6 border-t pt-6" aria-busy={opening && $wallet.status !== 'awaiting-passkey'}>
        <h2 bind:this={accessTitle} tabindex="-1" class="section-title">{$wallet.openedWalletId === metadata.id ? 'Wallet open' : $wallet.status === 'awaiting-passkey' ? 'Continue with your passkey' : 'Open your wallet'}</h2>
        <p class="mt-2 max-w-2xl text-sm text-muted-foreground">{$wallet.openedWalletId === metadata.id ? 'Your passkey matches this wallet. Opening does not verify a bank association or authorize spending.' : 'Use your existing passkey. Opening does not create a replacement wallet or authorize a transfer.'}</p>
        {#if $wallet.openedWalletId !== metadata.id}
          {#if $wallet.status === 'awaiting-passkey'}
            <p class="mt-4 max-w-2xl text-sm text-muted-foreground">Unlock and sync the same Bitwarden vault configured with <span class="break-all">https://vault.whirm.dev</span>, then continue.</p>
          {:else if opening}
            <p role="status" class="notice mt-4">{$wallet.status === 'opening' ? 'Loading your registered wallet…' : 'Checking your existing passkey and wallet address…'}</p>
          {/if}
          {#if messageRegion === 'opening'}{@render feedback()}{/if}
          <div class="action-row mt-4">
            {#if $wallet.status === 'awaiting-passkey'}
              <Button onclick={confirmOpening}>Continue with passkey</Button>
            {:else}
              <Button bind:ref={openButton} disabled={busy || transactionActive} onclick={() => open(metadata.id)}>{opening ? 'Opening wallet…' : 'Open wallet'}</Button>
            {/if}
            {#if opening}<Button variant="outline" onclick={cancel}>Cancel opening</Button>{/if}
          </div>
        {/if}
      </div>

      {#if $wallet.openedWalletId === metadata.id && $wallet.openedPasskey}
        {#key $wallet.openedPasskey}
          <Transfer prepared={$wallet.openedPasskey} metadataRefreshing={$wallet.status === 'loading'} onActivityChange={(active) => transactionActive = active} />
        {/key}
      {/if}
    </div>
  {/each}
</section>
