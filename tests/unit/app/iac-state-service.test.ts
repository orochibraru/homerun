import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { IacStateService } = await import(
	"../../../src/lib/services/iac-state.service"
);
const { IacProjectDTO } = await import("../../../src/lib/dto/iac-project-dto");
const { IacStateVersionDTO } = await import(
	"../../../src/lib/dto/iac-state-version-dto"
);
const { ObjectStoreDTO } = await import(
	"../../../src/lib/dto/object-store-dto"
);
const { ObjectStorageService } = await import(
	"../../../src/lib/services/object-storage.service"
);

type Project = NonNullable<Awaited<ReturnType<typeof IacProjectDTO.get>>>;
type Version = NonNullable<Awaited<ReturnType<typeof IacStateVersionDTO.get>>>;
type Store = NonNullable<Awaited<ReturnType<typeof ObjectStoreDTO.get>>>;
type Lock = Awaited<ReturnType<Project["currentLock"]>>;

const restorers: { mockRestore: () => void }[] = [];

afterEach(() => {
	for (const spy of restorers.splice(0)) {
		spy.mockRestore();
	}
});

function lockRow(lockId: string): NonNullable<Lock> {
	return {
		createdAt: new Date(),
		info: { ID: lockId, Who: "ci" },
		lockId,
		projectId: "p1",
		userId: null,
	};
}

function project(lock: Lock = null) {
	let held = lock;
	return {
		bucket: "tfstate",
		currentLock: mock(async () => held),
		id: "p1",
		lock: mock(async (input: { lockId: string }) => {
			held ??= lockRow(input.lockId);
			return held;
		}),
		prefix: "tf",
		slug: "lab",
		storeId: "s1",
		unlock: mock(async () => {
			held = null;
		}),
	} as unknown as Project;
}

function version(serial: number, id = `v${serial}`): Version {
	return {
		id,
		objectKey: `tf/lab/${serial}-${id}.tfstate`,
		projectId: "p1",
		serial,
	} as unknown as Version;
}

function bucket(objects: Record<string, string> = {}) {
	const store = { ...objects };
	const client = {
		getObject: mock(async (_bucket: string, key: string) => store[key] ?? null),
		putObject: mock(async (_bucket: string, key: string, body: string) => {
			store[key] = body;
		}),
	};
	restorers.push(
		spyOn(ObjectStoreDTO, "get").mockResolvedValue({} as Store),
		spyOn(ObjectStorageService, "client").mockResolvedValue(
			client as unknown as Awaited<
				ReturnType<typeof ObjectStorageService.client>
			>,
		),
	);
	return { client, store };
}

const state = (serial: number, names: string[] = []) =>
	JSON.stringify({
		lineage: "lin",
		resources: names.map((name) => ({
			instances: [{ attributes: { name } }],
			mode: "managed",
			name,
			type: "null_resource",
		})),
		serial,
		version: 4,
	});

describe("write", () => {
	test("stores the body as a new version under the project's folder", async () => {
		const { client } = bucket();
		const create = spyOn(IacStateVersionDTO, "create").mockImplementation(
			async (row) => row as unknown as Version,
		);
		restorers.push(create);
		const result = await IacStateService.write(project(), state(3), {
			lockId: null,
			userId: "u1",
		});
		expect(result.ok).toBe(true);
		const [, key, body] = client.putObject.mock.calls[0];
		expect(key).toMatch(/^tf\/lab\/3-.+\.tfstate$/);
		expect(body).toBe(state(3));
		expect(create.mock.calls[0][0]).toMatchObject({
			lineage: "lin",
			objectKey: key,
			projectId: "p1",
			rollbackOfId: null,
			serial: 3,
			userId: "u1",
		});
	});

	test("refuses a write while someone else holds the lock", async () => {
		const { client } = bucket();
		const result = await IacStateService.write(
			project(lockRow("theirs")),
			state(1),
			{ lockId: "mine", userId: null },
		);
		expect(result).toMatchObject({ ok: false, reason: "locked" });
		expect(client.putObject).not.toHaveBeenCalled();
	});

	test("lets the lock holder write", async () => {
		bucket();
		restorers.push(
			spyOn(IacStateVersionDTO, "create").mockImplementation(
				async (row) => row as unknown as Version,
			),
		);
		const result = await IacStateService.write(
			project(lockRow("mine")),
			state(2),
			{ lockId: "mine", userId: null },
		);
		expect(result.ok).toBe(true);
	});

	test("refuses a body that isn't a state", async () => {
		bucket();
		await expect(
			IacStateService.write(project(), "[]", { lockId: null, userId: null }),
		).rejects.toThrow("JSON object");
	});
});

