import { describe, expect, test } from "bun:test";
import { perPageSchema } from "../../../src/lib/server/validation/appearance";

describe("perPageSchema", () => {
	test("accepts only the listed page sizes, from form strings", () => {
		for (const size of ["25", "50", "100", "200"]) {
			expect(perPageSchema.safeParse({ perPage: size }).data?.perPage).toBe(
				Number(size),
			);
		}
		for (const bad of ["", "0", "24", "500", "50.5", "abc", "-50"]) {
			expect(perPageSchema.safeParse({ perPage: bad }).success).toBe(false);
		}
	});
});
