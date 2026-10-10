<script lang="ts">
  import { Auth } from '$lib/auth'
  import { Wallet } from '$lib/wallet'
</script>

<Auth>
  {#snippet children(session, expireSession)}
    {#key session.id}
      <Wallet userId={session.id} onSessionExpired={expireSession} />
    {/key}
  {/snippet}
</Auth>
