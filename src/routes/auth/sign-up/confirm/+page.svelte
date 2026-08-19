<script lang="ts">
	import {
		ArrowRight,
		CheckCircle,
		FlaskConical,
		Loader2,
		Mail,
		RefreshCw,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient } from "$lib/auth-client";
	import { title } from "$lib/store/title";
	import type { PageData } from "./$types";

	const { data }: { data: PageData } = $props();

	onMount(() => title.set("Confirm your email"));

	let resending = $state(false);
	let resent = $state(false);
	let checking = $state(false);

	// ── Resend verification email ──────────────────────────────────────
	async function resendEmail() {
		resending = true;
		resent = false;
		try {
			await authClient.sendVerificationEmail({
				email: data.email,
				callbackURL: resolve("/"),
			});
			resent = true;
			toast.success("Verification email sent! Check your inbox.");
		} catch {
			toast.error("Could not resend the email. Please try again.");
		} finally {
			resending = false;
		}
	}

	// ── Poll / manual check ────────────────────────────────────────────
	async function checkVerification() {
		checking = true;
		try {
			// Re-fetch the session; if email is now verified the server
			// will redirect away from this page on the next full load.
			const session = await authClient.getSession();
			if (session.data?.user?.emailVerified) {
				toast.success("Email verified! Taking you to your dashboard…");
				goto(resolve("/"));
			} else {
				toast.info("Not verified yet — check your inbox and click the link.");
			}
		} catch {
			toast.error("Could not check verification status.");
		} finally {
			checking = false;
		}
	}

	// ── Dev bypass ─────────────────────────────────────────────────────
	function devBypass() {
		goto(resolve("/"));
	}
</script>

<div
    class="flex justify-center items-center px-4 min-h-[calc(100vh-4rem)] bg-[var(--color-bg)]"
>
    <div class="w-full max-w-lg">
        <!-- ── Main card ──────────────────────────────────────────────── -->
        <div
            class="p-8 text-center rounded-2xl border shadow-sm border-[var(--color-border)] bg-[var(--color-surface)]"
        >
            <!-- Icon -->
            <div
                class="flex justify-center items-center mx-auto mb-6 rounded-2xl ring-8 size-16 bg-accent/10 ring-accent/5"
            >
                <Mail class="size-8 text-accent" />
            </div>

            <!-- Heading -->
            <h1 class="text-2xl font-bold text-[var(--color-text)]">
                Check your inbox
            </h1>
            <p
                class="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)]"
            >
                We sent a confirmation link to
                <strong class="font-semibold text-[var(--color-text)]"
                    >{data.email}</strong
                >.
                <br />
                Click that link to verify your account and access your
                dashboard.
            </p>

            <!-- Steps -->
            <ol class="mt-6 space-y-2 text-left">
                {#each ["Open the email from Local Run", 'Click the "Confirm email" button', "You'll be signed in automatically"] as step, i}
                    <li
                        class="flex gap-3 items-start text-sm text-[var(--color-text-muted)]"
                    >
                        <span
                            class="flex justify-center items-center mt-0.5 text-xs font-bold rounded-full size-5 shrink-0 bg-accent/10 text-accent"
                        >
                            {i + 1}
                        </span>
                        {step}
                    </li>
                {/each}
            </ol>

            <!-- Already confirmed? -->
            <button
                onclick={checkVerification}
                disabled={checking}
                class="flex gap-2 justify-center items-center py-3 px-4 mt-7 w-full text-sm font-semibold text-white rounded-xl shadow-sm transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed bg-accent shadow-accent/30 hover:bg-accent-dark"
            >
                {#if checking}
                    <Loader2 class="animate-spin size-4" />
                    Checking…
                {:else}
                    <CheckCircle class="size-4" />
                    I've confirmed my email
                    <ArrowRight class="size-4" />
                {/if}
            </button>

            <!-- Resend -->
            <div class="mt-4">
                {#if resent}
                    <p
                        class="flex gap-1.5 justify-center items-center text-sm text-green-600"
                    >
                        <CheckCircle class="size-4" />
                        Email sent! Check your spam folder if you don't see it.
                    </p>
                {:else}
                    <button
                        onclick={resendEmail}
                        disabled={resending}
                        class="inline-flex gap-1.5 items-center text-sm transition-colors disabled:opacity-60 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                        {#if resending}
                            <Loader2 class="animate-spin size-3.5" />
                            Sending…
                        {:else}
                            <RefreshCw class="size-3.5" />
                            Resend confirmation email
                        {/if}
                    </button>
                {/if}
            </div>

            <!-- Sign in with a different account -->
            <p class="mt-6 text-xs text-[var(--color-text-subtle)]">
                Wrong email?
                <a
                    href={resolve("/auth/sign-up")}
                    class="hover:underline text-accent"
                >
                    Create a new account
                </a>
                or
                <a
                    href={resolve("/auth/sign-in")}
                    class="hover:underline text-accent"
                >
                    sign in to a different one
                </a>.
            </p>
        </div>

        <!-- ── Dev-only bypass ─────────────────────────────────────────── -->
        {#if data.isDev}
            <div
                class="overflow-hidden mt-4 rounded-2xl border border-amber-300/40 bg-amber-50/80 dark:border-amber-500/20 dark:bg-amber-950/20"
            >
                <div
                    class="flex gap-3 items-start py-3 px-4 border-b border-amber-200/60 dark:border-amber-800/30"
                >
                    <TriangleAlert
                        class="mt-0.5 text-amber-600 dark:text-amber-400 size-4 shrink-0"
                    />
                    <div>
                        <p
                            class="text-xs font-semibold text-amber-800 dark:text-amber-300"
                        >
                            Development mode
                        </p>
                        <p
                            class="mt-0.5 text-xs text-amber-700 dark:text-amber-400"
                        >
                            SMTP is not configured, so no email was sent. You
                            can bypass verification to continue working locally.
                        </p>
                    </div>
                    <span
                        class="flex gap-1 items-center py-0.5 px-2 ml-auto font-bold tracking-wide text-amber-700 bg-amber-100 rounded-full dark:text-amber-300 text-[10px] dark:bg-amber-900/50"
                    >
                        <FlaskConical class="size-3" />
                        DEV
                    </span>
                </div>
                <div class="py-3 px-4">
                    <button
                        onclick={devBypass}
                        class="flex gap-2 justify-center items-center py-2.5 px-4 w-full text-sm font-medium text-amber-800 bg-white rounded-xl border border-amber-300 transition-all duration-200 dark:text-amber-300 hover:bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/30 dark:hover:bg-amber-900/50"
                    >
                        <FlaskConical class="size-4" />
                        Skip verification and go to dashboard
                        <ArrowRight class="size-4" />
                    </button>
                </div>
            </div>
        {/if}
    </div>
</div>
