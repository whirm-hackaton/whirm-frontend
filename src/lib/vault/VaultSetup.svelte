<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { registerVault, registrationDetails, vaultServer } from './registration'

  let { onReady, disabled = false }: { onReady: () => void; disabled?: boolean } = $props()
  let email = $state('')
  let masterPassword = $state('')
  let confirmation = $state('')
  let registering = $state(false)
  let message = $state<string | null>(null)
  let created = $state(false)
  let formOpen = $state(false)
  let clientReady = $state(false)
  let controller: AbortController | undefined
  let destroyed = false
  const locked = $derived(disabled || registering)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (locked || created) return
    try { registrationDetails(email, masterPassword, confirmation) }
    catch (error) { message = (error as Error).message; return }
    const password = masterPassword
    const repeated = confirmation
    masterPassword = ''
    confirmation = ''
    registering = true
    message = null
    const active = new AbortController()
    controller = active
    try {
      await registerVault(email, password, repeated, active.signal)
      if (!destroyed) { created = true; formOpen = false; message = 'Your personal vault account was created. Now sign in to it in the Bitwarden extension or app.' }
    } catch (error) { if (!destroyed) message = (error as Error).message }
    finally { if (!destroyed) registering = false }
  }

  onDestroy(() => { destroyed = true; controller?.abort(); masterPassword = ''; confirmation = '' })
</script>

<div class="space-y-4 rounded-2xl border bg-card p-6" aria-busy={registering}>
  <h2 class="text-2xl">Prepare my vault</h2>
  <p class="text-sm">Your personal Bitwarden vault is separate from your Whirm account. Use your existing vault or create one here before saving your wallet passkey.</p>
  {#if !created}
    <div class="flex flex-wrap gap-3">
      <Button variant="outline" disabled={locked} onclick={() => { formOpen = !formOpen; masterPassword = ''; confirmation = ''; message = null }}>Create a personal vault</Button>
      <Button variant="outline" disabled={locked} onclick={() => { formOpen = false; masterPassword = ''; confirmation = ''; message = null }}>I already have a vault</Button>
    </div>
  {/if}
  {#if formOpen && !created}
    <form class="space-y-4" onsubmit={submit}>
      <div>
        <label for="vault-email" class="mb-2 block text-sm font-semibold">Vault email</label>
        <input id="vault-email" type="email" autocomplete="username" maxlength="255" required bind:value={email} disabled={locked} class="h-11 w-full rounded-md border bg-background px-3" />
      </div>
      <div>
        <label for="vault-password" class="mb-2 block text-sm font-semibold">Vault master password</label>
        <input id="vault-password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required bind:value={masterPassword} disabled={locked} aria-describedby="vault-password-help" class="h-11 w-full rounded-md border bg-background px-3" />
        <p id="vault-password-help" class="mt-2 text-sm text-muted-foreground">Use 12 to 1024 characters for this vault setup. Choose a long, unique passphrase, different from your Whirm password. Keep it safe: this demo has no master password recovery.</p>
      </div>
      <div>
        <label for="vault-confirmation" class="mb-2 block text-sm font-semibold">Confirm master password</label>
        <input id="vault-confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required bind:value={confirmation} disabled={locked} class="h-11 w-full rounded-md border bg-background px-3" />
      </div>
      <p class="text-sm text-muted-foreground">Your browser processes the master password and encrypts your vault keys locally. The server receives an authentication verifier and encrypted keys. We do not send or save your master password. The frontend code is part of this trust boundary.</p>
      <Button type="submit" disabled={locked}>{registering ? 'Creating your vault…' : 'Create my vault account'}</Button>
    </form>
  {/if}
  {#if message}<p role={created ? 'status' : 'alert'} class="rounded-lg border bg-secondary p-4 text-sm">{message}</p>{/if}
  <ol class="list-decimal space-y-3 pl-5 text-muted-foreground">
    <li>Install the <a class="underline" href="https://bitwarden.com/download/" target="_blank" rel="noreferrer">official Bitwarden browser extension or mobile app</a>. Choose a self-hosted server and enter <span class="break-all">{vaultServer}</span>.</li>
    <li>Sign in to your personal vault inside Bitwarden, unlock it and sync. Enable Bitwarden as your passkey provider on mobile.</li>
    <li>When creating the passkey, choose Bitwarden in the browser or system prompt. Creating a vault account here does not connect Bitwarden automatically.</li>
  </ol>
  <label class="flex items-start gap-3 text-sm">
    <input type="checkbox" bind:checked={clientReady} disabled={locked} class="mt-1" />
    <span>I have connected, unlocked and synced my personal Bitwarden vault on this device.</span>
  </label>
  <Button disabled={locked || !clientReady || formOpen} onclick={onReady}>My vault is ready — continue to wallet creation</Button>
  <p class="text-sm text-muted-foreground">This confirmation is yours; Whirm cannot inspect your Bitwarden account or force the browser to choose it. The wallet origin and RP ID remain separate from the vault.</p>
</div>
