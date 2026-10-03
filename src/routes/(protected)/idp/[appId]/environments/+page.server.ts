import { fail } from "@sveltejs/kit";
import { OauthClientEnvironmentDTO } from "#lib/dto/oauth-client-environment-dto.js";
import { OauthClientSecretDTO } from "#lib/dto/oauth-client-secret-dto.js";
import { Logger } from "#lib/logger.js";
import { adminApp } from "#lib/server/oauth-app-admin.js";
import { parseEnvironmentForm } from "#lib/server/oauth-app-form.js";
import {
	authErrorMessage,
	OauthAppService,
} from "#lib/services/oauth-app.service.js";

const logger = new Logger("OidcProvider");

export const load = async ({ parent }) => {
	const { app } = await parent();
	const [environments, secrets] = await Promise.all([
		OauthClientEnvironmentDTO.listForClient(app.clientId),
		OauthClientSecretDTO.listForClient(app.clientId),
	]);
	return {
		environments: environments.map((env) => env.toJSON()),
		secrets: secrets
			.map((secret) => secret.summary())
			.filter((secret) => secret.environmentId !== null),
	};
};

export const actions = {
	createEnvironment: async ({ locals, params, request }) => {
		const app = await adminApp(locals, params.appId);
		const parsed = parseEnvironmentForm(await request.formData());
		if (!parsed.input) {
			return fail(400, { error: parsed.error });
		}
		const existing = await OauthClientEnvironmentDTO.listForClient(
			app.clientId,
		);
		if (existing.some((env) => env.name === parsed.input.name)) {
			return fail(400, {
				error: `There's already a "${parsed.input.name}" environment.`,
			});
		}
		const environment = await OauthClientEnvironmentDTO.create(
			app.clientId,
			parsed.input,
		);
		try {
			await OauthAppService.syncCallbacks(app.clientId, request.headers);
		} catch (err) {
			await environment.delete();
			return fail(400, {
				error: authErrorMessage(err, "Couldn't add the environment."),
			});
		}
		logger.info(
			`OAuth app environment added: client=${app.clientId} env=${environment.name}`,
		);
		if (!app.summary().confidential) {
			return { created: environment.name };
		}
		const { secret } = await OauthClientSecretDTO.issue(
			app.clientId,
			environment.id,
			"Initial secret",
		);
		return {
			created: environment.name,
			secret: { environment: environment.name, value: secret },
		};
	},

	updateEnvironment: async ({ locals, params, request }) => {
		const app = await adminApp(locals, params.appId);
		const formData = await request.formData();
		const environment = await OauthClientEnvironmentDTO.get(
			app.clientId,
			String(formData.get("environmentId")),
		);
		if (!environment) {
			return fail(404, { error: "That environment doesn't exist any more." });
		}
		const parsed = parseEnvironmentForm(formData);
		if (!parsed.input) {
			return fail(400, { error: parsed.error });
		}
		const others = await OauthClientEnvironmentDTO.listForClient(app.clientId);
		if (
			others.some(
				(env) => env.id !== environment.id && env.name === parsed.input.name,
			)
		) {
			return fail(400, {
				error: `There's already a "${parsed.input.name}" environment.`,
			});
		}
		const previous = {
			allowedOrigins: environment.allowedOrigins,
			allowLocalhost: environment.allowLocalhost,
			name: environment.name,
			redirectUris: environment.redirectUris,
		};
		await environment.update(parsed.input);
		try {
			await OauthAppService.syncCallbacks(app.clientId, request.headers);
		} catch (err) {
			await environment.update(previous);
			return fail(400, {
				error: authErrorMessage(err, "Couldn't save the environment."),
			});
		}
		logger.info(
			`OAuth app environment saved: client=${app.clientId} env=${environment.name}`,
		);
		return { saved: environment.name };
	},

	deleteEnvironment: async ({ locals, params, request }) => {
		const app = await adminApp(locals, params.appId);
		const formData = await request.formData();
		const environments = await OauthClientEnvironmentDTO.listForClient(
			app.clientId,
		);
		const environment = environments.find(
			(env) => env.id === String(formData.get("environmentId")),
		);
		if (!environment) {
			return fail(404, { error: "That environment doesn't exist any more." });
		}
		if (environments.length === 1) {
			return fail(400, {
				error: "An app keeps at least one environment. Delete the app instead.",
			});
		}
		await environment.delete();
		try {
			await OauthAppService.syncCallbacks(app.clientId, request.headers);
		} catch (err) {
			return fail(400, {
				error: authErrorMessage(err, "Couldn't remove its callbacks."),
			});
		}
		logger.info(
			`OAuth app environment deleted: client=${app.clientId} env=${environment.name}`,
		);
		return { deleted: environment.name };
	},

	issueSecret: async ({ locals, params, request }) => {
		const app = await adminApp(locals, params.appId);
		if (!app.summary().confidential) {
			return fail(400, { error: "This app is public, so it has no secrets." });
		}
		const formData = await request.formData();
		const environment = await OauthClientEnvironmentDTO.get(
			app.clientId,
			String(formData.get("environmentId")),
		);
		if (!environment) {
			return fail(404, { error: "That environment doesn't exist any more." });
		}
		const label =
			String(formData.get("label") ?? "")
				.trim()
				.slice(0, 64) || "Client secret";
		const { secret } = await OauthClientSecretDTO.issue(
			app.clientId,
			environment.id,
			label,
		);
		logger.info(
			`OAuth app secret issued: client=${app.clientId} env=${environment.name} user=${locals.user?.id}`,
		);
		return { secret: { environment: environment.name, value: secret } };
	},

	revokeSecret: async ({ locals, params, request }) => {
		const app = await adminApp(locals, params.appId);
		const formData = await request.formData();
		const secret = await OauthClientSecretDTO.get(
			app.clientId,
			String(formData.get("secretId")),
		);
		if (!secret) {
			return fail(404, { error: "That secret doesn't exist any more." });
		}
		await secret.delete();
		logger.info(
			`OAuth app secret revoked: client=${app.clientId} user=${locals.user?.id}`,
		);
		return { revoked: true };
	},
};
