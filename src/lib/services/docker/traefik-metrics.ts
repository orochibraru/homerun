/** Traefik's Prometheus metrics on an entrypoint only reachable inside its container, which the traffic sampler reads. */
export const TRAEFIK_METRICS_PORT = 8082;

/** The flags that turn on the per-service request metrics behind a service's Monitoring. */
export const TRAEFIK_METRICS_FLAGS: Record<string, string> = {
	"entrypoints.metrics.address": `:${TRAEFIK_METRICS_PORT}`,
	"metrics.prometheus": "true",
	"metrics.prometheus.addserviceslabels": "true",
	"metrics.prometheus.entrypoint": "metrics",
};

/** Reads the metrics from inside the Traefik container, whose image ships busybox `wget`. */
export const TRAEFIK_METRICS_COMMAND = [
	"wget",
	"-qO-",
	`http://127.0.0.1:${TRAEFIK_METRICS_PORT}/metrics`,
];
