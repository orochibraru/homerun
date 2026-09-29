/** A PEM as a YAML literal block, each line indented by `indent`. */
function block(pem: string, indent: string): string {
	const lines = pem
		.trim()
		.split("\n")
		.map((line) => `${indent}${line.trimEnd()}`);
	return `|\n${lines.join("\n")}`;
}

/**
 * A Traefik file-provider dynamic config serving `cert`/`key`, with the PEM
 * inline rather than as file paths: the app and Traefik mount the config
 * directory at different paths, so a path the app writes wouldn't resolve in
 * Traefik. `asDefault` also makes it the certificate Traefik falls back to
 * for any host no router's own certificate covers.
 */
export function tlsConfigYaml(
	pair: { cert: string; key: string },
	options: { asDefault: boolean; owner: string },
): string {
	const lines = [
		`# Written by Homerun for ${options.owner} : do not edit by hand.`,
		"tls:",
	];
	if (options.asDefault) {
		lines.push(
			"  stores:",
			"    default:",
			"      defaultCertificate:",
			`        certFile: ${block(pair.cert, "          ")}`,
			`        keyFile: ${block(pair.key, "          ")}`,
		);
	}
	lines.push(
		"  certificates:",
		`    - certFile: ${block(pair.cert, "        ")}`,
		`      keyFile: ${block(pair.key, "        ")}`,
	);
	return `${lines.join("\n")}\n`;
}
