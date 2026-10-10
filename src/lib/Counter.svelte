<script lang="ts">
  import { Button } from '$lib/components/ui/button'

  let count: number = $state(0)
  const increment = () => {
    count += 1
  }
</script>

<Button type="button" class="counter" onclick={increment}>
  Count is {count}
</Button>
