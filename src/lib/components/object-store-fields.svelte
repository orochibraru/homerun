<script lang="ts">
	import { inputClass, labelClass } from "#lib/components/form-styles.js";

	interface Props {
		accessKeyId?: string;
		endpoint?: string;
		keepSecret?: boolean;
		name?: string;
		region?: string;
	}

	const {
		accessKeyId = "",
		endpoint = "",
		keepSecret = false,
		name = "",
		region = "",
	}: Props = $props();
</script>

<div class="grid gap-4 sm:grid-cols-2">
  <div>
    <label class={labelClass} for="storeName">Name</label>
    <input
      id="storeName"
      class={inputClass}
      autocomplete="off"
      name="name"
      placeholder="Hetzner Falkenstein"
      required
      value={name}
    />
  </div>
  <div>
    <label class={labelClass} for="storeEndpoint">Endpoint</label>
    <input
      id="storeEndpoint"
      class={inputClass}
      autocomplete="off"
      name="endpoint"
      placeholder="https://fsn1.your-objectstorage.com"
      required
      type="url"
      value={endpoint}
    />
  </div>
  <div>
    <label class={labelClass} for="storeRegion">Region</label>
    <input
      id="storeRegion"
      class={inputClass}
      autocomplete="off"
      name="region"
      placeholder="us-east-1"
      value={region}
    />
  </div>
  <div>
    <label class={labelClass} for="storeAccessKeyId">Access key id</label>
    <input
      id="storeAccessKeyId"
      class={inputClass}
      autocomplete="off"
      name="accessKeyId"
      required
      value={accessKeyId}
    />
  </div>
  <div class="sm:col-span-2">
    <label class={labelClass} for="storeSecret">Secret access key</label>
    <input
      id="storeSecret"
      class={inputClass}
      autocomplete="new-password"
      name="secretAccessKey"
      placeholder={keepSecret ? "Leave empty to keep the stored one" : ""}
      required={!keepSecret}
      type="password"
    />
  </div>
</div>
