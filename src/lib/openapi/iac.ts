import { z } from "zod";
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
		description: `Releases the state lock held under the body's lock id. ${basicAuth}`,
		method: "delete",
		path: "/iac/projects/{projectId}/lock",
		pathParams: projectIdParam,
		requestBody: lockInfo,
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
];
