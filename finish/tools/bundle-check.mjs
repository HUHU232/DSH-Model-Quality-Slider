/**
 * Bundle-declaration check.
 *
 * A package becomes a PROFILE LAYER only when it declares `dsh.bundle.patch`: the
 * installer reads that declaration, loads the listed patch files into the profile's
 * layer stack, and appends the package name to `dsh.profile.bundles`. Without it
 * the package is installed as a plain dependency - installers warn
 * "declares no dsh.bundle" - and no row ever mounts the plugin.
 *
 * This check validates the package's own declaration, then feeds its patch file to
 * the REAL loader (`loadOverlayPatches` from the installed DSH runtime) so a
 * malformed layer fails here instead of at install time. The loader arm skips
 * when no runtime is installed.
 *
 * Usage: node tools/bundle-check.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT, packageFile, skipReason } from "./resolve-dsh.mjs";

const failures = [];
const check = (label, ok, detail) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === void 0 ? "" : "  <- " + detail}`);
	if (!ok) failures.push(label);
};

// ── 1. declaration shape ─────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
check("package name matches the row's module name", manifest.name === "dsh-reasoning-slider", manifest.name);

const bundle = manifest.dsh?.bundle;
check("declares dsh.bundle", bundle !== void 0, JSON.stringify(manifest.dsh));
const declared = typeof bundle?.patch === "string" ? [bundle.patch] : bundle?.patch;
check(
	"dsh.bundle.patch is a path or a list of paths",
	Array.isArray(declared) && declared.length > 0 && declared.every((file) => typeof file === "string"),
	JSON.stringify(bundle?.patch)
);

const patchFiles = (declared ?? []).map((file) => resolve(PACKAGE_ROOT, file));
for (const file of patchFiles) {
	check(`patch file exists: ${file.slice(PACKAGE_ROOT.length + 1)}`, existsSync(file));
}

check("declares the browser half", manifest.dsh?.client?.platform === "web", manifest.dsh?.client?.platform);
check("exports ./client", manifest.exports?.["./client"] !== void 0, JSON.stringify(manifest.exports?.["./client"]));
check(
	"client bundle file exists",
	existsSync(resolve(PACKAGE_ROOT, manifest.exports?.["./client"] ?? "")),
	manifest.exports?.["./client"]
);

// ── 2. the real loader must accept the layer ─────────────────────────────────
const appBoot = packageFile("@deepseek-ai/dsh-app-boot", "lib", "index.js");
if (appBoot === undefined) {
	console.log("\nSKIP  loader arm: " + skipReason("@deepseek-ai/dsh-app-boot"));
} else {
	const { loadOverlayPatches } = await import(pathToFileURL(appBoot).href);
	check("loadOverlayPatches is exported by the installed runtime", typeof loadOverlayPatches === "function");

	if (typeof loadOverlayPatches === "function") {
		for (const file of patchFiles) {
			const label = `loader accepts ${file.slice(PACKAGE_ROOT.length + 1)}`;
			try {
				const entries = loadOverlayPatches("dsh", file);
				check(label, Array.isArray(entries) && entries.length > 0, `${entries?.length ?? 0} top-level patch entries`);
				const inserted = (entries ?? []).flatMap((entry) => (Array.isArray(entry?.insert) ? entry.insert : []));
				const row = inserted.find((entry) => entry?.name === manifest.name);
				check("layer inserts a row for this package", row !== void 0, JSON.stringify(inserted.map((entry) => entry?.name)));
				check("row carries an id so deployments can target it", typeof row?.id === "string" && row.id.length > 0, row?.id);
			} catch (error) {
				check(label, false, error instanceof Error ? error.message : String(error));
			}
		}
	}
}

console.log(failures.length === 0 ? "\nbundle-check: ok" : `\nbundle-check: ${failures.length} FAILED -> ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
