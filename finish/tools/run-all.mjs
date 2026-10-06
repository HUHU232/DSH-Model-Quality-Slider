/**
 * Run every check this package ships, and summarise.
 *
 * The four offline checks need nothing but Node; the two runtime checks locate a
 * DSH installation (see tools/resolve-dsh.mjs) and skip with an explanation when
 * there is none. Exit status is non-zero only for a real failure - a skip is not
 * a failure.
 *
 * Usage: node tools/run-all.mjs
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PACKAGE_ROOT } from "./resolve-dsh.mjs";

const checks = [
	["bundle-check", "profile-layer declaration, validated by the installed loader"],
	["smoke", "bundle registration, inject table, dictionaries, seat priority"],
	["primitives-check", "icon names vs the installed primitives table"],
	["render-test", "rendered structure, drag submission, model picker, fallback"],
	["slot-live-test", "termination against the real SlotCore (the freeze regression)"],
	["freeze-repro", "self-contained model of the loop the fix removes"]
];

const results = [];
for (const [name, what] of checks) {
	console.log(`\n${"=".repeat(72)}\n${name}: ${what}\n${"=".repeat(72)}`);
	const run = spawnSync(process.execPath, [join(PACKAGE_ROOT, "tools", `${name}.mjs`)], {
		stdio: "inherit",
		cwd: PACKAGE_ROOT
	});
	const code = run.status ?? 1;
	results.push({ name, code });
}

console.log(`\n${"=".repeat(72)}\nsummary\n${"=".repeat(72)}`);
for (const { name, code } of results) {
	console.log(`${code === 0 ? "ok  " : "FAIL"}  ${name}`);
}
const failed = results.filter((entry) => entry.code !== 0);
console.log(failed.length === 0 ? "\nrun-all: all checks passed" : `\nrun-all: ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
