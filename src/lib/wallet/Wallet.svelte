<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { createWallet } from './wallet'

  let { userId, onSessionExpired }: { userId: string; onSessionExpired: () => void } = $props()
  const wallet = untrack(() => createWallet(userId, onSessionExpired))
  let heading = $state<HTMLHeadingElement>()
  const busy = $derived($wallet.status === 'creating' || $wallet.status === 'loading')

  $effect(() => {
    if (!busy) heading?.focus()
  })

  onMount(() => { void wallet.restore() })
  onDestroy(() => wallet.destroy())
</script>

<section lang="en" aria-labelledby="wallet-title" class="space-y-6" aria-busy={busy}>
  <ol aria-label="Wallet setup progress" class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
    <li>1. Signed in</li>
    <li aria-current={!$wallet.wallets.length ? 'step' : undefined}>2. Register candidate</li>
    <li aria-current={$wallet.wallets.length ? 'step' : undefined}>3. View wallets</li>
  </ol>

  <h1 id="wallet-title" tabindex="-1" bind:this={heading} class="text-4xl leading-tight outline-none sm:text-5xl">
    {$wallet.wallets.length ? 'Your wallet metadata' : 'Register a candidate wallet'}
  </h1>
  <p class="rounded-lg border bg-accent p-4 text-sm text-accent-foreground">
    Address generation is simulated. No account is deployed, no keys are generated and no ownership is proven here. Metadata is saved by the server. Do not send funds to simulated addresses.
  </p>

  <div aria-live="polite" aria-atomic="true">
    {#if busy}
      <p role="status" class="rounded-lg border bg-secondary p-4">{$wallet.status === 'creating' ? 'Saving your candidate wallet…' : 'Loading your saved wallets…'}</p>
    {:else if $wallet.message}
      <p role={$wallet.status === 'error' ? 'alert' : 'status'} class="rounded-lg border bg-secondary p-4">{$wallet.message}</p>
    {:else if $wallet.status === 'idle'}
      <p class="text-lg text-muted-foreground">No wallet is registered for your account yet.</p>
    {/if}
  </div>

  {#each $wallet.wallets as metadata (metadata.id)}
    <div class="rounded-2xl border bg-card p-6 shadow-sm">
      <p class="mb-5 font-semibold">{metadata.status === 'verified' ? 'Verified association' : 'Unverified association'}</p>
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
    </div>
  {/each}

  <div class="flex flex-wrap gap-3">
    {#if !$wallet.wallets.length}
      <Button size="lg" disabled={$wallet.status !== 'idle'} onclick={() => wallet.create()}>
        {$wallet.status === 'creating' ? 'Saving…' : 'Register simulated candidate'}
      </Button>
    {/if}
    <Button variant="outline" size="lg" disabled={busy} onclick={() => wallet.restore()}>Refresh wallets</Button>
    {#if $wallet.status === 'creating'}
      <Button variant="outline" size="lg" onclick={() => wallet.cancel()}>Cancel request</Button>
    {/if}
  </div>

  <p class="text-sm text-muted-foreground">Signing out clears the screen. Saved metadata is restored from your account when you sign in again or reload.</p>
</section>
