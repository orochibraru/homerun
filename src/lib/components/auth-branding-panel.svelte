<script lang="ts">
	import { Container, Lock, Server, Zap } from "@lucide/svelte";
	import { resolve } from "$app/paths";
</script>

<div
  class="relative hidden flex-col overflow-hidden bg-zinc-950 lg:flex lg:w-[45%] xl:w-1/2"
>
  <!-- Decorative glows -->
  <div class="pointer-events-none absolute inset-0">
    <div
      class="bg-accent/20 absolute -top-32 -right-32 h-128 w-lg rounded-full blur-[100px]"
    ></div>
    <div
      class="bg-accent/10 absolute -bottom-32 -left-32 h-112 w-md rounded-full blur-[80px]"
    ></div>
    <div
      class="absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-900/20 blur-[60px]"
    ></div>
  </div>

  <!-- Subtle grid texture -->
  <div
    class="absolute inset-0 opacity-[0.03]"
    style="background-image: linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px); background-size: 40px 40px;"
  ></div>

  <div class="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14">
    <!-- Logo -->
    <a
      href={resolve("/")}
      class="inline-flex items-center gap-1.5 text-lg font-bold text-white"
    >
      <Server class="text-accent size-5" />
      <span>Local</span><span class="text-accent">Run</span>
    </a>

    <!-- Main copy -->
    <div>
      <div
        class="border-accent/30 bg-accent/10 mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1"
      >
        <Zap class="text-accent size-3.5" />
        <span class="text-accent text-xs font-medium">Self-hosted PaaS</span>
      </div>

      <h1 class="mb-4 text-4xl leading-tight font-bold text-white xl:text-5xl">
        Deploy containers.<br />
        <span
          class="bg-linear-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent"
        >
          Not enterprise bloat.
        </span>
      </h1>

      <p class="mb-10 max-w-sm text-base leading-relaxed text-zinc-400">
        Point at an image, fill in a config, click deploy. Runs on your own
        server, routed automatically — no YAML, no paywalls.
      </p>

      <!-- Stats -->
      <div class="mb-10 grid grid-cols-3 gap-3">
        {#each [{ icon: Server, value: "Self-hosted", label: "Your server" }, { icon: Container, value: "Any image", label: "Bring your own" }, { icon: Lock, value: "Zero", label: "Vendor lock-in" }] as stat}
          <div
            class="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"
          >
            <stat.icon class="text-accent mb-2 size-4" />
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
      class="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
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
