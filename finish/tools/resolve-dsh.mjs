/**
 * Locate the DSH packages a test needs, without hard-coding one machine's paths.
 *
 * Three tools in this repo exercise the REAL DSH runtime rather than a model of
 * it (the icon table, `SlotCore`, the bundle-patch loader), so they must find the
 * installed packages. Resolution order:
 *
 *   1. `DSH_APP_ROOT` - an explicit directory that contains `@deepseek-ai/*`
 *      (typically `<dsh install>/node_modules`), or the directory itself.
 *   2. Node's own resolver from this package, which covers a normal install.
 *   3. A bounded scan of the obvious places on this machine: a sibling
 *      `node_modules`, the user's global npm prefix, and `~/.dsh/profiles`.
 *
 * Every helper returns `undefined` instead of throwing, so a test can skip with a
 * clear message on a machine that simply does not have that runtime.
 *
 * @module tools/resolve-dsh
 */
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(PACKAGE_ROOT, "package.json"));

/** Directories that may contain an `@deepseek-ai/*` tree, most specific first. */
function roots() {
	const found = [];
	const explicit = process.env.DSH_APP_ROOT;
	if (explicit !== undefined && explicit.trim() !== "") {
		found.push(resolve(explicit));
		found.push(join(resolve(explicit), "node_modules"));
	}
	// A profile's own node_modules, then the shared one one level up.
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	found.push(join(home, "profiles", "node_modules"));
	const profiles = join(home, "profiles");
	if (existsSync(profiles)) {
		for (const entry of readdirSync(profiles)) {
			found.push(join(profiles, entry, "node_modules"));
		}
	}
	// A global npm prefix and a couple of shallow neighbours.
	found.push(join(homedir(), "AppData", "Roaming", "npm", "node_modules"));
	found.push(join(PACKAGE_ROOT, "..", "node_modules"));
	return found.filter((entry) => existsSync(entry));
}

/**
 * Resolve one DSH package to its directory.
 * @param {string} name - package name, e.g. `@deepseek-ai/dsh-client-ui-slots`.
 * @returns {string | undefined} absolute package directory, or undefined.
 */
export function packageDir(name) {
	// 1. Node's resolver handles a normal install (including workspaces).
	try {
		return dirname(require.resolve(`${name}/package.json`));
	} catch {
		// fall through to the explicit scan
	}
	// 2. An explicit root, either the install's node_modules or a parent of it.
	for (const root of roots()) {
		const direct = join(root, name);
		if (existsSync(join(direct, "package.json"))) return direct;
		// The desktop/CLI bundles nest the whole tree under `dsh/node_modules`.
		const nested = join(root, "dsh", "node_modules", name);
		if (existsSync(join(nested, "package.json"))) return nested;
	}
	return undefined;
}

/**
 * Resolve one file inside a DSH package.
 * @param {string} name - package name.
 * @param {...string} segments - path segments inside the package.
 * @returns {string | undefined} absolute file path when it exists.
 */
export function packageFile(name, ...segments) {
	const directory = packageDir(name);
	if (directory === undefined) return undefined;
	const file = join(directory, ...segments);
	return existsSync(file) ? file : undefined;
}

/** One-line explanation for a skipped test. */
export function skipReason(name) {
	return (
		`${name} is not resolvable from ${PACKAGE_ROOT}.\n` +
		"Set DSH_APP_ROOT to a directory containing @deepseek-ai/* (a DSH install's node_modules)\n" +
		"or run the tests from a checkout that has the packages installed."
	);
}
