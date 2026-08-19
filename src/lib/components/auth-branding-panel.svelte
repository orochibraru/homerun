<script lang="ts">
  import { Container, Lock, Server, Zap } from "@lucide/svelte";
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
      <Server class="size-5 text-accent" />
      <span>Local</span><span class="text-accent">Run</span>
    </a>

    <!-- Main copy -->
    <div>
      <div
        class="inline-flex gap-2 items-center py-1 px-3 mb-3 rounded-full border border-accent/30 bg-accent/10"
      >
        <Zap class="size-3.5 text-accent" />
        <span class="text-xs font-medium text-accent">Self-hosted PaaS</span>
      </div>

      <h1 class="mb-4 text-4xl font-bold leading-tight text-white xl:text-5xl">
        Deploy containers.<br />
        <span
          class="text-transparent bg-clip-text bg-linear-to-r from-violet-400 to-purple-300"
        >
          Not enterprise bloat.
        </span>
      </h1>

      <p class="mb-10 max-w-sm text-base leading-relaxed text-zinc-400">
        Point at an image, fill in a config, click deploy. Runs on your own
        server, routed automatically — no YAML, no paywalls.
      </p>

      <!-- Stats -->
      <div class="grid grid-cols-3 gap-3 mb-10">
        {#each [{ icon: Server, value: "Self-hosted", label: "Your server" }, { icon: Container, value: "Any image", label: "Bring your own" }, { icon: Lock, value: "Zero", label: "Vendor lock-in" }] as stat}
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

    <!-- How it works -->
    <div
      class="p-5 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
    >
      <p class="mb-1 text-sm font-medium text-white">How it works</p>
      <p class="text-sm leading-relaxed text-zinc-400">
        Image + tag → env vars & port → deploy. Traefik routes
        <span class="text-accent">your-service.yourdomain</span> straight to the
        container, TLS included.
      </p>
    </div>
  </div>
</div>
