<script lang="ts">
	import {
		Calendar,
		Car,
		DollarSign,
		Eye,
		MapPin,
		UserCheck,
		UserPlus,
		Users,
		Wrench,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { title } from "$lib/store/title";
	import type { PageData } from "./$types";

	const { data }: { data: PageData } = $props();

	onMount(() => title.set(data.profile.username));

	let activeTab = $state<"builds" | "about">("builds");
	let following = $derived(data.isFollowing);
	let followerCount = $derived(data.stats.followerCount);
	let followLoading = $state(false);

	function formatSpend(cents: number): string {
		if (cents === 0) return "$0";
		if (cents >= 100_000_00) return `$${(cents / 100_000_00).toFixed(1)}k`;
		if (cents >= 100_000) return `$${(cents / 100_000).toFixed(1)}k`;
		return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
	}

	function formatJoined(date: Date): string {
		return new Date(date).toLocaleDateString("en-US", {
			month: "long",
			year: "numeric",
		});
	}

	// Deterministic gradient from user ID
	const GRADIENTS = [
		"from-violet-600 via-purple-700 to-indigo-900",
		"from-blue-600 via-indigo-700 to-violet-900",
		"from-rose-600 via-pink-700 to-purple-900",
		"from-emerald-600 via-teal-700 to-cyan-900",
		"from-amber-600 via-orange-700 to-red-900",
		"from-fuchsia-600 via-violet-700 to-purple-900",
	] as const;

	function carGradient(id: string): string {
		let h = 0;
		for (let i = 0; i < id.length; i++) {
			h = Math.imul(31, h) + id.charCodeAt(i);
			h = h | 0;
		}
		return GRADIENTS[Math.abs(h) % GRADIENTS.length];
	}

	async function toggleFollow() {
		if (!data.currentUserId) {
			goto(resolve("/auth/sign-in"));
			return;
		}
		if (followLoading) return;
		followLoading = true;

		const wasFollowing = following;
		following = !following;
		followerCount = following ? followerCount + 1 : followerCount - 1;

		try {
			const res = await fetch("/api/follows", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ followingId: data.owner.id }),
			});
			if (res.status === 401) {
				goto(resolve("/auth/sign-in"));
				return;
			}
			if (!res.ok) throw new Error("Failed");
			const result = await res.json();
			following = result.following;
			followerCount = result.following ? followerCount : followerCount;
		} catch {
			following = wasFollowing;
			followerCount = wasFollowing ? followerCount + 1 : followerCount - 1;
		} finally {
			followLoading = false;
		}
	}
</script>

