export interface SunkMail {
	data: string;
	to: string[];
}

export interface MailSink {
	messages: SunkMail[];
	port: number;
	stop: () => void;
}

interface Session {
	buffer: string;
	inData: boolean;
	loginSteps: number;
	mail: SunkMail;
}

/**
 * A minimal SMTP server on a random local port that accepts any login and
 * keeps every message it receives, so a test can read the codes and links the
 * app emails. Speaks only what nodemailer uses without TLS: EHLO, AUTH
 * PLAIN/LOGIN, MAIL, RCPT, DATA, RSET, QUIT.
 */
export function startMailSink(): MailSink {
	const messages: SunkMail[] = [];
	const server = Bun.listen<Session>({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			data(socket, chunk) {
				const session = socket.data;
				session.buffer += chunk.toString();
				let newline = session.buffer.indexOf("\r\n");
				while (newline !== -1) {
					const line = session.buffer.slice(0, newline);
					session.buffer = session.buffer.slice(newline + 2);
					if (session.inData) {
						if (line === ".") {
							session.inData = false;
							messages.push(session.mail);
							session.mail = { data: "", to: [] };
							socket.write("250 OK\r\n");
						} else {
							session.mail.data += `${line}\n`;
						}
					} else if (session.loginSteps > 0) {
						session.loginSteps -= 1;
						socket.write(
							session.loginSteps > 0 ? "334 UGFzc3dvcmQ6\r\n" : "235 OK\r\n",
						);
					} else {
						const upper = line.toUpperCase();
						if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
							socket.write("250-sink\r\n250 AUTH PLAIN LOGIN\r\n");
						} else if (upper === "AUTH LOGIN") {
							session.loginSteps = 2;
							socket.write("334 VXNlcm5hbWU6\r\n");
						} else if (upper.startsWith("AUTH")) {
							socket.write("235 OK\r\n");
						} else if (upper.startsWith("RCPT")) {
							session.mail.to.push(line.replace(/^RCPT TO:\s*<?|>$/gi, ""));
							socket.write("250 OK\r\n");
						} else if (upper === "DATA") {
							session.inData = true;
							socket.write("354 Go ahead\r\n");
						} else if (upper === "QUIT") {
							socket.write("221 Bye\r\n");
							socket.end();
						} else {
							socket.write("250 OK\r\n");
						}
					}
					newline = session.buffer.indexOf("\r\n");
				}
			},
			open(socket) {
				socket.data = {
					buffer: "",
					inData: false,
					loginSteps: 0,
					mail: { data: "", to: [] },
				};
				socket.write("220 sink ESMTP\r\n");
			},
		},
	});
	return { messages, port: server.port, stop: () => server.stop(true) };
}
