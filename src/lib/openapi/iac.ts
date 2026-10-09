import { z } from "zod";
import { IAC_TOOLS } from "#lib/iac/tools.js";
import { iacProjectApiBody } from "#lib/server/validation/iac.js";
import type { ParamDef, RouteDef } from "./registry";
import { errorResponse, successResponse } from "./schemas";

const projectIdParam: ParamDef[] = [
	{ description: "State project id", name: "projectId" },
];

const terraformState = z
	.record(z.string(), z.unknown())
	.meta({ description: "A Terraform state document, as Terraform writes it" });

const lockInfo = z
	.object({
		Created: z.string().optional(),
		ID: z.string(),
		Info: z.string().optional(),
		Operation: z.string().optional(),
		Path: z.string().optional(),
		Version: z.string().optional(),
		Who: z.string().optional(),
	})
	.meta({ description: "Terraform's lock info" });

const projectResponse = z.object({
	bucket: z.string(),
	createdAt: z.string(),
	id: z.string(),
	locked: z.boolean(),
	name: z.string(),
	prefix: z.string(),
	scope: z.string().nullable().meta({
		description: "What the project manages: stack:<id> or service:<id>",
	}),
	serial: z.number().nullable().meta({
		description: "The latest state's serial, null before the first write",
	}),
	slug: z.string(),
	storeId: z.string(),
	tool: z.enum(IAC_TOOLS),
	updatedAt: z
		.string()
		.nullable()
		.meta({ description: "When the latest state was written" }),
});

const generatedProject = z.object({
	files: z.array(z.object({ content: z.string(), path: z.string() })),
	name: z.string(),
	slug: z.string(),
});

const unauthorized = { description: "Unauthorized", schema: errorResponse };
const forbidden = { description: "Admins only", schema: errorResponse };
const notFound = { description: "No such project", schema: errorResponse };
const tags = ["Terraform state"];
const basicAuth =
	"Terraform's http backend: authenticate with HTTP Basic, any username and an API key as the password.";

export const iacRoutes: RouteDef[] = [
	{
		description: `The project's latest state. ${basicAuth}`,
		method: "get",
		path: "/iac/projects/{projectId}/state",
		pathParams: projectIdParam,
		responses: {
			200: { description: "The latest state", schema: terraformState },
			204: { description: "Nothing written yet" },
			401: unauthorized,
			403: forbidden,
			404: notFound,
		},
		summary: "Read Terraform state",
		tags,
	},
	{
		description: `Stores a new state version in the project's bucket. Refused while the state is locked under another lock id. ${basicAuth}`,
		method: "post",
		path: "/iac/projects/{projectId}/state",
		pathParams: projectIdParam,
		queryParams: [
			{ description: "The lock id this write holds, when locked", name: "ID" },
		],
		requestBody: terraformState,
		responses: {
			200: {
				description: "Stored",
				schema: z.object({ serial: z.number(), success: z.boolean() }),
			},
			400: { description: "Not a Terraform state", schema: errorResponse },
			401: unauthorized,
			403: forbidden,
			404: notFound,
			409: { description: "Locked by someone else", schema: lockInfo },
		},
		summary: "Write Terraform state",
		tags,
	},
	{
		description: `Takes the state lock. ${basicAuth}`,
		method: "post",
		path: "/iac/projects/{projectId}/lock",
		pathParams: projectIdParam,
		requestBody: lockInfo,
		responses: {
			200: { description: "Locked", schema: lockInfo },
			400: { description: "No lock id", schema: errorResponse },
			401: unauthorized,
			403: forbidden,
			404: notFound,
			423: {
				description: "Already locked: the holder's lock info",
				schema: lockInfo,
			},
		},
		summary: "Lock Terraform state",
		tags,
	},
	{
		description: `Releases the state lock held under the body's lock id, or whatever holds it with ?force=true (only when the Terraform that took it is gone). ${basicAuth}`,
		method: "delete",
		path: "/iac/projects/{projectId}/lock",
		pathParams: projectIdParam,
		queryParams: [
			{ description: "true releases the lock whoever holds it", name: "force" },
		],
		requestBody: lockInfo,
		requestBodyOptional: true,
		responses: {
			200: { description: "Unlocked", schema: successResponse },
			401: unauthorized,
			403: forbidden,
			404: notFound,
			423: { description: "Held under another lock id", schema: lockInfo },
		},
		summary: "Unlock Terraform state",
		tags,
	},
	{
		description:
			"Every Terraform state project, with its latest serial and whether it's locked.",
		method: "get",
		path: "/iac/projects",
		responses: {
			200: {
				description: "The projects",
				isArray: true,
				schema: projectResponse,
			},
			401: unauthorized,
			403: forbidden,
		},
		summary: "List Terraform state projects",
		tags,
	},
	{
		description:
			"Creates a project keeping its state in a bucket of an object store.",
		method: "post",
		path: "/iac/projects",
		requestBody: iacProjectApiBody,
		responses: {
			201: { description: "Created", schema: projectResponse },
			400: { description: "Invalid body", schema: errorResponse },
			401: unauthorized,
			403: forbidden,
		},
		summary: "Create a Terraform state project",
		tags,
	},
	{
		method: "get",
		path: "/iac/projects/{projectId}",
		pathParams: projectIdParam,
		responses: {
			200: { description: "The project", schema: projectResponse },
			401: unauthorized,
			403: forbidden,
			404: notFound,
		},
		summary: "Get a Terraform state project",
		tags,
	},
	{
		description:
			"Forgets the project, its versions and its lock. The state files stay in the bucket.",
		method: "delete",
		path: "/iac/projects/{projectId}",
		pathParams: projectIdParam,
		responses: {
			200: { description: "Deleted", schema: successResponse },
			401: unauthorized,
			403: forbidden,
			404: notFound,
		},
		summary: "Delete a Terraform state project",
		tags,
	},
	{
		description:
			"A Terraform project for one stack (its substacks included) or one service: versions.tf, providers.tf, a file per service, stacks.tf, volumes.tf, and when there are secrets variables.tf, terraform.tfvars (secret env var values filled in) and terraform.tfvars.example. As JSON by default, or a zip with ?format=zip.",
		method: "get",
		path: "/iac/generate",
		queryParams: [
			{
				description: "stack:<id or slug> or service:<id or slug>",
				name: "scope",
			},
			{
				description: "A state project id, to add its http backend block",
				name: "project",
			},
			{ description: "zip for an archive instead of JSON", name: "format" },
		],
		responses: {
			200: { description: "The project's files", schema: generatedProject },
			400: { description: "No scope", schema: errorResponse },
			401: unauthorized,
			403: forbidden,
			404: {
				description: "No such stack, service or project",
				schema: errorResponse,
			},
		},
		summary: "Generate a Terraform project",
		tags: ["Infrastructure as code"],
	},
];
