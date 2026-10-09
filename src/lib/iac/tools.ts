export const IAC_TOOLS = ["terraform", "opentofu", "pulumi"] as const;

export type IacTool = (typeof IAC_TOOLS)[number];

export interface IacToolInfo {
	cli: string;
	description: string;
	id: IacTool;
	label: string;
}

export const IAC_TOOL_INFO: Record<IacTool, IacToolInfo> = {
	opentofu: {
		cli: "tofu",
		description:
			"Terraform's open-source fork. Same provider and state backend, the tofu command instead of terraform.",
		id: "opentofu",
		label: "OpenTofu",
	},
	pulumi: {
		cli: "pulumi",
		description:
			"Infrastructure in TypeScript, Python or Go through the Terraform provider. Pulumi keeps its own state in the bucket.",
		id: "pulumi",
		label: "Pulumi",
	},
	terraform: {
		cli: "terraform",
		description:
			"HCL with the homerun provider. Homerun serves the state backend: every write versioned, locks included.",
		id: "terraform",
		label: "Terraform",
	},
};

/** Whether `value` names a supported IaC tool. */
export function isIacTool(value: unknown): value is IacTool {
	return IAC_TOOLS.includes(value as IacTool);
}

/** Whether the tool talks to Homerun's own Terraform http state backend rather than the bucket. */
export function usesHttpBackend(tool: IacTool): boolean {
	return tool !== "pulumi";
}
