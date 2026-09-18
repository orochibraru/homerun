import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins conditional class values with clsx and resolves conflicting Tailwind
 * utilities with tailwind-merge, so later classes win.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// oxlint-disable-next-line typescript/no-explicit-any -- How shadcn-ui components are typed
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// oxlint-disable-next-line typescript/no-explicit-any -- How shadcn-ui components are typed
export type WithoutChildren<T> = T extends { children?: any }
	? Omit<T, "children">
	: T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};
