/**
 * Points Pi's agent dir at test/fixtures/agent/ so tests never read the real ~/.pi.
 *
 * Must be the first import in each test file: pi-gears.ts loads gears.json at import time.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "agent");

process.env.PI_CODING_AGENT_DIR = FIXTURE_AGENT_DIR;
