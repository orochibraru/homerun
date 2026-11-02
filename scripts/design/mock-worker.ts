import Bun from "bun";

const LOG_LINES = [
	"GET /api/files?dir=/photos 200 6ms",
	"GET /api/thumb/8f21.webp 200 3ms",
	"cache hit thumbs:8f21",
	"PUT /api/upload 201 88ms size=14.2MB",
	"WARN upload chunk retry 2/5",
	"GET /healthz 200 1ms",
	"POST /api/share 201 12ms",
	"gc: freed 38MB in 4ms",
];

/** A JSON answer, the shape every worker route uses. */
function json(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

/** A value that drifts slowly with time, so polled charts move like a real host. */
function drift(base: number, spread: number, seconds = 60): number {
	const t = Date.now() / 1000 / seconds;
	return Math.max(
		0,
		base + Math.sin(t) * spread + Math.sin(t * 2.7) * spread * 0.3,
	);
}

/** Plain-text container logs: a backlog, then one line every two seconds while following. */
function logs(follow: boolean): Response {
	let timer: ReturnType<typeof setInterval> | undefined;
	const encoder = new TextEncoder();
	const line = (i: number) =>
		`${new Date(Date.now() - (40 - i) * 1500).toISOString()} ${LOG_LINES[i % LOG_LINES.length]}\n`;
	const stream = new ReadableStream<Uint8Array>({
		cancel() {
			clearInterval(timer);
		},
		start(controller) {
			for (let i = 0; i < 40; i += 1) {
				controller.enqueue(encoder.encode(line(i)));
			}
			if (!follow) {
				controller.close();
				return;
			}
			let i = 40;
			timer = setInterval(() => {
				controller.enqueue(encoder.encode(line(i)));
				i += 1;
			}, 2000);
		},
	});
	return new Response(stream, { headers: { "content-type": "text/plain" } });
}

/** What a container's id says about it: design mode marks stopped ones with `stopped` in the id. */
function containerStatus(id: string): string {
	return id.includes("stopped") ? "stopped" : "running";
}

/** Answers one request the way the Go worker's control API would, with made-up data. */
function route(request: Request): Response {
	const url = new URL(request.url);
	const path = url.pathname.replace(/^\/+/, "/");
	const method = request.method;
	const part = path.split("/");

	if (path === "/v1/health") {
		return json({ ok: true, wedgedContainers: [] });
	}
	if (path === "/v1/host/stats") {
		return json({
			cpuPercent: drift(18, 9),
			diskPercent: 47,
			diskTotalMb: 937 * 1024,
			diskUsedMb: 439 * 1024,
			gpu: null,
			memPercent: drift(34, 4, 300),
			memTotalMb: 15.5 * 1024,
			memUsedMb: (drift(34, 4, 300) / 100) * 15.5 * 1024,
		});
	}
	if (path === "/v1/info") {
		return json({
			MemTotal: 15.5 * 1024 ** 3,
			NCPU: 8,
			OperatingSystem: "Homerun design mode",
			ServerVersion: "design",
			Swarm: { LocalNodeState: "inactive", NodeID: "" },
		});
	}
	if (path === "/v1/df") {
		return json({
			BuildCache: [],
			Containers: [],
			Images: [],
			LayersSize: 0,
			Volumes: [],
		});
	}
	if (
		method === "GET" &&
		[
			"/v1/containers",
			"/v1/networks",
			"/v1/volumes",
			"/v1/swarm/nodes",
		].includes(path)
	) {
		return json([]);
	}
	if (path === "/v1/volumes/sizes") {
		return json([]);
	}
	if (part[2] === "containers" && part[3]) {
		const id = decodeURIComponent(part[3]);
		switch (part[4]) {
			case "status":
				return json({ status: containerStatus(id) });
			case "health":
				return json({ output: "ok", status: "healthy" });
			case "address":
				return json({ address: "10.0.4.2" });
			case "stats":
				return containerStatus(id) === "running"
					? json({
							cpuPercent: drift(2, 1.5, 20),
							memLimitMb: 1024,
							memUsedMb: drift(180, 40, 120),
							netRxBytes: Date.now() / 10,
							netTxBytes: Date.now() / 25,
						})
					: json(null);
			case "logs":
				return logs(url.searchParams.get("follow") !== "0");
			case "inspect":
				return json({
					Config: { Env: [], Image: "design/mock", Labels: {} },
					Id: id,
					Name: `/${id}`,
					NetworkSettings: { Networks: {} },
					State: {
						Running: containerStatus(id) === "running",
						Status: containerStatus(id),
					},
				});
			default:
				return json({});
		}
	}
	if (part[2] === "swarm" && part[3] === "services" && part[4]) {
		switch (part[5]) {
			case "status":
				return json({ status: "running" });
			case "replicas":
			case "tasks":
				return json([]);
			case "running-tasks":
				return json({ count: 1 });
			case "logs":
				return logs(url.searchParams.get("follow") !== "0");
			default:
				return json({});
		}
	}
	if (path === "/v1/images/id") {
		return json({ id: "sha256:design" });
	}
	if (path === "/v1/images/pull") {
		return new Response(
			`${JSON.stringify({ done: true, status: "Pulled (design mode)" })}\n`,
		);
	}
	if (method === "POST" && path === "/v1/containers") {
		return json({ id: `design-${crypto.randomUUID().slice(0, 8)}` });
	}
	if (method === "GET") {
		return json({ error: `design mode doesn't mock GET ${path}` }, 404);
	}
	return json({});
}

/** Starts the mock worker on `port`, answering every route of the worker's control API. */
export function startMockWorker(port: number): ReturnType<typeof Bun.serve> {
	return Bun.serve({
		fetch: route,
		hostname: "127.0.0.1",
		idleTimeout: 0,
		port,
	});
}
