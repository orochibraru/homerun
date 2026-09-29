import { createPrivateKey, X509Certificate } from "node:crypto";

/** What Homerun keeps about an installed certificate, besides the PEM itself. */
export interface CertificateInfo {
	expiresAt: Date;
	issuer: string;
	names: string[];
}

/** The DNS names a certificate is valid for, from its subject alternative names, else its common name. */
function namesOf(cert: X509Certificate): string[] {
	const alt = (cert.subjectAltName ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.startsWith("DNS:"))
		.map((entry) => entry.slice(4).toLowerCase());
	if (alt.length > 0) {
		return alt;
	}
	const common = /CN=([^\n,]+)/.exec(cert.subject)?.[1];
	return common ? [common.trim().toLowerCase()] : [];
}

/**
 * Reads a PEM certificate chain and its private key, checking that they belong
 * together and that the certificate hasn't expired. Only the first
 * certificate (the leaf) is inspected; intermediates after it are kept as is.
 *
 * @throws With a message fit for the form when either can't be read, they
 *   don't match, or the certificate has expired.
 */
export function inspectCertificate(
	certPem: string,
	keyPem: string,
	now = new Date(),
): CertificateInfo {
	let cert: X509Certificate;
	try {
		cert = new X509Certificate(certPem);
	} catch {
		throw new Error(
			"That isn't a PEM certificate. Paste the whole -----BEGIN CERTIFICATE----- block.",
		);
	}
	let key: ReturnType<typeof createPrivateKey>;
	try {
		key = createPrivateKey(keyPem);
	} catch {
		throw new Error(
			"That isn't a PEM private key. Paste the whole -----BEGIN PRIVATE KEY----- block.",
		);
	}
	if (!cert.checkPrivateKey(key)) {
		throw new Error("The private key doesn't belong to this certificate.");
	}
	const expiresAt = new Date(cert.validTo);
	if (expiresAt.getTime() <= now.getTime()) {
		throw new Error(
			`This certificate expired on ${expiresAt.toISOString().slice(0, 10)}.`,
		);
	}
	const names = namesOf(cert);
	if (names.length === 0) {
		throw new Error("This certificate doesn't name any domain.");
	}
	return {
		expiresAt,
		issuer: /O=([^\n,]+)/.exec(cert.issuer)?.[1]?.trim() ?? cert.issuer,
		names,
	};
}

/** Whether a certificate valid for `names` covers `host`: an exact name, or a `*.` wildcard one level above it. */
export function certificateCovers(names: string[], host: string): boolean {
	const target = host.toLowerCase();
	return names.some((name) =>
		name.startsWith("*.")
			? target.endsWith(name.slice(1)) &&
				!target.slice(0, -name.length + 1).includes(".")
			: name === target,
	);
}
