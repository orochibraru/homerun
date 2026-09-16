import process from "node:process";
import { version } from "../../../package.json";

export const APP_VERSION = process.env.HOMERUN_APP_VERSION?.trim() || version;
