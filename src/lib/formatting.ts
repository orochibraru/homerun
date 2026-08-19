import { GRADIENTS, GRADIENTS_DARKER } from "./constants";

export function formatCurrency(cents: number): string {
	if (cents === 0) return "$0";
	return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export function formatSpend(cents: number): string {
	if (cents === 0) return "$0";
	if (cents >= 100_000_00) return `$${(cents / 100_000_00).toFixed(1)}k`;
	if (cents >= 100_000) return `$${(cents / 100_000).toFixed(1)}k`;
	return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

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

export function getHash(id: string): number {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = Math.imul(31, hash) + id.charCodeAt(i);
		hash = hash | 0;
	}
	return Math.abs(hash);
}

export function carGradient(id: string): string {
	const hash = getHash(id);
	return GRADIENTS[hash % GRADIENTS.length];
}

export function carGradientDarker(id: string): string {
	const hash = getHash(id);
	return GRADIENTS_DARKER[hash % GRADIENTS_DARKER.length];
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
	if (strength === 0) return { label: "", bar: "bg-[var(--color-surface-3)]", text: "" };
	if (strength === 1) return { label: "Weak", bar: "bg-red-500", text: "text-red-500" };
	if (strength === 2) return { label: "Fair", bar: "bg-yellow-500", text: "text-yellow-500" };
	if (strength === 3) return { label: "Good", bar: "bg-blue-500", text: "text-blue-500" };
	return { label: "Strong", bar: "bg-green-500", text: "text-green-500" };
}
