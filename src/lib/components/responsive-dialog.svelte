<script lang="ts" module>
  import type { HTMLFormAttributes } from "svelte/elements";
  import type { ButtonVariant } from "$lib/components/ui/button";

  export type DialogSize = "sm" | "md" | "lg" | "fullscreen";

  export interface ResponsiveDialogProps {
    contentClass?: string;
    description?: string;
    /** Form props - if provided, children are wrapped in a form */
    form?: {
      action?: HTMLFormAttributes["action"];
      method?: HTMLFormAttributes["method"];
      enctype?: HTMLFormAttributes["enctype"];
      onsubmit?: (e: SubmitEvent) => void;
    };
    loading?: boolean;
    /** Label shown on submit button while loading */
    loadingLabel?: string;
    /** Callback fired when the submit button is clicked (non-form mode) */
    onsubmit?: () => void;
    open: boolean;
    /** Dialog size: sm, md, lg, or fullscreen. Default is md */
    size?: DialogSize;
    /** If true, submit button is disabled */
    submitDisabled?: boolean;
    /** Label for the submit button */
    submitLabel?: string;
    /** Button variant for submit button (e.g., "destructive") */
    submitVariant?: ButtonVariant;
    title: string;
  }

  const sizeClasses: Record<DialogSize, string> = {
    fullscreen: "!max-w-none !w-screen !h-screen !rounded-none",
    lg: "md:max-w-3xl lg:max-w-5xl xl:max-w-7xl",
    md: "max-w-2xl",
    sm: "max-w-md",
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { enhance } from "$app/forms";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte's compound-component pattern (Dialog.Root/.Content/.Header/...) needs the whole namespace.
  import * as Dialog from "$lib/components/ui/dialog/index";
  // biome-ignore lint/performance/noNamespaceImport: same as Dialog above.
  import * as Drawer from "$lib/components/ui/drawer/index";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    loading = $bindable(false),
    title,
    description,
    size = "md",
    contentClass,
    submitLabel = "Submit",
    loadingLabel = "Loading...",
    submitVariant = "default",
    submitDisabled = false,
    onsubmit,
    form,
    children,
    footer,
  }: ResponsiveDialogProps & {
    children: Snippet;
    /** Optional custom footer snippet. If provided, replaces default buttons. */
    footer?: Snippet;
  } = $props();

  const isDesktop = new MediaQuery("(min-width: 768px)");
</script>

{#snippet footerButtons()}
  {#if footer}
    {@render footer()}
  {:else if form || onsubmit}
    <Button
      disabled={submitDisabled}
      {loading}
      onclick={!form && onsubmit ? onsubmit : undefined}
      type={form ? "submit" : "button"}
      variant={submitVariant}
    >
      {loading ? loadingLabel : submitLabel}
    </Button>
  {/if}
  {#if isDesktop.current}
    <Dialog.Close
      class={buttonVariants({ variant: "outline" })}
      disabled={loading}
      type="button"
    >
      {#if form || onsubmit}
        Cancel
      {:else}
        Close
      {/if}
    </Dialog.Close>
  {:else}
    <Drawer.Close
      class={buttonVariants({ variant: "outline" })}
      disabled={loading}
      type="button"
    >
      {#if form || onsubmit}
        Cancel
      {:else}
        Close
      {/if}
    </Drawer.Close>
  {/if}
{/snippet}

{#snippet formWrapper(content: Snippet)}
  {#if form}
    <form
      action={form.action}
      enctype={form.enctype}
      method={form.method ?? "POST"}
      onsubmit={form.onsubmit}
      use:enhance
    >
      <fieldset class="flex flex-col gap-4" disabled={loading}>
        <div class="max-h-[40vh] overflow-y-auto md:max-h-[50vh]">
          {@render content()}
        </div>
        {@render footerButtons()}
      </fieldset>
    </form>
  {:else}
    <!-- biome-ignore lint/a11y/noNoninteractiveElementInteractions: submit-on-Enter for the non-form (no <form> element) variant of this dialog — no semantic element covers "arbitrary content container that submits on Enter". -->
    <fieldset
      class="flex flex-col gap-4"
      disabled={loading}
      onkeydown={(e) => {
        if (e.key === "Enter" && onsubmit && !submitDisabled && !loading) {
          e.preventDefault();
          onsubmit();
        }
      }}
    >
      <div class="max-h-[40vh] overflow-y-auto md:max-h-[50vh]">
        {@render content()}
      </div>
      {@render footerButtons()}
    </fieldset>
  {/if}
{/snippet}

{#if isDesktop.current}
  <Dialog.Root bind:open>
    <Dialog.Content
      class={cn("max-h-[70%] pb-16", sizeClasses[size], contentClass)}
    >
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
        {#if description}
          <Dialog.Description>{description}</Dialog.Description>
        {/if}
      </Dialog.Header>
      {@render formWrapper(children)}
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <Drawer.Root bind:open>
    <Drawer.Content class="z-50">
      <Drawer.Header>
        <Drawer.Title class="text-lg">{title}</Drawer.Title>
        {#if description}
          <Drawer.Description class="text-muted-foreground text-sm">
            {description}
          </Drawer.Description>
        {/if}
      </Drawer.Header>
      <div class="flex flex-col gap-2 p-4">
        {@render formWrapper(children)}
      </div>
    </Drawer.Content>
  </Drawer.Root>
{/if}
