import type { IacAttribute, IacKind } from "#lib/iac/resources.js";
import { DEFAULT_SWARM_PLACEMENT } from "#lib/swarm-placement.js";

type AttributeFactory = (
	name: string,
	kind: IacKind,
	options?: Omit<Partial<IacAttribute>, "kind" | "name">,
) => IacAttribute;

/** The homerun_service attribute of which swarm nodes run its replicas, one object of roles, label constraints and spread preferences. */
export function swarmPlacementAttribute(attr: AttributeFactory): IacAttribute {
	return attr("swarmPlacement", "object", {
		default: DEFAULT_SWARM_PLACEMENT,
		description: "Swarm mode only: which nodes run the replicas.",
		fields: [
			attr("roles", "strings", {
				default: DEFAULT_SWARM_PLACEMENT.roles,
				description: "Node roles allowed to run them: manager, worker or both.",
			}),
			attr("constraints", "strings", {
				default: [],
				description:
					"Node label constraints, key==value or key!=value, all of which a node has to match.",
			}),
			attr("preferences", "strings", {
				default: [],
				description: "Node label keys the replicas are spread evenly over.",
			}),
		],
	});
}
