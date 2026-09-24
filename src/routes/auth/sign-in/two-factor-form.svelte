<script lang="ts">
	import { ArrowLeft, ArrowRight } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { authClient } from "$lib/auth-client";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { toastError } from "$lib/toast";

	interface Props {
		loading: boolean;
		onBack: () => void;
		onVerified: () => Promise<void>;
		successMessage?: string;
	}

	let {
		loading = $bindable(),
		onBack,
		onVerified,
		successMessage,
	}: Props = $props();

	let mode = $state<"backup" | "totp">("totp");
	let code = $state("");
	let trustDevice = $state(false);

	async function verifyCallback(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		try {
			const input = { code: code.trim(), trustDevice };
			const { error } =
				mode === "totp"
					? await authClient.twoFactor.verifyTotp(input)
					: await authClient.twoFactor.verifyBackupCode(input);
			if (error) {
				throw new Error(error.message ?? "That code didn't match.");
			}
			await onVerified();
		} catch (err) {
			code = "";
			loading = false;
			throw err;
		}
	}

	function handleVerify(e: SubmitEvent) {
		return toast.promise(verifyCallback(e), {
			error: (err) => toastError(err, "That code didn't match."),
			loading: "Checking your code",
			...(successMessage ? { success: successMessage } : {}),
		});
	}
</script>

<form class="space-y-4" novalidate onsubmit={handleVerify}>
  <p class="text-text-muted text-sm">
    {#if mode === "totp"}
      Enter the 6-digit code from your authenticator app.
    {:else}
      Enter one of the backup codes you saved when setting up two-factor
      authentication.
    {/if}
  </p>
  <div>
    <label class="text-text mb-1.5 block text-sm font-medium" for="twoFactorCode">
      {mode === "totp" ? "Verification code" : "Backup code"}
    </label>
    <Input
      autocomplete="one-time-code"
      class="h-10 font-mono tracking-widest"
      disabled={loading}
      id="twoFactorCode"
      inputmode={mode === "totp" ? "numeric" : "text"}
      placeholder={mode === "totp" ? "123456" : "xxxxx-xxxxx"}
      required
      bind:value={code}
    />
  </div>
  <CheckBox
    helperText="Skip the code on this browser for the next 30 days."
    id="trustDevice"
    label="Trust this device"
    name="trustDevice"
    bind:checked={trustDevice}
  />
  <Button class="h-10 w-full" disabled={loading || !code.trim()} type="submit">
    {#if loading}
      <Spinner />
      Verifying…
    {:else}
      Verify
      <ArrowRight class="size-4 opacity-70" />
    {/if}
  </Button>
  <div class="flex items-center justify-between gap-2">
    <Button disabled={loading} onclick={onBack} size="sm" variant="ghost">
      <ArrowLeft class="size-4" />
      Back
    </Button>
    <Button
      disabled={loading}
      onclick={() => {
        mode = mode === "totp" ? "backup" : "totp";
        code = "";
      }}
      size="sm"
      variant="ghost"
    >
      {mode === "totp" ? "Use a backup code" : "Use authenticator app"}
    </Button>
  </div>
</form>
