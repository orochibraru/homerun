<script lang="ts">
	import CheckBox from "#lib/components/check-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Input } from "#lib/components/ui/input/index.js";

	interface RedirectValues {
		destination: string;
		enabled: boolean;
		keepPath: boolean;
		permanent: boolean;
		source: string;
	}

	const { values }: { values: RedirectValues } = $props();
</script>

<div>
  <label class={label} for="source">Source</label>
  <Input
    id="source"
    name="source"
    placeholder="old.example.com or example.com/blog"
    required
    type="text"
    value={values.source}
  />
  <p class="text-text-subtle mt-1.5 text-xs">
    A hostname, optionally followed by a path prefix. Point its DNS at this
    server: Traefik requests the certificate for it like any other domain.
  </p>
</div>
<div>
  <label class={label} for="destination">Destination</label>
  <Input
    id="destination"
    name="destination"
    placeholder="https://new.example.com"
    required
    type="url"
    value={values.destination}
  />
</div>
<CheckBox
  checked={values.keepPath}
  helperText="old.example.com/a/b?x=1 goes to the destination's /a/b?x=1. Off sends every request to the destination exactly."
  id="keepPath"
  label="Keep the path and query string"
  name="keepPath"
/>
<CheckBox
  checked={values.permanent}
  helperText="Permanent redirects (308) are cached by browsers. Off sends a temporary redirect (307)."
  id="permanent"
  label="Permanent redirect"
  name="permanent"
/>
<CheckBox
  checked={values.enabled}
  helperText="Turn off to keep the redirect around without serving it."
  id="enabled"
  label="Enabled"
  name="enabled"
/>
