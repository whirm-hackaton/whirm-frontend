<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { createWallet } from './wallet'

  let { userId, onSessionExpired }: { userId: string; onSessionExpired: () => void } = $props()
  const wallet = untrack(() => createWallet(userId, onSessionExpired))
  let heading = $state<HTMLHeadingElement>()
  const busy = $derived(['creating', 'loading', 'opening', 'verifying'].includes($wallet.status))

  $effect(() => {
    if (!busy) heading?.focus()
  })

  onMount(() => { void wallet.restore() })
  onDestroy(() => wallet.destroy())
</script>

<section lang="en" aria-labelledby="wallet-title" class="space-y-6" aria-busy={busy}>
  <ol aria-label="Wallet setup progress" class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
    <li>1. Signed in</li>
    <li aria-current={!$wallet.wallets.length ? 'step' : undefined}>2. Prepare your vault</li>
    <li aria-current={$wallet.wallets.length ? 'step' : undefined}>3. Create or recover your wallet</li>
  </ol>

  <h1 id="wallet-title" tabindex="-1" bind:this={heading} class="text-4xl leading-tight outline-none sm:text-5xl">
    {$wallet.wallets.length ? 'Your wallet' : 'Create your wallet with a passkey'}
  </h1>
  <p class="rounded-lg border bg-accent p-4 text-sm text-accent-foreground">
    The smart account address is calculated on Base Sepolia. Creating a passkey does not deploy the account or verify your bank association. Spending requires a fresh passkey signature validated on-chain.
  </p>

  {#if !$wallet.wallets.length}
    <div class="space-y-4 rounded-2xl border bg-card p-6">
      <h2 class="text-2xl">Prepare my vault</h2>
      <ol class="list-decimal space-y-3 pl-5 text-muted-foreground">
        <li>Create a personal account at <a class="underline" href="https://vault.whirm.dev" target="_blank" rel="noreferrer">vault.whirm.dev</a>. Choose your own master password inside the vault. Your vault account is separate from your bank account.</li>
        <li>Install the <a class="underline" href="https://bitwarden.com/download/" target="_blank" rel="noreferrer">official Bitwarden browser extension or mobile app</a>. Select a self-hosted server and enter https://vault.whirm.dev. Sign in to the same personal vault on each device.</li>
        <li>Enable Bitwarden as your passkey provider, unlock and sync your vault, then choose Bitwarden in the browser or system prompt. The browser controls which providers are offered.</li>
      </ol>
      <p class="text-sm">The wallet uses its own origin and RP ID, separately from vault.whirm.dev. We never ask for or receive your master password, vault secrets or private key.</p>
    </div>
  {/if}

  <div aria-live="polite" aria-atomic="true">
    {#if busy}
      <p role="status" class="rounded-lg border bg-secondary p-4">{$wallet.status === 'creating' ? 'Preparing and saving your passkey wallet…'
        : $wallet.status === 'opening' ? 'Loading your registered wallet…'
          : $wallet.status === 'verifying' ? 'Using your existing passkey and matching your wallet address…'
            : 'Loading your saved wallets…'}</p>
    {:else if $wallet.message}
      <p role={$wallet.status === 'error' ? 'alert' : 'status'} class="rounded-lg border bg-secondary p-4">{$wallet.message}</p>
    {:else if $wallet.status === 'confirming'}
      <p class="text-lg text-muted-foreground">Your account has no saved wallet. Continue below and choose Bitwarden to save your passkey.</p>
    {:else if $wallet.status === 'awaiting-passkey'}
      <p class="rounded-lg border bg-secondary p-4">Your existing wallet is ready. Unlock and sync the same personal Bitwarden vault configured with https://vault.whirm.dev, then use your saved passkey below. This uses the existing passkey to recover your wallet, with no transaction or spending authorization.</p>
    {:else if $wallet.status === 'idle'}
      <p class="text-lg text-muted-foreground">No wallet is registered for your account yet.</p>
    {/if}
  </div>

  {#each $wallet.wallets as metadata (metadata.id)}
    <div class="rounded-2xl border bg-card p-6 shadow-sm">
      <p class="mb-2 text-sm text-muted-foreground">Calculated address. Deployment has not been checked.</p>
      <p class="mb-5 font-semibold">{metadata.status === 'verified' ? 'Verified association' : 'Unverified association'}</p>
      <p class="mb-5 text-sm">{$wallet.openedWalletId === metadata.id ? 'Existing passkey recovered; wallet address matches. This does not verify your bank association or authorize spending.' : 'Use your existing passkey to reopen this wallet. Displaying its address alone does not prove control or authorize spending.'}</p>
      <dl class="space-y-4">
        <div>
          <dt class="text-sm text-muted-foreground">Address</dt>
          <dd class="mt-1 break-all font-mono text-sm">{metadata.address}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Network</dt>
          <dd>Base Sepolia ({metadata.chainId})</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Association status</dt>
          <dd>{metadata.status}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Registered at</dt>
          <dd>{metadata.createdAt}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Verified at</dt>
          <dd>{metadata.verifiedAt ?? 'Not verified'}</dd>
        </div>
      </dl>
      <Button class="mt-6" size="lg" disabled={busy || $wallet.status === 'awaiting-passkey'} onclick={() => wallet.reopen(metadata.id)}>Recover my wallet</Button>
    </div>
  {/each}

  {#if $wallet.draft && !$wallet.wallets.length}
    <p class="rounded-lg border p-4 text-sm">Your public passkey settings are saved in this browser for retry. Keep this browser data until registration succeeds. Refresh and resume to reuse the same passkey.</p>
  {/if}

  <div class="flex flex-wrap gap-3">
    {#if !$wallet.wallets.length}
      <Button size="lg" disabled={$wallet.status !== 'idle' && $wallet.status !== 'confirming'} onclick={() => wallet.create()}>
        {$wallet.status === 'confirming' ? $wallet.draft ? 'Continue with saved passkey' : 'Save my passkey in Bitwarden' : $wallet.draft ? 'Resume wallet creation' : 'Create my wallet'}
      </Button>
    {/if}
    {#if $wallet.status === 'awaiting-passkey'}
      <Button size="lg" onclick={() => wallet.confirmReopen()}>Use my existing passkey</Button>
    {/if}
    <Button variant="outline" size="lg" disabled={busy} onclick={() => wallet.restore()}>Refresh wallets</Button>
    {#if ['creating', 'opening', 'awaiting-passkey', 'verifying'].includes($wallet.status)}
      <Button variant="outline" size="lg" onclick={() => wallet.cancel()}>Cancel request</Button>
    {/if}
  </div>

  <p class="text-sm text-muted-foreground">Signing out clears the screen. Saved metadata is restored from your account when you sign in again or reload.</p>
</section>
