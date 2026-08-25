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
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import {
		getPasswordStrength,
		getPasswordStrengthMeta,
	} from "$lib/formatting";
	import { title } from "$lib/store/title";

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

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword.length < 12) {
			toast.error("New password must be at least 12 characters.");
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.error("Passwords do not match.");
			return;
		}
		passwordLoading = true;
		try {
			const { error } = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions: true,
			});
			if (error) {
				toast.error(error.message ?? "Could not change password.");
			} else {
				toast.success("Password changed. Other sessions have been signed out.");
				currentPassword = "";
				newPassword = "";
				confirmPassword = "";
			}
		} catch {
			toast.error("An unexpected error occurred.");
		} finally {
			passwordLoading = false;
		}
	}

	// ──────────────────────────────────────────────────────────────
	// Delete account
	// ──────────────────────────────────────────────────────────────
	let showDeleteConfirm = $state(false);
	let deletePassword = $state("");
	let deleteLoading = $state(false);
	let showDeletePassword = $state(false);

	async function deleteAccount(e: SubmitEvent) {
		e.preventDefault();
		deleteLoading = true;
		try {
			const { error } = await authClient.deleteUser({
				callbackURL: resolve("/"),
				password: deletePassword,
			});
			if (error) {
				toast.error(error.message ?? "Could not delete account.");
			} else {
				toast.success("Account deleted.");
				goto(resolve("/"));
			}
		} catch {
			toast.error("An unexpected error occurred.");
		} finally {
			deleteLoading = false;
		}
	}
</script>

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════
       PASSWORD
       ════════════════════════════════════════════════════════════ -->
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
        <KeyRound class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-text">Password</h2>
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
      {#if !showDeleteConfirm}
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-text">Delete account</p>
            <p class="mt-0.5 text-xs text-text-muted">
              Permanently removes your account, all your services, and their
              deployment history. This cannot be undone.
            </p>
          </div>
          <Button
            class="shrink-0 border-red-300 text-red-600 hover:bg-red-500 hover:text-white dark:border-red-700/60"
            onclick={() => {
              showDeleteConfirm = true;
            }}
            variant="outline"
          >
            Delete account
          </Button>
        </div>
      {:else}
        <form class="space-y-4" onsubmit={deleteAccount}>
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
            <p class="font-semibold">Are you absolutely sure?</p>
            <p class="mt-1">
              Enter your current password to confirm deletion. All data will be
              permanently erased.
            </p>
          </div>

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
              variant="ghost"
            >
              {#if showDeletePassword}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </Button>
          </div>

          <div class="flex items-center gap-3">
            <Button
              onclick={() => {
                showDeleteConfirm = false;
                deletePassword = "";
              }}
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
                Yes, delete my account
              {/if}
            </Button>
          </div>
        </form>
      {/if}
    </div>
  </section>
</div>
