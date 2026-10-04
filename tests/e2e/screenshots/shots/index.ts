import { shots as access } from "./access";
import { shots as errorPages } from "./error-pages";
import { shots as operations } from "./operations";
import { shots as platform } from "./platform";
import { shots as services } from "./services";
import type { ShotModule } from "./types";

export const SHOT_MODULES: ShotModule[] = [
	services,
	operations,
	access,
	platform,
	errorPages,
];
