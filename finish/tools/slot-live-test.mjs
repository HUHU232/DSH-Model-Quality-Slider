/**
 * Live slot-system test: the REAL SlotCore, the REAL plugin bundle, and a
 * termination probe.
 *
 * The offline suite models the slot system, so it cannot see a wiring that loops
 * inside it. This test removes the model: it loads `SlotCore` from the installed
 * DSH runtime, declares `conversation.input.model` the way the composer bar does,
 * runs a plugin bundle's `apply()`, and then drives the microtask queue.
 *
 * A slot wiring that notifies a listener which re-registers the same key never
 * lets that queue empty, which starves the browser renderer: that is the freeze
 * this plugin once shipped. Two arms make the difference causal rather than
 * incidental:
 *
 *   fixed    - lib/client.js as it stands (claims through the declaration seam)
 *   control  - tools/control-old-wiring.js (retired: subscribe -> dispose + register)
 *
 * Usage: node tools/slot-live-test.mjs [rounds]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT, packageFile, skipReason } from "./resolve-dsh.mjs";

const rounds = Number(process.argv[2] ?? 200);

const slotsLib = packageFile("@deepseek-ai/dsh-client-ui-slots", "lib", "index.js");
if (slotsLib === undefined) {
	console.log("SKIP  " + skipReason("@deepseek-ai/dsh-client-ui-slots"));
	process.exit(0);
}
const { SlotCore } = await import(pathToFileURL(slotsLib).href);

/** Stub platform modules: the bundle's own render output is not under test here. */
function platformStubs() {
	const react = {
		createElement: (type, props, ...children) => ({ type, props, children }),
		useCallback: (fn) => fn,
		useEffect: () => {},
		useLayoutEffect: () => {},
		useMemo: (fn) => fn(),
		useRef: (value) => ({ current: value }),
		useState: (value) => [value, () => {}],
		useSyncExternalStore: (subscribe, get) => get()
	};
	return {
		react,
		"react-dom": { createPortal: (node) => node },
		"@deepseek-ai/dsh-client-ui-primitives": new Proxy(
			{},
			{ get: () => (props) => react.createElement("span", props) }
		)
	};
}

/** Load one bundle file the way the browser module table does. */
function loadBundle(path) {
	let registration;
	const windowStub = { __ModuleLoader__: { load: (value) => (registration = value) } };
	const documentStub = {
		head: { appendChild() {} },
		querySelector: () => null,
		createElement: () => ({ dataset: {}, textContent: "" }),
		addEventListener() {},
		removeEventListener() {}
	};
	new Function("window", "document", readFileSync(path, "utf8"))(windowStub, documentStub);
	if (registration === void 0) throw new Error("bundle did not register: " + path);
	const table = platformStubs();
	return registration.factory((specifier) => {
		if (!(specifier in table)) throw new Error(`unexpected require("${specifier}")`);
		return table[specifier];
	});
}

/** The services the bundles read, stubbed; the slot registry is the real thing. */
function createContext() {
	const records = { locale: [], effects: [] };
	const scope = {
		locale: {
			register(namespace) {
				records.locale.push(namespace);
				return () => {};
			},
			bind: () => (key) => key
		},
		modelDirectories: {
			directoryFor: () => ({
				store: { subscribe: () => () => {}, getSnapshot: () => ({ groups: [] }) },
				load: () => Promise.resolve(),
				select: () => Promise.resolve({ ok: true })
			})
		},
		sessions: { subagentAddress: () => void 0 },
		effect(callback) {
			const dispose = callback();
			if (dispose !== void 0) records.effects.push(dispose);
			return () => {};
		},
		inject(_services, callback) {
			callback(scope);
			return () => {};
		}
	};
	const core = new SlotCore();
	scope.slots = {
		register: (options, component) => core.register(options, component),
		subscribe: (key, fn) => core.subscribe(key, fn),
		subscribeDeclaration: (key, fn) => core.subscribeDeclaration(key, fn),
		getVersion: (key) => core.getVersion(key)
	};
	return { scope, core, records };
}

/**
 * Declare the seat the way the composer-bar entry does, run one bundle, then drive
 * the microtask queue until it empties (or the round budget is spent).
 */
async function runArm(label, bundlePath) {
	const bundle = loadBundle(bundlePath);
	const { scope, core, records } = createContext();

	// SlotCore ships a built-in 'root' cell, so an occupant there is how a real
	// tree declares its child keys.
	const disposeDeclaration = core.register(
		{ name: "root", children: { "conversation.input.model": { kind: "single", scope: "session" } } },
		() => null
	);
	// The shipped ModelSelect equivalent: same cell, default priority.
	const disposeShipped = core.register({ name: "conversation.input.model", locale: "model" }, () => null);

	bundle.apply(scope);

	let round = 0;
	while (round < rounds && core.dirty.size > 0) {
		round += 1;
		await Promise.resolve();
	}

	const occupants = core.entriesOfSlot("conversation.input.model");
	const report = {
		label,
		rounds: round,
		busy: core.dirty.size > 0,
		registered: core.entries("conversation.input.model").length,
		winner: occupants.length === 0 ? "none" : (occupants[0].options.priority ?? 0),
		localeNamespaces: records.locale.length
	};

	disposeShipped();
	disposeDeclaration();
	return report;
}

const fixed = await runArm("fixed (declaration seam)", join(PACKAGE_ROOT, "lib", "client.js"));
const control = await runArm("control (retired wiring)", join(PACKAGE_ROOT, "tools", "control-old-wiring.js"));

console.log("arm                              rounds  queue-busy  entries  winner-priority");
for (const arm of [fixed, control]) {
	console.log(
		`${arm.label.padEnd(32)} ${String(arm.rounds).padStart(6)}  ${String(arm.busy).padEnd(10)} ` +
			`${String(arm.registered).padStart(7)}  ${String(arm.winner).padStart(15)}`
	);
}

// The cell legitimately holds two entries at different priorities (the shipped
// ModelSelect at 0 and this seat at -1); the winner is the lowest priority, which
// is what lets the plugin shadow the shipped control without replacing it.
const ok = fixed.busy === false && fixed.registered === 2 && fixed.winner === -1 && control.busy === true;
console.log("");
console.log(
	`fixed   : ${fixed.busy ? "STILL BUSY (wiring still loops)" : "settled"} after ${fixed.rounds} round(s); ` +
		`cell entries = ${fixed.registered}; winner priority = ${fixed.winner}`
);
console.log(
	`control : ${control.busy ? "never settles (reproduces the freeze)" : "settled unexpectedly"} ` +
		`after ${control.rounds} round(s)`
);
console.log(
	ok
		? "\nslot-live-test: ok - the fix terminates against the real SlotCore, and the retired wiring does not"
		: "\nslot-live-test: UNEXPECTED"
);
process.exit(ok ? 0 : 1);
