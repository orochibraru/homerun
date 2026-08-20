import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config, isSmtpEnabled } from "$lib/config";
import { InvitationDTO } from "$lib/dto/invitation-dto";
import { Logger } from "$lib/logger";
import { auth } from "$lib/server/auth";
import type { UserRole } from "$lib/server/db/schema.js";
import { Email } from "$lib/server/email";
import { cleanupUserResources } from "$lib/server/user-cleanup";
import { countAdmins, listUsers } from "$lib/server/user-directory";

const logger = new Logger("Users");

const roleSet = new Set(["admin", "developer"]);

export const load = async ({ locals }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const [users, invites] = await Promise.all([
		listUsers(),
		InvitationDTO.listPending(),
	]);

	return {
		currentUserId: locals.user.id,
		invites: invites.map((i) => i.toJSON()),
		smtpEnabled: isSmtpEnabled(),
		users,
	};
};

/** Refuses to strip admin-ness from the only remaining admin — mirrors better-auth's own "can't remove yourself" guard on admin.removeUser, but for the case that action doesn't cover. */
async function wouldRemoveLastAdmin(userId: string): Promise<boolean> {
	const target = (await listUsers()).find((u) => u.id === userId);
	if (target?.role !== "admin") {
		return false;
	}
	return (await countAdmins()) <= 1;
}

export const actions = {
	cancelInvite: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const id = formData.get("id") as string;
		await InvitationDTO.deleteById(id);
		return { action: "cancelInvite", success: true };
	},

	createDirect: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim();
		const email = (formData.get("email") as string | null)
			?.trim()
			.toLowerCase();
		const password = (formData.get("password") as string | null) ?? "";
		const role = formData.get("role") as UserRole;

		if (!(name && email)) {
			return fail(400, {
				action: "createDirect",
				error: "Name and email are required.",
			});
		}
		if (!roleSet.has(role)) {
			return fail(400, { action: "createDirect", error: "Invalid role." });
		}
		if (password.length < 12) {
			return fail(400, {
				action: "createDirect",
				error: "Password must be at least 12 characters.",
			});
		}

		const result = await auth.api
			.createUser({
				body: { email, name, password, role },
				headers: request.headers,
			})
			.catch((error: unknown) => ({ error }));
		if ("error" in result) {
			logger.warn(`Direct user creation failed: ${result.error}`);
			return fail(400, {
				action: "createDirect",
				error:
					result.error instanceof Error
						? result.error.message
						: "Could not create user.",
			});
		}

		logger.info(
			`User created directly: user=${result.user.id} role=${role} by=${locals.user.id}`,
		);
		return { action: "createDirect", success: true };
	},

	invite: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		if (!isSmtpEnabled()) {
			return fail(400, {
				action: "invite",
				error: "Configure SMTP in Settings before sending invites.",
			});
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim();
		const email = (formData.get("email") as string | null)
			?.trim()
			.toLowerCase();
		const role = formData.get("role") as UserRole;

		if (!(name && email)) {
			return fail(400, {
				action: "invite",
				error: "Name and email are required.",
			});
		}
		if (!roleSet.has(role)) {
			return fail(400, { action: "invite", error: "Invalid role." });
		}

		const existing = await listUsers();
		if (existing.some((u) => u.email === email)) {
			return fail(400, {
				action: "invite",
				error: "That email already has an account.",
			});
		}

		const invitation = await InvitationDTO.create({
			email,
			invitedByUserId: locals.user.id,
			role,
		});
		const link = `${config.auth.origin}/auth/accept-invite/${invitation.toJSON().token}`;

		try {
			const mail = new Email({
				content: `${name}, you've been invited to Homerun as a ${role}.\n\nSet up your account: ${link}\n\nThis link expires in 7 days.`,
				subject: "You've been invited to Homerun",
				to: email,
			});
			await mail.send();
		} catch (error) {
			logger.error("Failed to send invite email", error);
			return fail(500, {
				action: "invite",
				error:
					"Invite created but the email failed to send — check SMTP settings.",
			});
		}

		logger.info(
			`Invite sent: email=${email} role=${role} by=${locals.user.id}`,
		);
		return { action: "invite", success: true };
	},

	removeUser: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const userId = formData.get("userId") as string;

		if (userId === locals.user.id) {
			return fail(400, {
				action: "removeUser",
				error: "You can't remove your own account here — use Profile instead.",
			});
		}
		if (await wouldRemoveLastAdmin(userId)) {
			return fail(400, {
				action: "removeUser",
				error: "Can't remove the last admin.",
			});
		}

		// See user-cleanup.ts's docstring — admin.removeUser alone would leak
		// this user's containers/networks, so the same cleanup self-service
		// account deletion gets has to run first.
		await cleanupUserResources(userId);
		await auth.api.removeUser({ body: { userId }, headers: request.headers });

		logger.info(`User removed: user=${userId} by=${locals.user.id}`);
		return { action: "removeUser", success: true };
	},

	setRole: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const userId = formData.get("userId") as string;
		const role = formData.get("role") as UserRole;

		if (!roleSet.has(role)) {
			return fail(400, { action: "setRole", error: "Invalid role." });
		}
		if (role !== "admin" && (await wouldRemoveLastAdmin(userId))) {
			return fail(400, {
				action: "setRole",
				error: "Can't demote the last admin.",
			});
		}

		await auth.api.setRole({
			body: { role, userId },
			headers: request.headers,
		});
		logger.info(
			`Role changed: user=${userId} role=${role} by=${locals.user.id}`,
		);
		return { action: "setRole", success: true };
	},
};
