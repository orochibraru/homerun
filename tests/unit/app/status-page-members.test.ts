import { describe, expect, test } from "bun:test";
import {
	picksFromForm,
	resolveStatusPageMembers,
	statusPageServiceOptions,
} from "../../../src/lib/status-page-members";

const candidate = (
	id: string,
	previewParentId: string | null = null,
	previewPrNumber: number | null = null,
	channelCanary = false,
) => ({ channelCanary, id, name: id, previewParentId, previewPrNumber });

const services = [
	candidate("api"),
	candidate("api-pr-12", "api", 12),
	candidate("web"),
	candidate("api-pr-3", "api", 3),
	candidate("api-canary", "api", null, true),
	candidate("api-staging", "api"),
	candidate("web-pr-1", "web", 1),
];

const shape = (members: { childOf: string | null; id: string }[]) =>
	members.map(({ childOf, id }) => ({ childOf, id }));

describe("resolveStatusPageMembers", () => {
	test("shows only the picks when none includes its children", () => {
		expect(
			shape(
				resolveStatusPageMembers(
					[
						{ includeChildren: false, serviceId: "web" },
						{ includeChildren: false, serviceId: "api" },
					],
					services,
				),
			),
		).toEqual([
			{ childOf: null, id: "api" },
			{ childOf: null, id: "web" },
		]);
	});

	test("puts the canary then previews by PR number right after their parent, never its environments", () => {
		expect(
			shape(
				resolveStatusPageMembers(
					[
						{ includeChildren: true, serviceId: "api" },
						{ includeChildren: false, serviceId: "web" },
					],
					services,
				),
			),
		).toEqual([
			{ childOf: null, id: "api" },
			{ childOf: "api", id: "api-canary" },
			{ childOf: "api", id: "api-pr-3" },
			{ childOf: "api", id: "api-pr-12" },
			{ childOf: null, id: "web" },
		]);
	});

	test("an environment is picked on its own, with its name", () => {
		expect(
			resolveStatusPageMembers(
				[{ includeChildren: false, serviceId: "api-staging" }],
				services,
			),
		).toEqual([{ childOf: null, id: "api-staging", name: "api-staging" }]);
	});

	test("a closed preview simply drops out", () => {
		const open = services.filter((svc) => svc.id !== "api-pr-3");
		expect(
			resolveStatusPageMembers(
				[{ includeChildren: true, serviceId: "api" }],
				open,
			).map((member) => member.id),
		).toEqual(["api", "api-canary", "api-pr-12"]);
	});

	test("a child picked on its own isn't repeated under its parent", () => {
		expect(
			shape(
				resolveStatusPageMembers(
					[
						{ includeChildren: true, serviceId: "api" },
						{ includeChildren: false, serviceId: "api-pr-12" },
					],
					services,
				),
			),
		).toEqual([
			{ childOf: null, id: "api" },
			{ childOf: "api", id: "api-canary" },
			{ childOf: "api", id: "api-pr-3" },
			{ childOf: null, id: "api-pr-12" },
		]);
	});

	test("a pick whose service is gone shows nothing", () => {
		expect(
			resolveStatusPageMembers(
				[{ includeChildren: true, serviceId: "deleted" }],
				services,
			),
		).toEqual([]);
	});
});

describe("picksFromForm", () => {
	test("pairs each picked service with its include-children flag, once", () => {
		const form = new FormData();
		form.append("serviceIds", "api");
		form.append("serviceIds", "web");
		form.append("serviceIds", "api");
		form.append("serviceIds", "");
		form.append("includeChildren", "api");
		form.append("includeChildren", "not-picked");
		expect(picksFromForm(form)).toEqual([
			{ includeChildren: true, serviceId: "api" },
			{ includeChildren: false, serviceId: "web" },
		]);
	});
});

describe("statusPageServiceOptions", () => {
	test("offers children on a service with previews, channels or live children", () => {
		const base = {
			channelCanary: false,
			channelsEnabled: false,
			name: "x",
			previewParentId: null,
			previewPrNumber: null,
			previewsEnabled: false,
			stackId: null,
		};
		const options = statusPageServiceOptions([
			{ ...base, id: "plain" },
			{ ...base, id: "previews", previewsEnabled: true },
			{ ...base, channelsEnabled: true, id: "channels" },
			{ ...base, id: "parent" },
			{ ...base, id: "child", previewParentId: "parent", previewPrNumber: 4 },
			{ ...base, id: "envparent" },
			{ ...base, id: "staging", previewParentId: "envparent" },
		]);
		expect(
			Object.fromEntries(options.map((opt) => [opt.id, opt.hasChildren])),
		).toEqual({
			channels: true,
			child: false,
			envparent: false,
			parent: true,
			plain: false,
			previews: true,
			staging: false,
		});
		expect(
			Object.fromEntries(options.map((opt) => [opt.id, opt.pickable])),
		).toMatchObject({ child: false, parent: true, staging: true });
	});
});
