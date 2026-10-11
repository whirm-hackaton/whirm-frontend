<script lang="ts">
  import { onDestroy, onMount, type Snippet } from 'svelte'
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

  function switchMode() {
    if (busy) return
    mode = mode === 'signin' ? 'signup' : 'signin'
    password = ''
    formMessage = null
    auth.clearFeedback()
  }
</script>

<svelte:head>
  <title>{session && children ? 'Whirm · Passkey wallet' : mode === 'signup' ? 'Whirm · Sign up' : 'Whirm · Sign in'}</title>
</svelte:head>

<main lang="en" class="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-5 py-8 sm:px-10 sm:py-12">
  <header class="flex flex-wrap items-center justify-between gap-3 border-b pb-6">
    <span class="text-xl font-bold tracking-tight">Swissquote <span class="text-primary">×</span> Whirm</span>
    <span class="rounded-full bg-secondary px-3 py-1 text-sm font-semibold">Your account</span>
  </header>

  <div class="my-auto grid gap-10 py-12 md:grid-cols-2 md:items-center md:gap-16">
    {#if session && children}
      {@render children(session, auth.expire)}
    {:else}
      <section aria-labelledby="auth-title">
        <p class="mb-4 text-sm font-semibold uppercase tracking-widest text-accent-foreground">Your connection</p>
        <h1 id="auth-title" class="text-4xl leading-tight sm:text-5xl">Your first step towards a wallet.</h1>
        <p class="mt-6 text-lg text-muted-foreground">{mode === 'signup' ? 'Create your account to start your Whirm journey.' : 'Sign in to your account to continue your Whirm journey.'}</p>
        <p class="mt-6 rounded-lg border bg-secondary p-4 text-sm text-secondary-foreground">Your session identifies you. It does not authorize blockchain spending.</p>
      </section>
    {/if}

    <section aria-labelledby="connection-title" class="rounded-2xl border bg-card p-6 shadow-sm sm:p-8" aria-busy={busy}>
      <h2 id="connection-title" class="text-2xl leading-tight">{session ? 'You are signed in' : mode === 'signup' ? 'Create your account' : 'Sign in to your account'}</h2>
      <p class="mt-2 text-sm text-muted-foreground">{session ? 'Manage your session here.' : mode === 'signup' ? 'Enter your name, email and a new password.' : 'Enter your email and password.'}</p>

      <div class="mt-6 min-h-24" aria-live="polite" aria-atomic="true">
        {#if $auth.status === 'checking'}
          <div role="status" class="rounded-lg border bg-secondary p-4">
            <p class="font-semibold">Checking your session…</p>
            <p class="mt-1 text-sm text-muted-foreground">Checking whether you are already signed in.</p>
          </div>
        {:else if $auth.status === 'connecting'}
          <div role="status" class="rounded-lg border bg-secondary p-4">
            <p class="font-semibold">{mode === 'signup' ? 'Creating your account…' : 'Signing in…'}</p>
            <p class="mt-1 text-sm text-muted-foreground">{mode === 'signup' ? 'Creating your account and opening your session.' : 'Verifying your credentials.'}</p>
          </div>
        {:else if $auth.status === 'disconnecting'}
          <div role="status" class="rounded-lg border bg-secondary p-4">
            <p class="font-semibold">Signing out…</p>
            <p class="mt-1 text-sm text-muted-foreground">Your session is being closed.</p>
          </div>
        {:else if $auth.status === 'refused'}
          <div role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p class="font-semibold">Sign-in failed</p>
            <p class="mt-1 text-sm">Check your email and password, then try again.</p>
          </div>
        {:else if $auth.status === 'expired'}
          <div role="alert" class="rounded-lg border bg-accent p-4 text-accent-foreground">
            <p class="font-semibold">Your session has expired</p>
            <p class="mt-1 text-sm">Sign in again to continue.</p>
          </div>
        {:else if $auth.status === 'error'}
          <div role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p class="font-semibold">Something went wrong</p>
            <p class="mt-1 text-sm">{$auth.message}</p>
          </div>
        {:else if session}
          <div role="status" class="rounded-lg border bg-secondary p-4">
            <p class="font-semibold">Signed in · {session.displayName || session.email}</p>
            <p class="mt-1 break-all text-sm text-muted-foreground">{session.email}</p>
          </div>
        {:else}
          <div role="status" class="rounded-lg border border-dashed p-4">
            <p class="font-semibold">You are signed out</p>
            <p class="mt-1 text-sm text-muted-foreground">No active session.</p>
          </div>
        {/if}
      </div>

      {#if session}
        <Button class="mt-5 w-full bg-accent-foreground hover:bg-accent-foreground/90" size="lg" disabled={busy} onclick={() => auth.disconnect()}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      {:else}
        <form class="mt-5 space-y-4" onsubmit={connect}>
          {#if mode === 'signup'}
            <div>
              <label for="auth-name" class="mb-2 block text-sm font-semibold">Name</label>
              <input id="auth-name" name="displayName" type="text" autocomplete="name" minlength="1" maxlength="150" required bind:value={displayName} disabled={busy} class="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
            </div>
          {/if}
          <div>
            <label for="auth-email" class="mb-2 block text-sm font-semibold">Email</label>
            <input id="auth-email" name="email" type="email" autocomplete="username" maxlength="255" required bind:value={email} disabled={busy} class="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
          </div>
          <div>
            <label for="auth-password" class="mb-2 block text-sm font-semibold">Password</label>
            <input id="auth-password" name="password" type="password" autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} minlength={mode === 'signup' ? 8 : 1} maxlength="1024" aria-describedby={mode === 'signup' ? 'auth-password-requirements' : undefined} required bind:value={password} disabled={busy} class="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
            {#if mode === 'signup'}
              <p id="auth-password-requirements" class="mt-2 text-sm text-muted-foreground">Use 8 to 1024 characters. Uppercase letters, numbers and symbols are optional.</p>
              <p class="mt-2 text-sm text-muted-foreground">This is your bank account password. Create your vault master password separately in Bitwarden.</p>
            {/if}
          </div>
          {#if formMessage}
            <p role="alert" class="text-sm text-destructive">{formMessage}</p>
          {/if}
          <Button type="submit" class="w-full bg-accent-foreground hover:bg-accent-foreground/90" size="lg" disabled={busy}>
            {$auth.status === 'checking' ? 'Checking your session…' : mode === 'signup' ? $auth.status === 'connecting' ? 'Creating your account…' : 'Create account' : $auth.status === 'connecting' ? 'Signing in…' : $auth.status === 'expired' ? 'Sign in again' : $auth.status === 'refused' ? 'Try signing in again' : 'Sign in'}
          </Button>
          <Button type="button" variant="outline" class="w-full" disabled={busy} onclick={switchMode}>
            {mode === 'signup' ? 'Already have an account? Sign in' : 'New to Whirm? Sign up'}
          </Button>
        </form>
      {/if}
    </section>
  </div>

  <footer class="border-t pt-5 text-sm text-muted-foreground">Your password is only used to sign in.</footer>
</main>
