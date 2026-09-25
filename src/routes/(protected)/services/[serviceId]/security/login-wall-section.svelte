<script lang="ts">
	import { Check, LockKeyhole } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		authError?: string;
		dashboardOrigin: string | null;
		oauthProviders: { label: string; method: string; name: string }[];
		svc: {
			authAllowedEmails: string[];
			authAllowedGroups: string[];
			authAllowedUserIds: string[];
			authProviders: string[];
			authRequired: boolean;
			dnsResolvable: boolean;
			id: string;
		};
		users: { email: string; id: string; name: string }[];
	}

	const { authError, dashboardOrigin, oauthProviders, svc, users }: Props =
		$props();

	let submittingAuth = $state(false);
	let authRequired = $derived(svc.authRequired);
	let methods = $derived([...svc.authProviders]);
	let allowedUserIds = $derived([...svc.authAllowedUserIds]);

	function toggleMethod(method: string, checked: boolean) {
		methods = checked
			? [...new Set([...methods, method])]
			: methods.filter((entry) => entry !== method);
	}

	function toggleUser(userId: string, checked: boolean) {
		allowedUserIds = checked
			? [...new Set([...allowedUserIds, userId])]
			: allowedUserIds.filter((entry) => entry !== userId);
	}
</script>

<section class="panel rounded-md">
  <PanelHeader icon={LockKeyhole} title="Login wall">
    {#snippet description()}
      {#if svc.authRequired}
        Visitors are sent to this instance's sign-in page before they reach
        this app.
      {:else}
        Open to anyone who can reach it.
      {/if}
    {/snippet}
  </PanelHeader>

  {#if !svc.dnsResolvable}
    <p class="text-text-muted p-5 text-sm">
      Not applicable : this service isn't publicly routed, so it has no
      Traefik router to gate. Turn on DNS resolvability on the
      <a
        class="text-accent underline"
        href={resolve("/(protected)/services/[serviceId]/networking", {
          serviceId: svc.id,
        })}
      >Networking</a>
      tab first.
    </p>
  {:else}
    <form
      action="?/updateAppAuth"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the access rules.",
        loading: "Saving access rules",
        onSettled: () => {
          submittingAuth = false;
        },
        onStart: () => {
          submittingAuth = true;
        },
        success: (data) =>
          (data as { redeploying?: boolean } | undefined)?.redeploying
            ? "Access rules saved. Redeploying so the login wall change reaches Traefik."
            : "Access rules saved.",
      })}
    >
      {#if authError}
        <p class="text-xs text-red-500">{authError}</p>
      {/if}

      <CheckBox
        helperText="Send anonymous visitors to Homerun's sign-in page instead of letting them through"
        id="authRequired"
        label="Require login to access this app"
        name="authRequired"
        bind:checked={authRequired}
      />

      {#if authRequired}
        {#if !dashboardOrigin}
          <p class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
            Set Origin under Settings → General first. The login wall
            redirects visitors to this instance's own sign-in page, so
            Homerun has to know its own public URL to send them there.
          </p>
        {/if}

        <div class="border-border border-t pt-4">
          <p class={label}>Sign-in methods</p>
          <p class="text-text-subtle mb-2 text-xs">
            Nothing is enabled by default. Pick every method someone may use
            to get into this app.
          </p>
          <div class="space-y-2">
            <CheckBox
              checked={methods.includes("password")}
              helperText="Homerun's own email and password accounts"
              id="method-password"
              label="Built-in Homerun login"
              name="method-password"
              onCheckedChange={(v) => toggleMethod("password", v)}
            />
            {#each oauthProviders as provider (provider.method)}
              <CheckBox
                checked={methods.includes(provider.method)}
                helperText="OAuth / OIDC provider configured under Authentication"
                id="method-{provider.name}"
                label={provider.label}
                name="method-{provider.name}"
                onCheckedChange={(v) => toggleMethod(provider.method, v)}
              />
            {/each}
            {#if oauthProviders.length === 0}
              <p class="text-text-subtle text-xs">
                No OAuth provider is enabled yet. Add one on the
                <a class="text-accent" href={resolve("/authentication/providers")}>
                  Authentication
                </a>
                page to offer it here.
              </p>
            {/if}
          </div>
          {#each methods as method (method)}
            <input name="authProvider" type="hidden" value={method}>
          {/each}
        </div>

        <div class="border-border border-t pt-4">
          <p class={label}>Who's allowed</p>
          <p class="text-text-subtle mb-3 text-xs">
            Leave all three empty to let any signed-in user through, as long
            as they used one of the methods above. Filling any of them
            narrows access to whoever matches at least one entry in that
            list.
          </p>

          <div class="space-y-3">
            <div>
              <p class="text-text mb-1.5 text-xs font-medium">Users</p>
              <div class="max-h-40 space-y-1.5 overflow-y-auto">
                {#each users as u (u.id)}
                  <CheckBox
                    checked={allowedUserIds.includes(u.id)}
                    helperText={u.email}
                    id="user-{u.id}"
                    label={u.name}
                    name="user-{u.id}"
                    onCheckedChange={(v) => toggleUser(u.id, v)}
                  />
                {/each}
              </div>
              {#each allowedUserIds as userId (userId)}
                <input name="authAllowedUserId" type="hidden" value={userId}>
              {/each}
            </div>

            <div>
              <label class={label} for="authAllowedEmails">Emails</label>
              <Textarea
                class=""
                id="authAllowedEmails"
                name="authAllowedEmails"
                placeholder={"ada@example.com\n*@example.com"}
                rows={3}
                value={svc.authAllowedEmails.join("\n")}
              />
              <p class="text-text-subtle mt-1.5 text-xs">
                One per line. A
                <span class="">*@domain.com</span>
                entry matches every address at that domain.
              </p>
            </div>

            <div>
              <label class={label} for="authAllowedGroups">
                Groups / roles
              </label>
              <Textarea
                class=""
                id="authAllowedGroups"
                name="authAllowedGroups"
                placeholder={"platform-team\nadmins"}
                rows={3}
                value={svc.authAllowedGroups.join("\n")}
              />
              <p class="text-text-subtle mt-1.5 text-xs">
                One per line, matched against the group and role claims in
                the id token your OAuth provider issued
                (<span class="">groups</span>,
                <span class="">roles</span>, and Keycloak's realm and
                resource roles). Make sure the provider's scopes actually
                request them.
              </p>
            </div>
          </div>
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-3">
        <Button disabled={submittingAuth} type="submit" variant="outline">
          {#if submittingAuth}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
      </div>
    </form>
  {/if}
</section>
