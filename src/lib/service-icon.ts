export const MAX_ICON_BYTES = 256 * 1024;

export const ICON_UPLOAD_TYPES = [
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/svg+xml",
	"image/webp",
];

const BUNDLED_ICON = /^[a-z0-9][a-z0-9._-]*\.(svg|png|webp|jpg)$/;
const DATA_URL = /^data:(image\/[a-z+.-]+);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Whether `icon` is a picture to render (a bundled file or an upload) rather than empty, which means the category's generic icon. */
export function hasIconImage(icon: string | null | undefined): icon is string {
	return !!icon && (icon.startsWith("data:") || icon.includes("."));
}

/** The `<img src>` for an icon: an uploaded data URL as is, a bundled file under `/template-icons/`. */
export function iconSrc(icon: string): string {
	return icon.startsWith("data:") ? icon : `/template-icons/${icon}`;
}

/**
 * Why `icon` can't be stored on a service, or null when it can: empty (no
 * icon), a bundled template icon from `bundled`, or a base64 image data URL
 * of an allowed type under `MAX_ICON_BYTES`.
 */
export function iconProblem(
	icon: string,
	bundled: readonly string[],
): string | null {
	if (icon === "") {
		return null;
	}
	if (icon.startsWith("data:")) {
		const type = DATA_URL.exec(icon)?.[1];
		if (!(type && ICON_UPLOAD_TYPES.includes(type))) {
			return "Upload a PNG, JPEG, WebP, GIF or SVG image.";
		}
		const bytes = Math.floor(((icon.length - icon.indexOf(",") - 1) * 3) / 4);
		return bytes > MAX_ICON_BYTES
			? `The icon is over ${MAX_ICON_BYTES / 1024} KB : use a smaller image.`
			: null;
	}
	return BUNDLED_ICON.test(icon) && bundled.includes(icon)
		? null
		: "Pick an icon from the library or upload one.";
}
