<script lang="ts">
  import { TrendingUp, Users, Wrench, Zap } from "@lucide/svelte";
  import { resolve } from "$app/paths";
</script>

<div
  class="relative hidden flex-col overflow-hidden bg-zinc-950 lg:flex lg:w-[45%] xl:w-1/2"
>
  <!-- Decorative glows -->
  <div class="absolute inset-0 pointer-events-none">
    <div
      class="absolute -top-32 -right-32 rounded-full h-128 w-lg bg-accent/20 blur-[100px]"
    ></div>
    <div
      class="absolute -bottom-32 -left-32 rounded-full h-112 w-md bg-accent/10 blur-[80px]"
    ></div>
    <div
      class="absolute top-1/2 left-1/2 w-64 h-64 rounded-full -translate-x-1/2 -translate-y-1/2 bg-violet-900/20 blur-[60px]"
    ></div>
  </div>

  <!-- Subtle grid texture -->
  <div
    class="absolute inset-0 opacity-[0.03]"
    style="background-image: linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px); background-size: 40px 40px;"
  ></div>

  <div class="flex relative z-10 flex-col justify-between p-10 h-full xl:p-14">
    <!-- Logo -->
    <a
      href={resolve("/")}
      class="inline-flex gap-1.5 items-center text-lg font-bold text-white"
    >
      <Zap class="size-5 text-accent" />
      <span>Mods</span><span class="text-accent">Parts</span>
    </a>

    <!-- Main copy -->
    <div>
      <div
        class="inline-flex gap-2 items-center py-1 px-3 mb-3 rounded-full border border-accent/30 bg-accent/10"
      >
        <Zap class="size-3.5 text-accent" />
        <span class="text-xs font-medium text-accent">For car enthusiasts</span>
      </div>

      <h1 class="mb-4 text-4xl font-bold leading-tight text-white xl:text-5xl">
        Track every mod.<br />
        <span
          class="text-transparent bg-clip-text bg-linear-to-r from-violet-400 to-purple-300"
        >
        </span>
        your build.
      </h1>

      <p class="mb-10 max-w-sm text-base leading-relaxed text-zinc-400">
        The ultimate platform for car enthusiasts to catalog modifications,
        compare specs, and share their builds with the world.
      </p>

      <!-- Stats -->
      <div class="grid grid-cols-3 gap-3 mb-10">
        {#each [{ icon: Users, value: "500+", label: "Builds Shared" }, { icon: Wrench, value: "2k+", label: "Parts Tracked" }, { icon: TrendingUp, value: "50+", label: "Car Makes" }] as stat}
          <div
            class="p-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
          >
            <stat.icon class="mb-2 size-4 text-accent" />
            <div class="text-xl font-bold text-white">
              {stat.value}
            </div>
            <div class="mt-0.5 text-xs text-zinc-400">
              {stat.label}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Testimonial -->
    <div
      class="p-5 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
    >
      <div class="flex gap-0.5 mb-3">
        {#each Array(5) as _}
          <span class="text-sm text-amber-400">★</span>
        {/each}
      </div>
      <p class="mb-4 text-sm italic leading-relaxed text-zinc-300">Self host</p>
      <div class="flex gap-3 items-center">
        <div
          class="flex justify-center items-center text-sm font-bold rounded-full border size-9 shrink-0 border-accent/40 bg-accent/20 text-accent"
        >
          A
        </div>
        <div>
          <p class="text-sm font-medium text-white">Alex M.</p>
          <p class="text-xs text-zinc-500">2020 Subaru WRX STI · Stage 2</p>
        </div>
      </div>
    </div>
  </div>
</div>
