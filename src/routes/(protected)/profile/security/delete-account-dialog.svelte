<script lang="ts">
	import { Trash2 } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient } from "$lib/auth-client";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { toastError } from "$lib/toast";

	let open = $state(false);
	let password = $state("");
	let loading = $state(false);

	async function deleteAccountCallback(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		try {
			const { error } = await authClient.deleteUser({
				callbackURL: resolve("/"),
				password,
			});
			if (error) {
				password = "";
				throw new Error(error.message ?? "Could not delete account.");
			}
			open = false;
			goto(resolve("/"));
		} finally {
			loading = false;
		}
	}

	function deleteAccount(e: SubmitEvent) {
		return toast.promise(deleteAccountCallback(e), {
			error: (error) => toastError(error, "Could not delete account."),
			loading: "Deleting your account",
			success: "Account deleted.",
		});
	}
</script>

<Button
  class="shrink-0 border-red-300 text-red-600 hover:bg-red-500 hover:text-white dark:border-red-700/60"
  onclick={() => {
    password = "";
    open = true;
  }}
  variant="outline"
>
  <Trash2 class="size-4" />
  Delete account
</Button>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Delete your account</Dialog.Title>
      <Dialog.Description>
        This permanently removes your account, sessions, API keys and personal
        settings. Everything you created stays and is handed over to another
        admin. It cannot be undone.
      </Dialog.Description>
    </Dialog.Header>
    <form class="space-y-4" onsubmit={deleteAccount}>
      <PasswordField
        id="deletePassword"
        label="Password"
        placeholder="Confirm your password"
        required
        bind:value={password}
      />
      <Dialog.Footer>
        <Button
          onclick={() => {
            open = false;
            password = "";
          }}
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={loading || !password} type="submit" variant="destructive">
          {#if loading}
            <Spinner />
            Deleting…
          {:else}
            <Trash2 class="size-4" />
            Delete my account
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
