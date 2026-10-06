/**
 * Offline smoke check for the dsh-reasoning-slider client bundle.
 *
 * It stubs `window.__ModuleLoader__` (the browser registration facade), captures
 * the factory, materializes the bundle against stub `react` / `react-dom` /
 * `@deepseek-ai/dsh-client-ui-primitives` modules, and asserts the surface the
 * client runtime expects: `apply` + `inject`, one CSS tag, one dictionary
 * registration, and one seat registration carrying the shadowing priority.
 *
 * Run: node tools/smoke.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// ── browser stubs ────────────────────────────────────────────────────────────
const styleTags = [];
globalThis.document = {
	head: {
		appendChild(node) {
			styleTags.push(node);
		}
	},
	querySelector() {
		return null;
	},
	createElement(tag) {
		return { tag, dataset: {}, textContent: "" };
	},
	addEventListener() {},
	removeEventListener() {}
};

let registration;
globalThis.window = {
	__ModuleLoader__: {
		load(value) {
			registration = value;
		}
	}
};

// ── module stubs ─────────────────────────────────────────────────────────────
const react = {
	createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
	useCallback: (fn) => fn,
	useEffect: () => {},
	useLayoutEffect: () => {},
	useMemo: (fn) => fn(),
	useRef: (value) => ({ current: value }),
	useState: (value) => [value, () => {}],
	useSyncExternalStore: (subscribe, get) => get()
};
const reactDom = { createPortal: (node) => node };
const primitives = new Proxy(
	{},
	{
		get: (_target, name) => (props) => ({ type: String(name), props: props ?? {} })
	}
);

const table = {
	react,
	"react-dom": reactDom,
	"@deepseek-ai/dsh-client-ui-primitives": primitives
};

// ── run the bundle ───────────────────────────────────────────────────────────
new Function("window", "document", source)(globalThis.window, globalThis.document);

assert.ok(registration !== undefined, "bundle did not call window.__ModuleLoader__.load");
assert.equal(registration.id, "dsh-reasoning-slider", "registration id must be the package name");

const bundle = registration.factory((specifier) => {
	assert.ok(specifier in table, `unexpected require("${specifier}") - not in the platform table`);
	return table[specifier];
});

assert.equal(typeof bundle.apply, "function", "apply must be exported");
assert.deepEqual(
	bundle.inject,
	["slots", "locale", "modelDirectories", "sessions", "remote", "remote.session"],
	"inject must list the services the bundle reads"
);
assert.equal(styleTags.length, 1, "exactly one plugin CSS tag must be injected");
assert.equal(styleTags[0].dataset.plugin, "dsh-reasoning-slider", "CSS tag must be namespaced");

// ── exercise apply() against a stub client context ───────────────────────────
const localeRegistrations = [];
const slotInjections = [];
const slotRegistrations = [];
const scopedInjections = [];
const declarationInjections = [];
const slotSubscriptions = [];
const declarationSubscriptions = [];
const disposers = [];

const scope = {
	locale: {
		register(namespace, dictionaries) {
			localeRegistrations.push({ namespace, dictionaries });
			return () => {};
		},
		bind(namespace) {
			return (key) => `bound:${namespace}:${key}`;
		}
	},
	slots: {
		register(options, component) {
			slotRegistrations.push({ options, component });
			return () => {};
		},
		// The declaration seam: fires once per declaration lifetime.
		inject(key, callback) {
			declarationInjections.push(key);
			const dispose = callback();
			if (dispose !== void 0) disposers.push(dispose);
			return () => {};
		},
		// The change stream, which must stay untouched (see freeze-repro.mjs).
		subscribe(key, listener) {
			slotSubscriptions.push(key);
			return () => {};
		},
		subscribeDeclaration(key, listener) {
			declarationSubscriptions.push(key);
			return () => {};
		}
	},
	modelDirectories: { directoryFor: () => ({ store: {}, load: () => {}, select: () => {} }) },
	sessions: { subagentAddress: () => void 0 },
	effect(callback) {
		const dispose = callback();
		if (dispose !== void 0) disposers.push(dispose);
		return () => {};
	},
	inject(services, callback) {
		scopedInjections.push(services.join("+"));
		callback(scope);
		return () => {};
	}
};

bundle.apply(scope);

assert.deepEqual(scopedInjections, ["slots+modelDirectories"], "the seat needs the directory service");
assert.deepEqual(localeRegistrations.map((row) => row.namespace), ["reasoning-slider"]);
const dictionaries = localeRegistrations[0].dictionaries;
assert.ok(dictionaries.zh !== void 0 && dictionaries.en !== void 0, "both locales required");
assert.deepEqual(
	Object.keys(dictionaries.zh).sort(),
	Object.keys(dictionaries.en).sort(),
	"zh and en key sets must match"
);

// The freeze regression: claiming the seat must go through the declaration seam,
// never through the key's change stream.
assert.deepEqual(
	declarationInjections,
	["conversation.input.model"],
	"the seat must be claimed through slots.inject"
);
assert.deepEqual(
	slotSubscriptions,
	[],
	"the seat must NOT subscribe to the key's change stream (that loop froze the page)"
);
assert.deepEqual(
	declarationSubscriptions,
	[],
	"no manual declaration subscription when the slots.inject seam exists"
);

assert.equal(slotRegistrations.length, 1, "exactly one seat registration");
const claim = slotRegistrations[0];
assert.equal(claim.options.name, "conversation.input.model");
assert.equal(claim.options.locale, "reasoning-slider");
assert.equal(typeof claim.options.inject, "function", "the claim must build the injected face");
assert.ok(
	claim.options.priority < 0,
	"the seat claim must sit below the shipped ModelSelect's priority 0 to shadow it"
);
assert.equal(typeof claim.component, "function", "the claim must carry a component");

const face = claim.options.inject("session-1");
assert.equal(face.available, true);
assert.equal(typeof face.load, "function");
assert.equal(typeof face.select, "function");

for (const dispose of disposers) {
	if (dispose !== void 0) assert.equal(typeof dispose, "function", "effects must dispose");
}

console.log("smoke: ok");
console.log("  registration id :", registration.id);
console.log("  inject          :", bundle.inject.join(", "));
console.log("  seat claim      : conversation.input.model @ priority", claim.options.priority);
console.log("  dictionaries    :", Object.keys(dictionaries.zh).length, "keys x 2 locales");
