<script lang="ts">
	import { LayoutGrid } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import { enhanceToast } from "$lib/toast";
</script>

<section class="panel rounded-md">
  <div class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
        <LayoutGrid class="size-4" />
      </div>
      <div>
        <p class="text-text text-sm font-medium">Save as template</p>
        <p class="text-text-muted text-xs">
          Reuse this config to deploy another service later.
        </p>
      </div>
    </div>
    <form
      action="?/saveAsTemplate"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the template.",
        loading: "Saving as a template",
        success: "Saved as a template.",
      })}
    >
      <Button class="shrink-0" type="submit" variant="outline">
        Save as template
      </Button>
    </form>
  </div>
</section>
