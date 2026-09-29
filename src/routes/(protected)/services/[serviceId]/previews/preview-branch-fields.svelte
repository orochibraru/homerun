<script lang="ts">
	import { Textarea } from "$lib/components/ui/textarea/index.js";

	interface Props {
		errors: Record<string, string[]> | undefined;
		/** The exclude patterns, one per line. */
		exclude: string;
		/** The include patterns, one per line. */
		include: string;
	}

	const { errors, exclude, include }: Props = $props();

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";
</script>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label class={label} for="previewBranchInclude">
                Only branches matching
              </label>
              <Textarea
                class="font-mono text-xs"
                id="previewBranchInclude"
                name="previewBranchInclude"
                placeholder={"feature/*\nfix/*"}
                rows={3}
                value={include}
              />
              <p class="text-text-subtle mt-1.5 text-xs">
                One pattern per line. Empty lets every branch through.
              </p>
              {#if errors?.previewBranchInclude}
                <p class={errorClass}>{errors.previewBranchInclude[0]}</p>
              {/if}
            </div>
            <div>
              <label class={label} for="previewBranchExclude">
                Never branches matching
              </label>
              <Textarea
                class="font-mono text-xs"
                id="previewBranchExclude"
                name="previewBranchExclude"
                placeholder={"dependabot/*\nrenovate/*"}
                rows={3}
                value={exclude}
              />
              <p class="text-text-subtle mt-1.5 text-xs">
                Wins over the list on the left.
              </p>
              {#if errors?.previewBranchExclude}
                <p class={errorClass}>{errors.previewBranchExclude[0]}</p>
              {/if}
            </div>
          </div>
          <p class="text-text-subtle -mt-2 text-xs">
            Matched against the pull request's head branch: <code>*</code> is
            any run of characters, slashes included, <code>?</code> exactly one.
            Saving a filter deletes the open previews it now leaves out.
          </p>
