import { describe, expect, mock, test } from "bun:test";

let user: { email: string; id: string; name: string } | null = null;
let inside = true;

mock.module("$app/server", () => ({
	getRequestEvent: () => {
		if (!inside) {
			throw new Error("Not inside a request.");
		}
		return { locals: { user } };
	},
}));

const { requestActor } = await import("../../../src/lib/server/request-actor");

describe("requestActor", () => {
	test("is the signed-in user, by name or else email", () => {
		inside = true;
		user = { email: "ada@example.com", id: "u1", name: "Ada" };
		expect(requestActor()).toEqual({ id: "u1", name: "Ada" });
		user = { email: "ada@example.com", id: "u1", name: "" };
		expect(requestActor()).toEqual({ id: "u1", name: "ada@example.com" });
	});

	test("is nobody when signed out or outside a request", () => {
		user = null;
		expect(requestActor()).toBeNull();
		inside = false;
		expect(requestActor()).toBeNull();
	});
});