describe("read", () => {
	test("is null before the first write, the latest body after", async () => {
		const latest = spyOn(IacStateVersionDTO, "latest").mockResolvedValue(null);
		restorers.push(latest);
		bucket({ "tf/lab/4-v4.tfstate": state(4) });
		expect(await IacStateService.read(project())).toBeNull();
		latest.mockResolvedValue(version(4));
		expect(await IacStateService.read(project())).toBe(state(4));
	});

	test("says which version is missing from the bucket", async () => {
		restorers.push(
			spyOn(IacStateVersionDTO, "latest").mockResolvedValue(version(4)),
		);
		bucket();
		await expect(IacStateService.read(project())).rejects.toThrow(
			"State version 4 is missing from tfstate",
		);
	});
});

describe("lock and unlock", () => {
	test("the first lock wins, the second sees the holder", async () => {
		const target = project();
		const first = await IacStateService.lock(target, { ID: "a" }, null);
		expect(first.ok).toBe(true);
		const second = await IacStateService.lock(target, { ID: "b" }, null);
		expect(second).toMatchObject({ lock: { lockId: "a" }, ok: false });
	});

	test("a lock without an ID is refused", async () => {
		await expect(IacStateService.lock(project(), {}, null)).rejects.toThrow(
			"no ID",
		);
	});

	test("unlocks only for the holder, or when forced", async () => {
		const target = project(lockRow("a"));
		expect(await IacStateService.unlock(target, "b")).toMatchObject({
			lockId: "a",
		});
		expect(target.unlock).not.toHaveBeenCalled();
		expect(await IacStateService.unlock(target, null, true)).toBeNull();
		expect(target.unlock).toHaveBeenCalled();
		expect(await IacStateService.unlock(project(), "x")).toBeNull();
	});
});

describe("diff", () => {
	test("compares a version with the one before it", async () => {
		bucket({
			"tf/lab/1-v1.tfstate": state(1, ["a", "b"]),
			"tf/lab/2-v2.tfstate": state(2, ["b", "c"]),
		});
		restorers.push(
			spyOn(IacStateVersionDTO, "get").mockResolvedValue(version(2)),
			spyOn(IacStateVersionDTO, "previous").mockResolvedValue(version(1)),
		);
		expect(await IacStateService.diff(project(), "v2")).toEqual({
			diff: {
				added: ["null_resource.c"],
				changed: [],
				removed: ["null_resource.a"],
			},
			previousSerial: 1,
			serial: 2,
		});
	});

	test("a missing version is an error", async () => {
		restorers.push(spyOn(IacStateVersionDTO, "get").mockResolvedValue(null));
		await expect(IacStateService.diff(project(), "nope")).rejects.toThrow(
			"doesn't exist",
		);
	});
});

describe("rollback", () => {
	test("writes the old body back with a serial past the latest", async () => {
		const { client } = bucket({ "tf/lab/1-v1.tfstate": state(1, ["a"]) });
		const create = spyOn(IacStateVersionDTO, "create").mockImplementation(
			async (row) => row as unknown as Version,
		);
		restorers.push(
			create,
			spyOn(IacStateVersionDTO, "get").mockResolvedValue(version(1)),
			spyOn(IacStateVersionDTO, "latest").mockResolvedValue(version(5)),
		);
		const result = await IacStateService.rollback(project(), "v1", "u1");
		expect(result.serial).toBe(6);
		expect(JSON.parse(client.putObject.mock.calls[0][2])).toMatchObject({
			serial: 6,
		});
		expect(create.mock.calls[0][0]).toMatchObject({
			rollbackOfId: "v1",
			userId: "u1",
		});
	});

	test("refuses while locked", async () => {
		await expect(
			IacStateService.rollback(project(lockRow("a")), "v1", "u1"),
		).rejects.toThrow("locked");
	});
});

