import { eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type TemplateLink,
	template,
	templateLink,
} from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface NewTemplateLinkInput {
	alias: string;
	linkedTemplateId: string;
	templateId: string;
}

export interface TemplateLinkWithTemplate {
	link: TemplateLinkDTO;
	linkedTemplateContainerPort: number;
	linkedTemplateCpuLimit: string | null;
	linkedTemplateEnvVars: Record<string, string>;
	linkedTemplateIcon: string | null;
	linkedTemplateImage: string;
	linkedTemplateMemoryLimitMb: number | null;
	linkedTemplateName: string;
	linkedTemplateRestartPolicy: string;
	linkedTemplateTag: string;
}

export class TemplateLinkDTO extends BaseDTO<TemplateLink> {
	static async listForTemplate(
		templateId: string,
	): Promise<TemplateLinkWithTemplate[]> {
		const rows = await db
			.select({
				linkedTemplateContainerPort: template.containerPort,
				linkedTemplateCpuLimit: template.cpuLimit,
				linkedTemplateEnvVars: template.envVars,
				linkedTemplateIcon: template.icon,
				linkedTemplateImage: template.image,
				linkedTemplateMemoryLimitMb: template.memoryLimitMb,
				linkedTemplateName: template.name,
				linkedTemplateRestartPolicy: template.restartPolicy,
				linkedTemplateTag: template.tag,
				row: templateLink,
			})
			.from(templateLink)
			.innerJoin(template, eq(templateLink.linkedTemplateId, template.id))
			.where(eq(templateLink.templateId, templateId));
		return rows.map((r) => ({
			link: new TemplateLinkDTO(r.row),
			linkedTemplateContainerPort: r.linkedTemplateContainerPort,
			linkedTemplateCpuLimit: r.linkedTemplateCpuLimit,
			linkedTemplateEnvVars: r.linkedTemplateEnvVars ?? {},
			linkedTemplateIcon: r.linkedTemplateIcon,
			linkedTemplateImage: r.linkedTemplateImage,
			linkedTemplateMemoryLimitMb: r.linkedTemplateMemoryLimitMb,
			linkedTemplateName: r.linkedTemplateName,
			linkedTemplateRestartPolicy: r.linkedTemplateRestartPolicy,
			linkedTemplateTag: r.linkedTemplateTag,
		}));
	}

	static async countForTemplate(templateId: string): Promise<number> {
		const rows = await db
			.select({ id: templateLink.id })
			.from(templateLink)
			.where(eq(templateLink.templateId, templateId));
		return rows.length;
	}

	static async create(input: NewTemplateLinkInput): Promise<TemplateLinkDTO> {
		const row: TemplateLink = {
			alias: input.alias,
			createdAt: new Date(),
			id: crypto.randomUUID(),
			linkedTemplateId: input.linkedTemplateId,
			templateId: input.templateId,
		};
		await db.insert(templateLink).values(row);
		return new TemplateLinkDTO(row);
	}

	async remove(): Promise<void> {
		await db.delete(templateLink).where(eq(templateLink.id, this.row.id));
	}

	get id(): string {
		return this.row.id;
	}
	get alias(): string {
		return this.row.alias;
	}
	get linkedTemplateId(): string {
		return this.row.linkedTemplateId;
	}
	get templateId(): string {
		return this.row.templateId;
	}
}
