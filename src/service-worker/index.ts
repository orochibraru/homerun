const sw = self as unknown as ServiceWorkerGlobalScope;

interface ReplacingNotificationOptions extends NotificationOptions {
	renotify: boolean;
}

interface PushMessage {
	body: string;
	tag: string;
	title: string;
	url: string;
}

function readMessage(event: PushEvent): PushMessage {
	const fallback: PushMessage = {
		body: "",
		tag: "homerun",
		title: "Homerun",
		url: "/notifications",
	};
	try {
		return { ...fallback, ...(event.data?.json() as Partial<PushMessage>) };
	} catch {
		return { ...fallback, body: event.data?.text() ?? "" };
	}
}

async function openOrFocus(url: string): Promise<void> {
	const target = new URL(url, sw.location.origin);
	const windows = await sw.clients.matchAll({
		includeUncontrolled: true,
		type: "window",
	});
	const sameOrigin = windows.find(
		(client) => new URL(client.url).origin === target.origin,
	);
	if (sameOrigin) {
		const focused = await sameOrigin.focus();
		await focused.navigate(target.href).catch(() => null);
		return;
	}
	await sw.clients.openWindow(target.href);
}

const OFFLINE_CACHE = "homerun-offline-v1";
const OFFLINE_PAGE = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_PAGE, "/favicon.svg", "/icons/icon-192.png"];

async function precacheOffline(): Promise<void> {
	const cache = await caches.open(OFFLINE_CACHE);
	await cache.addAll(OFFLINE_ASSETS);
}

async function dropOldCaches(): Promise<void> {
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter(
				(key) => key.startsWith("homerun-offline-") && key !== OFFLINE_CACHE,
			)
			.map((key) => caches.delete(key)),
	);
}

async function navigateOrFallback(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch (error) {
		const offline = await caches.match(OFFLINE_PAGE);
		if (offline) {
			return offline;
		}
		throw error;
	}
}

async function cachedAsset(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch (error) {
		const cached = await caches.match(request);
		if (cached) {
			return cached;
		}
		throw error;
	}
}

sw.addEventListener("install", (event) => {
	event.waitUntil(precacheOffline().then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (event) => {
	event.waitUntil(dropOldCaches().then(() => sw.clients.claim()));
});

sw.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") {
		return;
	}
	if (request.mode === "navigate") {
		event.respondWith(navigateOrFallback(request));
		return;
	}
	const url = new URL(request.url);
	if (
		url.origin === sw.location.origin &&
		OFFLINE_ASSETS.includes(url.pathname)
	) {
		event.respondWith(cachedAsset(request));
	}
});

sw.addEventListener("push", (event) => {
	const message = readMessage(event);
	const options: ReplacingNotificationOptions = {
		badge: "/favicon.svg",
		body: message.body,
		data: { url: message.url },
		icon: "/logo.png",
		renotify: true,
		tag: message.tag,
	};
	event.waitUntil(sw.registration.showNotification(message.title, options));
});

sw.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url =
		typeof event.notification.data?.url === "string"
			? event.notification.data.url
			: "/notifications";
	event.waitUntil(openOrFocus(url));
});
