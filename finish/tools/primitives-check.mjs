/**
 * Primitives-contract check.
 *
 * The seat builds its icons out of the platform's shared
 * `@deepseek-ai/dsh-client-ui-primitives` table. A name that table lacks reaches
 * React as `undefined`, and React answers with error #130 ("element type is
 * invalid") - a failure no stub-only test can see, and one this plugin actually
 * hit when it was first written against a different release.
 *
 * So this check compares the icon names the seat asks for against the package
 * installed on THIS machine, preferring the declared surface
 * (`lib/types/icons/index.d.ts`) and falling back to the identifiers in the
 * shipped bundle (`lib/index.js`). It skips with an explanation when the runtime
 * is not installed rather than failing.
 *
 * Usage: node tools/primitives-check.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT, packageDir, skipReason } from "./resolve-dsh.mjs";

const seat = readFileSync(join(PACKAGE_ROOT, "lib", "client.js"), "utf8");

/** Icon names the seat may reach for, in its own preference order. */
const block = /const ICONS = \{([\s\S]*?)\n\t\t\};/.exec(seat);
if (block === null) {
	console.error("could not locate the ICONS table in lib/client.js");
	process.exit(2);
}
const wanted = [...block[1].matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]);

const directory = packageDir("@deepseek-ai/dsh-client-ui-primitives");
if (directory === undefined) {
	console.log("SKIP  " + skipReason("@deepseek-ai/dsh-client-ui-primitives"));
	process.exit(0);
}

/** The declared surface first; the shipped bundle identifiers as a fallback. */
const surfaces = [
	{ file: join(directory, "lib", "types", "icons", "index.d.ts"), label: "type declarations" },
	{ file: join(directory, "lib", "index.js"), label: "bundle identifiers" }
];

let resolved;
for (const surface of surfaces) {
	let text;
	try {
		text = readFileSync(surface.file, "utf8");
	} catch {
		continue;
	}
	const exported = new Set([...text.matchAll(/(Icon[A-Za-z0-9]+)/g)].map((match) => match[1]));
	if (exported.size === 0) continue;
	resolved = { ...surface, exported };
	break;
}

if (resolved === undefined) {
	console.log(`SKIP  no icon surface found under ${directory}`);
	process.exit(0);
}

console.log("primitives :", directory);
console.log("surface    :", resolved.label, `(${resolved.file.slice(directory.length + 1)})`);
console.log("names      :", resolved.exported.size);
console.log("seat wants :", wanted.length);

const missing = wanted.filter((name) => !resolved.exported.has(name));
if (missing.length > 0) {
	console.error("\nMISSING from the installed primitives table:", missing.join(", "));
	console.error("Each renders as `undefined`, which React rejects with error #130.");
	process.exit(1);
}
console.log("\nprimitives-check: ok - every icon the seat may use is defined by the installed build");
