/**
 * The Tailwind class strings every form page in this app redefines
 * identically (services/new, service settings, project/storage/remote-host
 * create forms, etc.) — one shared source instead of copy-pasted literals
 * that'd drift out of sync. Import and use directly as a class string
 * (`class={inputClass}`), not a component — most of these pages predate
 * this file and use a plain `<input>`/`<label>` styled this way rather
 * than a wrapper component, so this keeps the existing markup shape
 * intact while still deduplicating the one thing that was actually
 * copy-pasted everywhere.
 */
export const inputClass =
	"w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-subtle transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

export const labelClass = "block mb-1.5 text-sm font-medium text-text";

export const errorClass = "mt-1.5 text-xs text-red-500";