<div class="min-h-screen bg-[var(--color-bg)]">
    <!-- ── Cover image ───────────────────────────────────────────── -->
    <div class="overflow-hidden relative h-48 sm:h-56">
        {#if data.profile.coverImage}
            <img
                src={data.profile.coverImage}
                alt="Cover"
                class="object-cover w-full h-full"
            />
        {:else}
            <div
                class="w-full h-full bg-gradient-to-br to-purple-900 from-[var(--color-accent)]"
            ></div>
        {/if}
        <!-- Fade to page bg at the bottom -->
        <div
            class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent from-[var(--color-bg)]"
        ></div>
    </div>

    <!-- ── Profile header ────────────────────────────────────────── -->
    <div class="px-4 mx-auto max-w-4xl sm:px-6 lg:px-8">
        <div
            class="flex flex-col gap-4 -mt-14 sm:flex-row sm:justify-between sm:items-end sm:-mt-16"
        >
            <!-- Avatar + name -->
            <div class="flex gap-4 items-end">
                {#if data.owner.image}
                    <img
                        src={data.owner.image}
                        alt={data.owner.name}
                        class="object-cover rounded-2xl ring-4 size-24 ring-[var(--color-bg)] sm:size-28"
                    />
                {:else}
                    <div
                        class="flex justify-center items-center text-3xl font-bold text-white rounded-2xl ring-4 size-24 bg-accent ring-[var(--color-bg)] sm:size-28"
                    >
                        {data.owner.name[0]?.toUpperCase() ?? "?"}
                    </div>
                {/if}

                <div class="pb-1">
                    <h1
                        class="text-xl font-bold sm:text-2xl text-[var(--color-text)]"
                    >
                        {data.owner.name}
                    </h1>
                    <p class="text-sm text-[var(--color-text-muted)]">
                        @{data.profile.username}
                    </p>
                </div>
            </div>

            <!-- Follow / self-edit button -->
            <div class="pb-1 sm:pb-2">
                {#if data.isSelf}
                    <a
                        href={resolve("/dashboard")}
                        class="inline-flex gap-2 items-center py-2 px-5 text-sm font-medium rounded-xl border transition-all border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                    >
                        Edit profile
                    </a>
                {:else if data.currentUserId}
                    <button
                        onclick={toggleFollow}
                        disabled={followLoading}
                        class="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-medium transition-all disabled:opacity-60
							{following
                            ? 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
                            : 'bg-accent text-white hover:bg-accent-dark'}"
                    >
                        {#if following}
                            <UserCheck class="size-4" />
                            Following
                        {:else}
                            <UserPlus class="size-4" />
                            Follow
                        {/if}
                    </button>
                {:else}
                    <a
                        href={resolve("/auth/sign-in")}
                        class="inline-flex gap-2 items-center py-2 px-5 text-sm font-medium text-white rounded-xl bg-accent hover:bg-accent-dark"
                    >
                        <UserPlus class="size-4" />
                        Follow
                    </a>
                {/if}
            </div>
        </div>

        <!-- Bio & location -->
        {#if data.profile.bio || data.profile.location}
            <div class="mt-4 space-y-1.5">
                {#if data.profile.bio}
                    <p class="max-w-xl text-sm text-[var(--color-text-muted)]">
                        {data.profile.bio}
                    </p>
                {/if}
                {#if data.profile.location}
                    <p
                        class="inline-flex gap-1.5 items-center text-xs text-[var(--color-text-subtle)]"
                    >
                        <MapPin class="size-3.5" />
                        {data.profile.location}
                    </p>
                {/if}
            </div>
        {/if}

        <!-- ── Stats row ──────────────────────────────────────────── -->
        <div
            class="flex flex-wrap gap-6 pb-5 mt-5 border-b border-[var(--color-border)]"
        >
            {#each [{ label: "Cars", value: data.stats.carCount }, { label: "Mods", value: data.stats.modCount }, { label: "Followers", value: followerCount }, { label: "Following", value: data.stats.followingCount }] as stat}
                <div class="text-center">
                    <p class="text-xl font-bold text-[var(--color-text)]">
                        {stat.value}
                    </p>
                    <p class="text-xs text-[var(--color-text-muted)]">
                        {stat.label}
                    </p>
                </div>
            {/each}
        </div>

        <!-- ── Tabs ───────────────────────────────────────────────── -->
        <div class="flex gap-1 mt-5 border-b border-[var(--color-border)]">
            {#each ["builds", "about"] as const as tab}
                <button
                    onclick={() => (activeTab = tab)}
                    class="px-4 pb-3 text-sm font-medium capitalize transition-colors
						{activeTab === tab
                        ? 'border-b-2 border-accent text-accent'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
                >
                    {tab}
                </button>
            {/each}
        </div>

        <!-- ── Tab content ────────────────────────────────────────── -->
        <div class="py-8">
            {#if activeTab === "builds"}
                {#if data.cars.length === 0}
                    <div
                        class="flex flex-col justify-center items-center py-16 text-center rounded-2xl border border-dashed border-[var(--color-border)]"
                    >
                        <Car
                            class="mb-3 opacity-30 size-10 text-[var(--color-text-muted)]"
                        />
                        <p class="font-medium text-[var(--color-text-muted)]">
                            No public builds yet
                        </p>
                    </div>
                {:else}
                    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {#each data.cars as car (car.id)}
                            {@const gradient = carGradient(car.id)}
                            <a
                                href={resolve("/builds/[carId]", {
                                    carId: car.id,
                                })}
                                class="flex overflow-hidden flex-col rounded-2xl border shadow-sm transition-transform duration-200 hover:-translate-y-1 group border-[var(--color-border)] bg-[var(--color-surface)]"
                            >
                                <!-- Cover -->
                                <div
                                    class="overflow-hidden relative h-36 shrink-0"
                                >
                                    {#if car.coverImage}
                                        <img
                                            src={car.coverImage}
                                            alt={car.nickname ?? car.make}
                                            class="object-cover w-full h-full transition-transform duration-300 group-hover:scale-105"
                                        />
                                    {:else}
                                        <div
                                            class="h-full w-full bg-gradient-to-br {gradient}"
                                        ></div>
                                    {/if}
                                </div>
                                <!-- Info -->
                                <div class="flex flex-col flex-1 gap-1.5 p-3.5">
                                    <h3
                                        class="text-sm font-semibold line-clamp-1 text-[var(--color-text)]"
                                    >
                                        {car.nickname ??
                                            `${car.year} ${car.make} ${car.model}`}
                                    </h3>
                                    <div
                                        class="flex flex-wrap gap-2 items-center text-xs text-[var(--color-text-muted)]"
                                    >
                                        <span
                                            class="inline-flex gap-1 items-center"
                                        >
                                            <Wrench class="size-3" />
                                            {car.modCount} mod{car.modCount !==
                                            1
                                                ? "s"
                                                : ""}
                                        </span>
                                        {#if car.totalSpend > 0}
                                            <span
                                                class="inline-flex gap-1 items-center font-medium text-emerald-600 dark:text-emerald-400"
                                            >
                                                <DollarSign class="size-3" />
                                                {formatSpend(car.totalSpend)}
                                            </span>
                                        {/if}
                                    </div>
                                    <div
                                        class="flex justify-end items-center pt-1 mt-auto"
                                    >
                                        <span
                                            class="inline-flex gap-1 items-center text-xs transition-colors text-[var(--color-text-muted)] group-hover:text-accent"
                                        >
                                            <Eye class="size-3" />
                                            View Build
                                        </span>
                                    </div>
                                </div>
                            </a>
                        {/each}
                    </div>
                {/if}
            {:else}
                <!-- About tab -->
                <div class="space-y-5 max-w-lg">
                    {#if data.profile.bio}
                        <div>
                            <h3
                                class="mb-1.5 text-xs font-semibold tracking-wider uppercase text-[var(--color-text-subtle)]"
                            >
                                Bio
                            </h3>
                            <p class="text-sm text-[var(--color-text)]">
                                {data.profile.bio}
                            </p>
                        </div>
                    {/if}
                    {#if data.profile.location}
                        <div>
                            <h3
                                class="mb-1.5 text-xs font-semibold tracking-wider uppercase text-[var(--color-text-subtle)]"
                            >
                                Location
                            </h3>
                            <p
                                class="inline-flex gap-2 items-center text-sm text-[var(--color-text)]"
                            >
                                <MapPin
                                    class="size-4 text-[var(--color-text-muted)]"
                                />
                                {data.profile.location}
                            </p>
                        </div>
                    {/if}
                    <div>
                        <h3
                            class="mb-1.5 text-xs font-semibold tracking-wider uppercase text-[var(--color-text-subtle)]"
                        >
                            Joined
                        </h3>
                        <p
                            class="inline-flex gap-2 items-center text-sm text-[var(--color-text)]"
                        >
                            <Calendar
                                class="size-4 text-[var(--color-text-muted)]"
                            />
                            {formatJoined(data.owner.createdAt)}
                        </p>
                    </div>
                    {#if !data.profile.bio && !data.profile.location}
                        <p class="text-sm text-[var(--color-text-muted)]">
                            No additional info provided.
                        </p>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>
