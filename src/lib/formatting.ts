export function formatDate(date: Date | null): string {
	if (!date) return "—";
	return new Date(date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function timeAgo(date: Date | string): string {
	const d = new Date(date);
	const diff = Date.now() - d.getTime();
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Deterministic small hash, used to pick a stable gradient/color per entity id. */
export function getHash(id: string): number {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = Math.imul(31, hash) + id.charCodeAt(i);
		hash = hash | 0;
	}
	return Math.abs(hash);
}

export function getPasswordStrength(password: string): number {
	if (!password) return 0;
	let s = 0;
	if (password.length >= 12) s++;
	if (/[A-Z]/.test(password)) s++;
	if (/[0-9]/.test(password)) s++;
	if (/[^A-Za-z0-9]/.test(password)) s++;
	return s;
}

export function getPasswordStrengthMeta(strength: number) {
	if (strength === 0)
		return { label: "", bar: "bg-[var(--color-surface-3)]", text: "" };
	if (strength === 1)
		return { label: "Weak", bar: "bg-red-500", text: "text-red-500" };
	if (strength === 2)
		return { label: "Fair", bar: "bg-yellow-500", text: "text-yellow-500" };
	if (strength === 3)
		return { label: "Good", bar: "bg-blue-500", text: "text-blue-500" };
	return { label: "Strong", bar: "bg-green-500", text: "text-green-500" };
}
