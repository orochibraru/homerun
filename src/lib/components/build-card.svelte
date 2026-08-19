<script lang="ts">
    import { DollarSign, Eye, Heart, Wrench } from "@lucide/svelte";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { carGradientDarker, formatSpend } from "$lib/formatting";
    import ModBadge from "./mod-badge.svelte";

    interface BuildCardProps {
        car: {
            id: string;
            make: string;
            model: string;
            year: number;
            nickname: string | null;
            coverImage: string | null;
            createdAt: Date;
        };
        owner: { id: string; name: string; image: string | null };
        username: string | null;
        modCount: number;
        totalSpend: number; // cents
        likeCount: number;
        isLiked: boolean;
        categories: string[];
        loggedIn?: boolean;
    }

    let {
        car,
        owner,
        username,
        modCount,
        totalSpend,
        likeCount,
        isLiked,
        categories,
        loggedIn = false,
    }: BuildCardProps = $props();

    let liked = $derived(isLiked);
    let likes = $derived(likeCount);
    let likeLoading = $state(false);

    const carTitle = $derived(
        car.nickname ?? `${car.year} ${car.make} ${car.model}`,
    );
    const visibleCategories = $derived(categories.slice(0, 4));
    const extraCount = $derived(Math.max(0, categories.length - 4));

    const gradient = $derived(carGradientDarker(car.id));

    async function toggleLike(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (!loggedIn) {
            goto(resolve("/auth/sign-in"));
            return;
        }

        if (likeLoading) return;
        likeLoading = true;

        // Optimistic update
        const wasLiked = liked;
        const wasCount = likes;
        liked = !liked;
        likes = liked ? wasCount + 1 : wasCount - 1;

        try {
            const res = await fetch("/api/likes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ carId: car.id }),
            });

            if (res.status === 401) {
                goto(resolve("/auth/sign-in"));
                return;
            }
            if (!res.ok) throw new Error("Request failed");

            const data = await res.json();
            liked = data.liked;
            likes = data.count;
        } catch {
            // Revert on error
            liked = wasLiked;
            likes = wasCount;
        } finally {
            likeLoading = false;
        }
    }
</script>

<article
    class="flex overflow-hidden flex-col rounded-2xl border shadow-sm transition-transform duration-200 hover:-translate-y-1 group border-[var(--color-border)] bg-[var(--color-surface)]"
>
    <!-- Cover (div wrapper to avoid nested <a> with owner chip) -->
    <div
        role="link"
        tabindex="0"
        onclick={() => goto(resolve("/builds/[carId]", { carId: car.id }))}
        onkeydown={(e) =>
            e.key === "Enter" &&
            goto(resolve("/builds/[carId]", { carId: car.id }))}
        class="block overflow-hidden relative h-44 cursor-pointer shrink-0"
    >
        {#if car.coverImage}
            <img
                src={car.coverImage}
                alt={carTitle}
                class="object-cover w-full h-full transition-transform duration-300 group-hover:scale-105"
            />
        {:else}
            <div class="h-full w-full bg-gradient-to-br {gradient}"></div>
        {/if}

        <!-- Owner chip — real <a> tag is safe here since the cover is a div -->
        <div class="absolute top-3 left-3 z-10">
            <a
                href={username
                    ? resolve("/profile/[username]", { username })
                    : "#"}
                onclick={(e) => e.stopPropagation()}
                class="flex gap-1.5 items-center py-1 px-2.5 text-white rounded-full transition-colors bg-black/50 backdrop-blur-sm hover:bg-black/70"
            >
                {#if owner.image}
                    <img
                        src={owner.image}
                        alt={owner.name}
                        class="object-cover rounded-full ring-1 size-5 ring-white/30"
                    />
                {:else}
                    <div
                        class="flex justify-center items-center font-bold text-white rounded-full ring-1 size-5 shrink-0 bg-accent text-[0.55rem] ring-white/30"
                    >
                        {owner.name[0]?.toUpperCase() ?? "?"}
                    </div>
                {/if}
                <span class="text-xs font-medium max-w-[7rem] truncate"
                    >{username ?? owner.name}</span
                >
            </a>
        </div>
    </div>

    <!-- Body -->
    <div class="flex flex-col flex-1 gap-3 p-4">
        <!-- Title + stats -->
        <div>
            <h3
                class="font-semibold leading-snug line-clamp-1 text-[var(--color-text)]"
            >
                {carTitle}
            </h3>
            <div class="flex flex-wrap gap-2 items-center mt-1.5">
                <span
                    class="inline-flex gap-1 items-center text-xs text-[var(--color-text-muted)]"
                >
                    <Wrench class="size-3" />
                    {modCount}
                    {modCount === 1 ? "mod" : "mods"}
                </span>
                {#if totalSpend > 0}
                    <span
                        class="inline-flex gap-1 items-center text-xs font-medium text-emerald-600 dark:text-emerald-400"
                    >
                        <DollarSign class="size-3" />
                        {formatSpend(totalSpend)}
                    </span>
                {/if}
            </div>
        </div>

        <!-- Category badges -->
        {#if visibleCategories.length > 0}
            <div class="flex flex-wrap gap-1.5">
                {#each visibleCategories as cat}
                    <ModBadge category={cat} />
                {/each}
                {#if extraCount > 0}
                    <span
                        class="inline-flex items-center py-0.5 px-2.5 font-medium rounded-full bg-[var(--color-surface-2)] text-[0.7rem] text-[var(--color-text-muted)]"
                    >
                        +{extraCount}
                    </span>
                {/if}
            </div>
        {/if}

        <!-- Actions row -->
        <div class="flex justify-between items-center pt-1 mt-auto">
            <button
                onclick={toggleLike}
                disabled={likeLoading}
                aria-label="{liked ? 'Unlike' : 'Like'} this build"
                class="flex items-center gap-1.5 text-sm transition-colors disabled:opacity-60
					{liked
                    ? 'text-rose-500'
                    : 'text-[var(--color-text-muted)] hover:text-rose-400'}"
            >
                <Heart
                    class="size-4 transition-all {liked
                        ? 'fill-rose-500 scale-110'
                        : ''}"
                />
                <span class="font-medium tabular-nums">{likes}</span>
            </button>

            <a
                href={resolve("/builds/[carId]", { carId: car.id })}
                class="inline-flex gap-1.5 items-center py-1.5 px-3 text-xs font-medium rounded-lg transition-colors bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-accent-light)] hover:text-accent"
            >
                <Eye class="size-3" />
                View Build
            </a>
        </div>
    </div>
</article>
