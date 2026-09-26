<script lang="ts">
	import { ShieldCheck } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		svc: { id: string; imageScanEnabled: boolean };
	}

	const { svc }: Props = $props();
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <ShieldCheck class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Image scanning</p>
      <p class="text-text-muted text-xs">
        Scans the image for known vulnerabilities on every deploy, through
        Homerun's pull mirror. Results are on the
        <a
          class="text-accent underline"
          href={resolve("/(protected)/services/[serviceId]/security", {
            serviceId: svc.id,
          })}
        >Security</a>
        tab.
      </p>
    </div>
  </div>
  <form
    action="?/updateImageScan"
    class="space-y-3"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save image scanning.",
      loading: "Saving image scanning",
      success: "Saved.",
    })}
  >
    <CheckBox
      checked={svc.imageScanEnabled}
      helperText="Pull through the mirror and scan before this service's workload starts. Turning it off pulls straight from the registry."
      id="imageScanEnabled"
      label="Scan this service's image"
      name="imageScanEnabled"
    />
    <Button type="submit" variant="outline">Save</Button>
  </form>
</section>
