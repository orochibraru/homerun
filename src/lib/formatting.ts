export function formatDate(date: Date | null): string {
  if (!date) {
    return "—";
  }
  return new Date(date).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Deterministic small hash, used to pick a stable gradient/color per entity id. */
export function getHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(31, hash) + id.charCodeAt(i);
    // biome-ignore lint/suspicious/noBitwiseOperators: standard int32-truncation idiom for a rolling hash — not a typo.
    hash |= 0;
  }
  return Math.abs(hash);
}

const UPPERCASE_RE = /[A-Z]/;
const DIGIT_RE = /[0-9]/;
const SYMBOL_RE = /[^A-Za-z0-9]/;

export function getPasswordStrength(password: string): number {
  if (!password) {
    return 0;
  }
  let s = 0;
  if (password.length >= 12) {
    s += 1;
  }
  if (UPPERCASE_RE.test(password)) {
    s += 1;
  }
  if (DIGIT_RE.test(password)) {
    s += 1;
  }
  if (SYMBOL_RE.test(password)) {
    s += 1;
  }
  return s;
}

export function getPasswordStrengthMeta(strength: number) {
  if (strength === 0) {
    return { bar: "bg-[var(--color-surface-3)]", label: "", text: "" };
  }
  if (strength === 1) {
    return { bar: "bg-red-500", label: "Weak", text: "text-red-500" };
  }
  if (strength === 2) {
    return { bar: "bg-yellow-500", label: "Fair", text: "text-yellow-500" };
  }
  if (strength === 3) {
    return { bar: "bg-blue-500", label: "Good", text: "text-blue-500" };
  }
  return { bar: "bg-green-500", label: "Strong", text: "text-green-500" };
}
