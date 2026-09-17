<script lang="ts">
	import Alert from "$lib/components/alert.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";

	interface Props {
		errors?: Record<string, string[]>;
		isAdmin: boolean;
		showEnvFiles?: boolean;
		swarm?: boolean;
		values: Record<string, string>;
	}

	const {
		errors,
		isAdmin,
		showEnvFiles = false,
		swarm = false,
		values,
	}: Props = $props();

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";
	const helpClass = "text-text-subtle mt-1.5 text-xs";

	let privileged = $derived(values.privileged === "on");
</script>

<div class="grid gap-5 lg:grid-cols-2">
  <div>
    <label class={label} for="entrypoint">Entrypoint</label>
    <Input
      class="font-mono"
      id="entrypoint"
      name="entrypoint"
      placeholder="/docker-entrypoint.sh"
      type="text"
      value={values.entrypoint ?? ""}
    />
    <p class={helpClass}>
      Replaces the image's entrypoint. Leave blank to keep the image's.
    </p>
    {#if errors?.entrypoint}
      <p class={errorClass}>{errors.entrypoint[0]}</p>
    {/if}
  </div>
  <div>
    <label class={label} for="command">Command</label>
    <Input
      class="font-mono"
      id="command"
      name="command"
      placeholder="redis-server --appendonly yes"
      type="text"
      value={values.command ?? ""}
    />
    <p class={helpClass}>
      Replaces the image's command, split like a shell would : quote an
      argument that has spaces. Not run through a shell, so wrap it in
      <code>sh -c '...'</code> for pipes or variables.
    </p>
    {#if errors?.command}
      <p class={errorClass}>{errors.command[0]}</p>
    {/if}
  </div>
</div>

<div>
  <label class={label} for="labels">Labels</label>
  <Textarea
    class="min-h-24 font-mono text-xs"
    id="labels"
    name="labels"
    placeholder={"com.example.team=platform\ntraefik.http.middlewares.my-headers.headers.customresponseheaders.X-Robots-Tag=noindex"}
    value={values.labels ?? ""}
  />
  <p class={helpClass}>
    One <code>KEY=VALUE</code> per line, added to the container. Homerun's own
    routing and tracking labels win on a clash.
  </p>
  {#if errors?.labels}
    <p class={errorClass}>{errors.labels[0]}</p>
  {/if}
</div>

{#if isAdmin}
  <div class="grid gap-5 lg:grid-cols-2">
    <div>
      <label class={label} for="capAdd">Added capabilities</label>
      <Input
        class="font-mono"
        id="capAdd"
        name="capAdd"
        placeholder="NET_ADMIN, SYS_TIME"
        type="text"
        value={values.capAdd ?? ""}
      />
      <p class={helpClass}>Linux capabilities, separated by commas.</p>
      {#if errors?.capAdd}
        <p class={errorClass}>{errors.capAdd[0]}</p>
      {/if}
    </div>
    <div>
      <label class={label} for="devices">Devices</label>
      <Textarea
        class="min-h-20 font-mono text-xs"
        id="devices"
        name="devices"
        placeholder={"/dev/ttyUSB0:/dev/ttyUSB0\n/dev/dri"}
        value={values.devices ?? ""}
      />
      <p class={helpClass}>
        One <code>host[:container[:rwm]]</code> per line, like
        <code>docker run --device</code>.
      </p>
      {#if errors?.devices}
        <p class={errorClass}>{errors.devices[0]}</p>
      {/if}
    </div>
  </div>

  {#if showEnvFiles}
    <div>
      <label class={label} for="envFiles">Env files</label>
      <Textarea
        class="min-h-20 font-mono text-xs"
        id="envFiles"
        name="envFiles"
        placeholder="/opt/app/.env"
        value={values.envFiles ?? ""}
      />
      <p class={helpClass}>
        <code>.env</code> files on the host, one absolute path per line, read at
        every deploy. Env vars win over a file's, and a file that can't be read
        fails the deploy.
      </p>
      {#if errors?.envFiles}
        <p class={errorClass}>{errors.envFiles[0]}</p>
      {/if}
    </div>
  {/if}

  <CheckBox
    helperText="Gives the container every capability and access to every host device. Only for software that genuinely needs it."
    id="privileged"
    label="Run privileged"
    name="privileged"
    bind:checked={privileged}
  />
{:else}
  <input name="capAdd" type="hidden" value={values.capAdd ?? ""} />
  <input name="devices" type="hidden" value={values.devices ?? ""} />
  {#if showEnvFiles}
    <input name="envFiles" type="hidden" value={values.envFiles ?? ""} />
  {/if}
  {#if privileged}
    <input name="privileged" type="hidden" value="on" />
  {/if}
  <div class="border-border space-y-1 rounded-md border p-3 text-xs">
    <p class="text-text font-medium">Host access</p>
    <p class="text-text-muted">
      Added capabilities: {values.capAdd || "none"} · Devices:
      {values.devices ? values.devices.split("\n").join(", ") : "none"} ·
      {#if showEnvFiles}
        Env files:
        {values.envFiles ? values.envFiles.split("\n").join(", ") : "none"} ·
      {/if}
      Privileged: {privileged ? "yes" : "no"}
    </p>
    <p class="text-text-subtle">
      Only an admin can change these : they give the container access to the
      host.
    </p>
  </div>
{/if}

{#if swarm && (privileged || values.devices)}
  <Alert variant="warning">
    Swarm services can't run privileged or map devices : those two are ignored
    while the instance runs in swarm mode.
  </Alert>
{/if}
