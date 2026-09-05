<script lang="ts">
	import {
		AlertTriangle,
		Eye,
		EyeOff,
		KeyRound,
		Lock,
		ShieldCheck,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import {
		getPasswordStrength,
		getPasswordStrengthMeta,
	} from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	onMount(() => title.set("Security"));

	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");
	let showCurrent = $state(false);
	let showNew = $state(false);
	let showConfirm = $state(false);
	let passwordLoading = $state(false);

	const passwordStrength = $derived(getPasswordStrength(newPassword));
	const confirmPasswordClass = $derived.by(() => {
		if (!confirmPassword) {
			return "";
		}
		return confirmPassword === newPassword
			? "border-green-500 focus:ring-green-500"
			: "border-red-500 focus:ring-red-500";
	});
	const strengthMeta = $derived(getPasswordStrengthMeta(passwordStrength));

	async function changePasswordCallback(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword.length < 12) {
			throw new Error("New password must be at least 12 characters.");
		}
		if (newPassword !== confirmPassword) {
			throw new Error("Passwords do not match.");
		}
		passwordLoading = true;
		try {
			const { error } = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions: true,
			});
			if (error) {
				currentPassword = "";
				throw new Error(error.message ?? "Could not change password.");
			}
			currentPassword = "";
			newPassword = "";
			confirmPassword = "";
		} finally {
			passwordLoading = false;
		}
	}

	function changePassword(e: SubmitEvent) {
		return toast.promise(changePasswordCallback(e), {
			error: (error) => toastError(error, "Could not change password."),
			loading: "Changing your password",
			success: "Password changed. Other sessions have been signed out.",
		});
	}

	// ──────────────────────────────────────────────────────────────
	// Delete account
	// ──────────────────────────────────────────────────────────────
	let deleteDialogOpen = $state(false);
	let deletePassword = $state("");
	let deleteLoading = $state(false);
	let showDeletePassword = $state(false);

	async function deleteAccountCallback(e: SubmitEvent) {
		e.preventDefault();
		deleteLoading = true;
		try {
			const { error } = await authClient.deleteUser({
				callbackURL: resolve("/"),
				password: deletePassword,
			});
			if (error) {
				deletePassword = "";
				throw new Error(error.message ?? "Could not delete account.");
			}
			deleteDialogOpen = false;
			goto(resolve("/"));
		} finally {
			deleteLoading = false;
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

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════
       PASSWORD
       ════════════════════════════════════════════════════════════ -->
  <section class="rounded-2xl glass">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
        <KeyRound class="size-4" />
      </div>
      <div>
        <h2 class="eyebrow">Password</h2>
        <p class="text-xs text-text-muted">
          Change your password. All other sessions will be signed out.
        </p>
      </div>
    </div>

    <form class="space-y-5 p-5" onsubmit={changePassword}>
      <!-- Current password -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-text" for="currentPassword">
          Current password
        </label>
        <div class="relative">
          <Input
            autocomplete="current-password"
            class="pr-11"
            id="currentPassword"
            placeholder="••••••••••••"
            required
            type={showCurrent ? "text" : "password"}
            bind:value={currentPassword}
          />
          <Button
            class="absolute top-1/2 right-1.5 -translate-y-1/2"
            onclick={() => {
              showCurrent = !showCurrent;
            }}
            size="icon-sm"
            variant="ghost"
          >
            {#if showCurrent}
              <EyeOff class="size-4" />
            {:else}
              <Eye class="size-4" />
            {/if}
          </Button>
        </div>
      </div>

      <!-- New password -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-text" for="newPassword">
          New password
        </label>
        <div class="relative">
          <Input
            autocomplete="new-password"
            class="pr-11"
            id="newPassword"
            placeholder="Min. 12 characters"
            required
            type={showNew ? "text" : "password"}
            bind:value={newPassword}
          />
          <Button
            class="absolute top-1/2 right-1.5 -translate-y-1/2"
            onclick={() => {
              showNew = !showNew;
            }}
            size="icon-sm"
            variant="ghost"
          >
            {#if showNew}
              <EyeOff class="size-4" />
            {:else}
              <Eye class="size-4" />
            {/if}
          </Button>
        </div>
        {#if newPassword}
          <div class="mt-2.5">
            <div class="flex gap-1">
              {#each [1, 2, 3, 4] as level}
                <div
                  class="
                    h-1 flex-1 rounded-full transition-all duration-300 {level <=
                    passwordStrength
                    ? strengthMeta.bar
                    : 'bg-(--color-surface-3)'}
                  "
                >
                </div>
              {/each}
            </div>
            <p class="mt-1 text-xs text-text-muted">
              Strength:
              <span class="font-medium {strengthMeta.text}">{
                strengthMeta.label
              }</span>
            </p>
          </div>
        {/if}
      </div>

      <!-- Confirm new password -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-text" for="confirmPassword">
          Confirm new password
        </label>
        <div class="relative">
          <Input
            autocomplete="new-password"
            class="pr-11 {confirmPasswordClass}"
            id="confirmPassword"
            placeholder="Repeat new password"
            required
            type={showConfirm ? "text" : "password"}
            bind:value={confirmPassword}
          />
          <Button
            class="absolute top-1/2 right-1.5 -translate-y-1/2"
            onclick={() => {
              showConfirm = !showConfirm;
            }}
            size="icon-sm"
            variant="ghost"
          >
            {#if showConfirm}
              <EyeOff class="size-4" />
            {:else}
              <Eye class="size-4" />
            {/if}
          </Button>
        </div>
        {#if confirmPassword && confirmPassword !== newPassword}
          <p class="mt-1 text-xs text-red-500">Passwords don't match.</p>
        {:else if confirmPassword && confirmPassword === newPassword}
          <p class="mt-1 flex items-center gap-1 text-xs text-green-600">
            <ShieldCheck class="size-3.5" />
            Passwords match
          </p>
        {/if}
      </div>

      <div class="flex justify-end">
        <Button
          disabled={passwordLoading
          || !currentPassword
          || !newPassword
          || !confirmPassword}
          type="submit"
        >
          {#if passwordLoading}
            <Spinner />
            Updating…
          {:else}
            <Lock class="size-4" />
            Update password
          {/if}
        </Button>
      </div>
    </form>
  </section>

  <!-- ═══════════════════════════════════════════════════════════
       DANGER ZONE
       ════════════════════════════════════════════════════════════ -->
  <section class="rounded-2xl border border-red-200 bg-surface dark:border-red-900/40">
    <div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
      <div class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
        <AlertTriangle class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Danger zone
        </h2>
        <p class="text-xs text-text-muted">
          Irreversible actions. Proceed with caution.
        </p>
      </div>
    </div>

    <div class="p-5">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-text text-sm font-medium">Delete account</p>
          <p class="text-text-muted mt-0.5 text-xs">
            Permanently removes your account, all your services, and their
            deployment history. This cannot be undone.
          </p>
        </div>
        <Button
          class="shrink-0 border-red-300 text-red-600 hover:bg-red-500 hover:text-white dark:border-red-700/60"
          onclick={() => {
            deletePassword = "";
            deleteDialogOpen = true;
          }}
          variant="outline"
        >
          <Trash2 class="size-4" />
          Delete account
        </Button>
      </div>
    </div>
  </section>
</div>

<Dialog.Root bind:open={deleteDialogOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Delete your account</Dialog.Title>
      <Dialog.Description>
        This permanently removes your account, every service you own, their
        containers, and all deployment history. It cannot be undone.
      </Dialog.Description>
    </Dialog.Header>
    <form class="space-y-4" onsubmit={deleteAccount}>
      <div class="relative">
        <Input
          class="pr-11"
          placeholder="Confirm your password"
          required
          type={showDeletePassword ? "text" : "password"}
          bind:value={deletePassword}
        />
        <Button
          class="absolute top-1/2 right-1.5 -translate-y-1/2"
          onclick={() => {
            showDeletePassword = !showDeletePassword;
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {#if showDeletePassword}
            <EyeOff class="size-4" />
          {:else}
            <Eye class="size-4" />
          {/if}
        </Button>
      </div>
      <Dialog.Footer>
        <Button
          onclick={() => {
            deleteDialogOpen = false;
            deletePassword = "";
          }}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={deleteLoading || !deletePassword}
          type="submit"
          variant="destructive"
        >
          {#if deleteLoading}
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
