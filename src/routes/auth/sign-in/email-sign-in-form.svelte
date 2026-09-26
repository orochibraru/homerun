<script lang="ts">
	import { ArrowRight, MailCheck } from "@lucide/svelte";
	import { onDestroy, onMount, type Snippet } from "svelte";
	import { toast } from "svelte-sonner";
	import { authClient } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { toastError } from "$lib/toast";

	interface Props {
		email: string;
		loading: boolean;
		mode: "code" | "link";
		onSignedIn: () => Promise<void>;
		onTwoFactor: () => void;
		redirectTo: string | null;
		successMessage?: string;
		summary: Snippet;
	}

	let {
		email,
		loading = $bindable(),
		mode,
		onSignedIn,
		onTwoFactor,
		redirectTo,
		successMessage,
		summary,
	}: Props = $props();

	const CODE_LENGTH = 6;
	const RESEND_COOLDOWN_SECONDS = 30;

	let code = $state("");
	let sending = $state(false);
	let cooldown = $state(0);
	let timer: ReturnType<typeof setInterval> | undefined;

	function startCooldown() {
		cooldown = RESEND_COOLDOWN_SECONDS;
		clearInterval(timer);
		timer = setInterval(() => {
			cooldown = Math.max(cooldown - 1, 0);
			if (cooldown === 0) {
				clearInterval(timer);
			}
		}, 1000);
	}

	onDestroy(() => clearInterval(timer));

	async function sendCallback() {
		sending = true;
		try {
			const { error } =
				mode === "code"
					? await authClient.emailOtp.sendVerificationOtp({
							email,
							type: "sign-in",
						})
					: await authClient.signIn.magicLink({
							email,
							metadata: { redirectTo },
						});
			if (error) {
				throw new Error(error.message ?? "Couldn't send the email.");
			}
			startCooldown();
		} finally {
			sending = false;
		}
	}

	function handleSend() {
		return toast.promise(sendCallback(), {
			error: (err) => toastError(err, "Couldn't send the email."),
			loading: mode === "code" ? "Sending a code" : "Sending a sign-in link",
			success:
				mode === "code"
					? `We emailed a code to ${email}.`
					: `We emailed a sign-in link to ${email}.`,
		});
	}

	onMount(() => {
		void handleSend();
	});

	async function verifyCallback(e?: SubmitEvent) {
		e?.preventDefault();
		loading = true;
		try {
			const { data: result, error } = await authClient.signIn.emailOtp({
				email,
				otp: code,
			});
			if (error) {
				throw new Error(error.message ?? "That code didn't match.");
			}
			if (result && "twoFactorRedirect" in result && result.twoFactorRedirect) {
				loading = false;
				onTwoFactor();
				return;
			}
			await onSignedIn();
		} catch (err) {
			code = "";
			loading = false;
			throw err;
		}
	}

	function handleVerify(e?: SubmitEvent) {
		return toast.promise(verifyCallback(e), {
			error: (err) => toastError(err, "That code didn't match."),
			loading: "Checking your code",
			...(successMessage ? { success: successMessage } : {}),
		});
	}

	function onCodeInput(e: Event & { currentTarget: HTMLInputElement }) {
		code = e.currentTarget.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
		e.currentTarget.value = code;
		if (code.length === CODE_LENGTH && !loading) {
			void handleVerify();
		}
	}
</script>

{#snippet resend()}
  <div class="text-center">
    <button
      class="text-text-muted hover:text-text text-xs underline-offset-4 hover:underline disabled:no-underline disabled:opacity-60"
      disabled={loading || sending || cooldown > 0}
      onclick={handleSend}
      type="button"
    >
      {#if cooldown > 0}
        Send another in {cooldown}s
      {:else}
        {mode === "code" ? "Send a new code" : "Send a new link"}
      {/if}
    </button>
  </div>
{/snippet}

{#if mode === "code"}
  <form class="space-y-4" novalidate onsubmit={handleVerify}>
    {@render summary()}
    <p class="text-text-muted text-sm">
      Enter the 6-digit code we emailed you. It expires in 10 minutes.
    </p>
    <div>
      <label class="text-text mb-1.5 block text-sm font-medium" for="emailCode">
        Sign-in code
      </label>
      <Input
        autocomplete="one-time-code"
        class="h-10 font-mono tracking-widest"
        disabled={loading}
        id="emailCode"
        inputmode="numeric"
        oninput={onCodeInput}
        placeholder="123456"
        required
        value={code}
      />
    </div>
    <Button
      class="h-10 w-full"
      disabled={loading || code.length !== CODE_LENGTH}
      type="submit"
    >
      {#if loading}
        <Spinner />
        Signing in…
      {:else}
        Sign in
        <ArrowRight class="size-4 opacity-70" />
      {/if}
    </Button>
    {@render resend()}
  </form>
{:else}
  <div class="space-y-4">
    {@render summary()}
    <div class="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
      <MailCheck class="text-accent mt-0.5 size-4 shrink-0" />
      <p class="text-text-muted text-sm">
        We emailed a sign-in link to {email}. Open it within 10 minutes to
        finish signing in; you can close this tab.
      </p>
    </div>
    {@render resend()}
  </div>
{/if}
