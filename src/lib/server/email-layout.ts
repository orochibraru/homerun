import { config } from "$lib/config";

const BRAND = "#8b1e3f";
const TEXT = "#1f1d2b";
const MUTED = "#6b6880";
const BORDER = "#e7e3ee";
const SURFACE = "#f6f4f9";
const FONT =
	"-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export interface EmailBody {
	/** A primary button, and the same link spelled out in the text version. */
	action?: { label: string; url: string };
	/** A one-time code shown large and spaced out. */
	code?: string;
	/** Label/value rows, like a notification's service and event. */
	details?: { name: string; value: string }[];
	/** The small print under everything, e.g. "ignore this if it wasn't you". */
	footnote?: string;
	heading: string;
	paragraphs: string[];
	/** Preformatted text (a log excerpt, a stack trace) in a monospace block. */
	pre?: string;
	/** The inbox preview line; defaults to the first paragraph. */
	preheader?: string;
}

/** Escapes text for HTML element content and double-quoted attributes. */
export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** The plain-text twin of an email, for clients that don't render HTML. */
function textVersion(body: EmailBody): string {
	const lines = [body.heading, "", ...body.paragraphs.flatMap((p) => [p, ""])];
	if (body.code) {
		lines.push(`    ${body.code}`, "");
	}
	if (body.details?.length) {
		lines.push(...body.details.map((row) => `${row.name}: ${row.value}`), "");
	}
	if (body.pre) {
		lines.push(body.pre, "");
	}
	if (body.action) {
		lines.push(`${body.action.label}: ${body.action.url}`, "");
	}
	if (body.footnote) {
		lines.push(body.footnote, "");
	}
	lines.push(`Homerun${config.auth.origin ? ` · ${config.auth.origin}` : ""}`);
	return lines.join("\n");
}

/** The logo and wordmark row; the image only when there's a public origin to load it from. */
function header(): string {
	const logo = config.auth.origin
		? `<img src="${escapeHtml(`${config.auth.origin}/logo.png`)}" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px;">`
		: "";
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${
		logo
			? `<td style="padding-right:10px;vertical-align:middle;">${logo}</td>`
			: ""
	}<td style="vertical-align:middle;font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${BRAND};">Homerun</td></tr></table>`;
}

/** The HTML version: a centered card on a tinted background, table layout and inline styles only. */
function htmlVersion(body: EmailBody): string {
	const preheader = body.preheader ?? body.paragraphs[0] ?? body.heading;
	const paragraphs = body.paragraphs
		.map(
			(p) =>
				`<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};">${escapeHtml(p)}</p>`,
		)
		.join("");
	const code = body.code
		? `<div style="margin:8px 0 20px;padding:18px 0;border-radius:10px;background:${SURFACE};border:1px solid ${BORDER};text-align:center;font-family:${MONO};font-size:30px;font-weight:700;letter-spacing:0.32em;color:${TEXT};">${escapeHtml(body.code)}</div>`
		: "";
	const action = body.action
		? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td style="border-radius:8px;background:${BRAND};"><a href="${escapeHtml(body.action.url)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(body.action.label)}</a></td></tr></table><p style="margin:0 0 18px;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">Or paste this into your browser:<br><a href="${escapeHtml(body.action.url)}" style="color:${BRAND};word-break:break-all;">${escapeHtml(body.action.url)}</a></p>`
		: "";
	const details = body.details?.length
		? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 18px;border:1px solid ${BORDER};border-radius:10px;border-collapse:separate;">${body.details
				.map(
					(row, i) =>
						`<tr><td style="padding:9px 14px;${i > 0 ? `border-top:1px solid ${BORDER};` : ""}font-family:${FONT};font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(row.name)}</td><td style="padding:9px 14px;${i > 0 ? `border-top:1px solid ${BORDER};` : ""}font-family:${FONT};font-size:13px;color:${TEXT};word-break:break-word;">${escapeHtml(row.value)}</td></tr>`,
				)
				.join("")}</table>`
		: "";
	const pre = body.pre
		? `<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:${SURFACE};border:1px solid ${BORDER};font-family:${MONO};font-size:12px;line-height:1.5;color:${TEXT};white-space:pre-wrap;word-break:break-word;">${escapeHtml(body.pre)}</pre>`
		: "";
	const footnote = body.footnote
		? `<p style="margin:6px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(body.footnote)}</p>`
		: "";
	const origin = config.auth.origin
		? `<a href="${escapeHtml(config.auth.origin)}" style="color:${MUTED};">${escapeHtml(config.auth.origin.replace(/^https?:\/\//, ""))}</a>`
		: "";
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(body.heading)}</title></head><body style="margin:0;padding:0;background:${SURFACE};"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${SURFACE};"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;"><tr><td style="padding:0 4px 18px;">${header()}</td></tr><tr><td style="background:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:30px 28px;"><div style="height:3px;width:40px;background:${BRAND};border-radius:2px;margin:0 0 18px;"></div><h1 style="margin:0 0 14px;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${TEXT};">${escapeHtml(body.heading)}</h1>${paragraphs}${code}${details}${pre}${action}${footnote}</td></tr><tr><td align="center" style="padding:18px 4px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">Sent by Homerun${origin ? ` · ${origin}` : ""}</td></tr></table></td></tr></table></body></html>`;
}

/**
 * Renders an email in Homerun's branding: an HTML card (logo, heading, text,
 * an optional code, button, detail table or log block) and its plain-text
 * twin, both built from the same `body` so they never disagree. Every value is
 * escaped.
 */
export function brandedEmail(body: EmailBody): {
	content: string;
	html: string;
} {
	return { content: textVersion(body), html: htmlVersion(body) };
}
