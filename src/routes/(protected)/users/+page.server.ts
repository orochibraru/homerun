import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config, isSmtpEnabled } from "$lib/config";
import { InvitationDTO } from "$lib/dto/invitation-dto";
import { Logger } from "$lib/logger";
import { asAuthRole, isUserRole, roleLabel } from "$lib/permissions";
import { parseListQuery } from "$lib/server/list-query";
import { AccountSetupService } from "$lib/services/account-setup.service";
import { auth } from "$lib/services/auth";
import { EmailService } from "$lib/services/email.service";
import { UserService } from "$lib/services/user.service";

const logger = new Logger("Users");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const load = async ({ locals, url }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const query = parseListQuery(url, { filterKeys: ["role"] });
	const [users, invites] = await Promise.all([
		UserService.listUsersPaged(query),
		InvitationDTO.listPending(),
	]);

	return {
		currentUserId: locals.user.id,
		filtered: query.active,
		invites: invites.map((i) => i.toJSON()),
		page: users.page,
		perPage: users.perPage,
		smtpEnabled: isSmtpEnabled(),
		total: users.total,
		users: users.items,
	};
};

/** Refuses to strip admin-ness from the only remaining admin : mirrors better-auth's own "can't remove yourself" guard on admin.removeUser, but for the case that action doesn't cover. */
async function wouldRemoveLastAdmin(userId: string): Promise<boolean> {
	const target = (await UserService.listUsers()).find((u) => u.id === userId);
	if (target?.role !== "admin") {
		return false;
	}
	return (await UserService.countAdmins()) <= 1;
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
		const role = formData.get("role");

		if (!(name && email)) {
			return fail(400, {
				action: "createDirect",
				error: "Name and email are required.",
			});
		}
		if (!isUserRole(role)) {
			return fail(400, { action: "createDirect", error: "Invalid role." });
		}

		const created = await AccountSetupService.createPendingUser({
			email,
			headers: request.headers,
			name,
			role: asAuthRole(role),
		}).catch((error: unknown) => ({ error }));
		if (typeof created !== "string") {
			logger.warn(`Direct user creation failed: ${created.error}`);
			return fail(400, {
				action: "createDirect",
				error:
					created.error instanceof Error
						? created.error.message
						: "Could not create user.",
			});
		}

		logger.info(
			`User created directly: user=${created} role=${role} by=${locals.user.id}`,
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
		const role = formData.get("role");

		if (!(name && email)) {
			return fail(400, {
				action: "invite",
				error: "Name and email are required.",
			});
		}
		if (!isUserRole(role)) {
			return fail(400, { action: "invite", error: "Invalid role." });
		}

		const existing = await UserService.listUsers();
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
			const mail = new EmailService({
				content: `${name}, you've been invited to Homerun with the ${roleLabel(role)} role.\n\nSet up your account: ${link}\n\nThis link expires in 7 days.`,
				subject: "You've been invited to Homerun",
				to: email,
			});
			await mail.send();
		} catch (error) {
			logger.error("Failed to send invite email", error);
			return fail(500, {
				action: "invite",
				error:
					"Invite created but the email failed to send : check SMTP settings.",
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
				error: "You can't remove your own account here : use Profile instead.",
			});
		}
		if (await wouldRemoveLastAdmin(userId)) {
			return fail(400, {
				action: "removeUser",
				error: "Can't remove the last admin.",
			});
		}

		await UserService.cleanupUserResources(userId, locals.user.id);
		await auth.api.removeUser({ body: { userId }, headers: request.headers });

		logger.info(`User removed: user=${userId} by=${locals.user.id}`);
		return { action: "removeUser", success: true };
	},

	setEmail: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const userId = formData.get("userId") as string;
		const email = (formData.get("email") as string | null)
			?.trim()
			.toLowerCase();

		if (!(userId && email && EMAIL_RE.test(email))) {
			return fail(400, {
				action: "setEmail",
				error: "Enter a valid email address.",
			});
		}
		const users = await UserService.listUsers();
		const target = users.find((candidate) => candidate.id === userId);
		if (!target) {
			return fail(404, { action: "setEmail", error: "User not found." });
		}
		if (target.email === email) {
			return { action: "setEmail", success: true };
		}
		if (users.some((candidate) => candidate.email === email)) {
			return fail(400, {
				action: "setEmail",
				error: "That email already has an account.",
			});
		}

		await auth.api.adminUpdateUser({
			body: { data: { email, emailVerified: true }, userId },
			headers: request.headers,
		});
		logger.info(
			`Email changed: user=${userId} from=${target.email} to=${email} by=${locals.user.id}`,
		);
		return { action: "setEmail", success: true };
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
		const role = formData.get("role");

		if (!isUserRole(role)) {
			return fail(400, { action: "setRole", error: "Invalid role." });
		}
		if (role !== "admin" && (await wouldRemoveLastAdmin(userId))) {
			return fail(400, {
				action: "setRole",
				error: "Can't demote the last admin.",
			});
		}

		await auth.api.setRole({
			body: { role: asAuthRole(role), userId },
			headers: request.headers,
		});
		logger.info(
			`Role changed: user=${userId} role=${role} by=${locals.user.id}`,
		);
		return { action: "setRole", success: true };
	},
};
