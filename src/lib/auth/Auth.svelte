<script lang="ts">
  import { onDestroy, onMount, tick, type Snippet } from 'svelte'
  import swissquoteLogo from '../../assets/swissquote-logo.svg'
  import { Button } from '$lib/components/ui/button'
  import { createAuth, type AuthSession } from './auth'

  let { onSessionChange, children }: {
    onSessionChange?: (session: AuthSession | null) => void
    children?: Snippet<[AuthSession, () => void]>
  } = $props()
  let email = $state('')
  let password = $state('')
  let displayName = $state('')
  let mode = $state<'signin' | 'signup'>('signin')
  let formMessage = $state<string | null>(null)
  let formHeading = $state<HTMLHeadingElement>()
  const auth = createAuth()
  const session = $derived($auth.session)
  const busy = $derived(['checking', 'connecting', 'disconnecting'].includes($auth.status))

  $effect(() => {
    onSessionChange?.(session)
  })

  onMount(() => {
    void auth.restore()
    const refresh = () => { void auth.restore() }
    const onVisible = () => { if (!document.hidden) refresh() }
    const interval = setInterval(() => { if ($auth.session && !document.hidden) refresh() }, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  })

  onDestroy(() => {
    auth.destroy()
    onSessionChange?.(null)
  })

  function connect(event: SubmitEvent) {
    event.preventDefault()
    if (busy) return
    if (mode === 'signup' && !displayName.trim()) {
      formMessage = 'Enter a name containing at least one non-space character.'
      return
    }
    formMessage = null
    const submittedPassword = password
    password = ''
    if (mode === 'signup') void auth.signup(email, submittedPassword, displayName)
    else void auth.connect(email, submittedPassword)
  }

  async function switchMode() {
    if (busy) return
    mode = mode === 'signin' ? 'signup' : 'signin'
    password = ''
    formMessage = null
    auth.clearFeedback()
    await tick()
    formHeading?.focus()
  }
</script>

<svelte:head>
  <title>{session && children ? 'Whirm · Passkey wallet' : mode === 'signup' ? 'Whirm · Sign up' : 'Whirm · Sign in'}</title>
  <meta name="description" content="Access your personal Whirm wallet and send digital assets." />
</svelte:head>

{#snippet feedback()}
  {#if $auth.status === 'checking' || $auth.status === 'connecting' || $auth.status === 'disconnecting'}
    <p role="status" class="notice">{$auth.status === 'checking' ? 'Checking your session…' : $auth.status === 'disconnecting' ? 'Signing out…' : mode === 'signup' ? 'Creating your account…' : 'Signing in…'}</p>
  {:else if $auth.status === 'refused'}
    <p role="alert" class="notice notice-error">Check your email and password, then try again.</p>
  {:else if $auth.status === 'expired'}
    <p role="alert" class="notice notice-pending">Your session has expired. Sign in again to continue.</p>
  {:else if $auth.status === 'error'}
    <p role="alert" class="notice notice-error">{$auth.message}</p>
  {/if}
{/snippet}

<div lang="en" class="flex min-h-svh flex-col">
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header class="site-header">
    <div class="page-container flex min-h-20 flex-wrap items-center justify-between gap-4 py-4">
      <div class="flex shrink-0 items-center gap-3">
        <img src={swissquoteLogo} alt="Swissquote" width="35" height="35" />
        <span class="border-l pl-3 text-lg font-semibold">Whirm</span>
      </div>
      {#if session}
        <div class="flex min-w-0 flex-wrap items-center gap-4">
          <div class="min-w-0 text-sm">
            <p class="max-w-48 truncate font-semibold">{session.displayName || session.email}</p>
            {#if session.displayName && session.displayName !== session.email}
              <p class="max-w-48 truncate text-muted-foreground">{session.email}</p>
            {/if}
          </div>
          <Button variant="outline" size="sm" disabled={busy} onclick={() => auth.disconnect()}>{$auth.status === 'disconnecting' ? 'Signing out…' : 'Sign out'}</Button>
        </div>
      {/if}
    </div>
  </header>

  <main id="main-content" tabindex="-1" class="page-container app-main flex-1">
    {#if session}
      {#if $auth.status === 'error' || $auth.status === 'disconnecting'}
        <div class="mb-6">{@render feedback()}</div>
      {/if}
      {#if children}
        {@render children(session, auth.expire)}
      {:else}
        <h1 class="display-title">Your account</h1>
        <p class="mt-4 text-muted-foreground">You are signed in.</p>
      {/if}
    {:else}
      <section aria-labelledby="connection-title" class="auth-form-panel surface-panel" aria-busy={busy}>
        <h1 id="connection-title" tabindex="-1" bind:this={formHeading} class="display-title">{mode === 'signup' ? 'Create account' : 'Sign in'}</h1>
        <p class="mt-3 text-muted-foreground">{mode === 'signup' ? 'Create your Whirm account to set up a wallet.' : 'Access your personal wallet.'}</p>

        <form class="mt-6 space-y-6" onsubmit={connect}>
          {#if mode === 'signup'}
            <div>
              <label for="auth-name" class="mb-2 block font-semibold">Name</label>
              <input id="auth-name" name="displayName" type="text" autocomplete="name" minlength="1" maxlength="150" required bind:value={displayName} disabled={busy} aria-invalid={!!formMessage} aria-describedby={formMessage ? 'auth-name-error' : undefined} class="field-input" placeholder="Your full name" />
              {#if formMessage}<p id="auth-name-error" role="alert" class="mt-2 text-sm text-destructive">{formMessage}</p>{/if}
            </div>
          {/if}
          <div>
            <label for="auth-email" class="mb-2 block font-semibold">Email address</label>
            <input id="auth-email" name="email" type="email" autocomplete="username" maxlength="255" required bind:value={email} disabled={busy} class="field-input" placeholder="you@example.com" />
          </div>
          <div>
            <label for="auth-password" class="mb-2 block font-semibold">Password</label>
            <input id="auth-password" name="password" type="password" autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} minlength={mode === 'signup' ? 8 : 1} maxlength="1024" aria-describedby={mode === 'signup' ? 'auth-password-requirements' : undefined} required bind:value={password} disabled={busy} class="field-input" placeholder={mode === 'signup' ? 'Create a password' : 'Enter your password'} />
            {#if mode === 'signup'}
              <p id="auth-password-requirements" class="mt-2 text-sm text-muted-foreground">Use 8 to 1024 characters. Uppercase letters, numbers and symbols are optional.</p>
            {/if}
          </div>
          {#if mode === 'signup'}
            <p class="text-sm text-muted-foreground">This account is separate from your Bitwarden vault and its master password.</p>
          {/if}
          {@render feedback()}
          <Button type="submit" class="w-full" disabled={busy}>
            {$auth.status === 'checking' ? 'Checking session…' : mode === 'signup' ? $auth.status === 'connecting' ? 'Creating account…' : 'Create account' : $auth.status === 'connecting' ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <div class="mt-4 flex flex-wrap items-center justify-center gap-x-2 text-sm">
          <span class="text-muted-foreground">{mode === 'signup' ? 'Already have an account?' : 'New to Whirm?'}</span>
          <button type="button" class="text-link inline-flex min-h-11 items-center" disabled={busy} onclick={switchMode}>{mode === 'signup' ? 'Sign in' : 'Create an account'}</button>
        </div>
      </section>
    {/if}
  </main>
</div>