describe("createProject", () => {
	test("slugs the name and trims the folder", async () => {
		const create = spyOn(IacProjectDTO, "create").mockImplementation(
			async (input) => input as unknown as Project,
		);
		restorers.push(
			create,
			spyOn(IacProjectDTO, "slugTaken").mockImplementation(
				async (slug) => slug === "home-lab",
			),
			spyOn(ObjectStoreDTO, "get").mockResolvedValue({} as Store),
			spyOn(ObjectStorageService, "bucketNames").mockResolvedValue(["tfstate"]),
		);
		await IacStateService.createProject({
			bucket: "tfstate",
			name: " Home Lab ",
			prefix: "/terraform/",
			storeId: "s1",
			userId: "u1",
		});
		expect(create.mock.calls[0][0]).toMatchObject({
			name: "Home Lab",
			prefix: "terraform",
			scope: null,
			slug: "home-lab-2",
			tool: "terraform",
		});
	});

	test("keeps the tool and the scope", async () => {
		const create = spyOn(IacProjectDTO, "create").mockImplementation(
			async (input) => input as unknown as Project,
		);
		restorers.push(
			create,
			spyOn(IacProjectDTO, "slugTaken").mockResolvedValue(false),
			spyOn(ObjectStoreDTO, "get").mockResolvedValue({} as Store),
			spyOn(ObjectStorageService, "bucketNames").mockResolvedValue(["state"]),
		);
		await IacStateService.createProject({
			bucket: "state",
			name: "web",
			prefix: "",
			scope: " stack:abc ",
			storeId: "s1",
			tool: "pulumi",
			userId: "u1",
		});
		expect(create.mock.calls[0][0]).toMatchObject({
			scope: "stack:abc",
			tool: "pulumi",
		});
	});

	test("creates the bucket only when the store doesn't have it", async () => {
		const createBucket = spyOn(
			ObjectStorageService,
			"createBucket",
		).mockResolvedValue();
		const names = spyOn(ObjectStorageService, "bucketNames").mockResolvedValue(
			[],
		);
		restorers.push(
			createBucket,
			names,
			spyOn(IacProjectDTO, "create").mockImplementation(
				async (input) => input as unknown as Project,
			),
			spyOn(IacProjectDTO, "slugTaken").mockResolvedValue(false),
			spyOn(ObjectStoreDTO, "get").mockResolvedValue({} as Store),
		);
		const input = {
			bucket: "tfstate",
			name: "lab",
			prefix: "",
			storeId: "s1",
			userId: "u1",
		};
		await IacStateService.createProject(input);
		expect(createBucket).toHaveBeenCalledTimes(1);
		names.mockResolvedValue(["tfstate"]);
		await IacStateService.createProject(input);
		expect(createBucket).toHaveBeenCalledTimes(1);
	});

	test("refuses an empty name, a bad bucket or a missing store", async () => {
		restorers.push(spyOn(ObjectStoreDTO, "get").mockResolvedValue(null));
		const input = {
			bucket: "tfstate",
			name: "lab",
			prefix: "",
			storeId: "s1",
			userId: "u1",
		};
		await expect(
			IacStateService.createProject({ ...input, name: " " }),
		).rejects.toThrow("name");
		await expect(
			IacStateService.createProject({ ...input, bucket: "Bad_Bucket" }),
		).rejects.toThrow("bucket name");
		await expect(
			IacStateService.createProject({ ...input, tool: "ansible" }),
		).rejects.toThrow("Pulumi");
		await expect(
			IacStateService.createProject({ ...input, scope: "volume:x" }),
		).rejects.toThrow("scope");
		await expect(IacStateService.createProject(input)).rejects.toThrow(
			"doesn't exist",
		);
	});
});

describe("updateProject", () => {
	test("renames and changes the tool and scope, clearing an empty scope", async () => {
		const update = mock(async () => {});
		await IacStateService.updateProject({ update } as unknown as Project, {
			name: " Lab ",
			scope: "",
			tool: "opentofu",
		});
		expect(update).toHaveBeenCalledWith({
			name: "Lab",
			scope: null,
			tool: "opentofu",
		});
	});

	test("refuses an empty name or an unknown tool", async () => {
		const target = { update: mock(async () => {}) } as unknown as Project;
		await expect(
			IacStateService.updateProject(target, { name: " " }),
		).rejects.toThrow("name");
		await expect(
			IacStateService.updateProject(target, { name: "lab", tool: "chef" }),
		).rejects.toThrow("Pulumi");
	});
});
