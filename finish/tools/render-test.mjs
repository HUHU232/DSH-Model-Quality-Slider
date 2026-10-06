/**
 * Structural render test for the dsh-reasoning-slider seat (0.2.0-rc.x contract).
 *
 * No React install is required: this file ships a small hook runtime (single
 * fiber, sequential hook slots), a DOM-free element expander, and stub
 * primitives, then renders the seat from the REAL bundle against a fake
 * `ModelDirectory` store. It asserts the observable structure and drives the
 * slider end to end:
 *
 *   1. the collapsed trigger shows the model name and the current effort;
 *   2. opening it renders the effort panel with the gradient track, the
 *      twinkling sparkles, one tick per level, and the knob at the active level;
 *   3. pressing the track at ~87% of its width previews the last level and
 *      releasing submits exactly one selection carrying that effort;
 *   4. the model row switches to the provider-grouped picker, and a model press
 *      submits the selection with that model's own default effort;
 *   5. a selection outside the catalog (stale provider/model) falls back to a row
 *      that actually has levels, so the slider is never dead.
 *
 * Run: node tools/render-test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// ── hook runtime ─────────────────────────────────────────────────────────────
const hooks = [];
let cursor = 0;
let pendingEffects = [];
let seat = null;
let seatProps = null;

const react = {
	createElement: (type, props, ...children) => ({
		type,
		props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children }
	}),
	useState(initial) {
		const slot = cursor++;
		if (!(slot in hooks)) {
			hooks[slot] = { value: typeof initial === "function" ? initial() : initial };
		}
		const set = (next) => {
			const value = typeof next === "function" ? next(hooks[slot].value) : next;
			if (Object.is(value, hooks[slot].value)) return;
			hooks[slot] = { value };
			scheduleRender();
		};
		return [hooks[slot].value, set];
	},
	useRef(initial) {
		const slot = cursor++;
		if (!(slot in hooks)) hooks[slot] = { ref: { current: initial } };
		return hooks[slot].ref;
	},
	useMemo(factory, deps) {
		const slot = cursor++;
		const next = deps ?? [];
		const previous = hooks[slot] === void 0 ? void 0 : hooks[slot].deps;
		const changed =
			previous === void 0 ||
			previous.length !== next.length ||
			next.some((value, index) => !Object.is(value, previous[index]));
		if (changed) hooks[slot] = { value: factory(), deps: next };
		return hooks[slot].value;
	},
	useCallback(fn, deps) {
		const slot = cursor++;
		const next = deps ?? [];
		const previous = hooks[slot] === void 0 ? void 0 : hooks[slot].deps;
		const changed =
			previous === void 0 ||
			previous.length !== next.length ||
			next.some((value, index) => !Object.is(value, previous[index]));
		if (changed) hooks[slot] = { value: fn, deps: next };
		return hooks[slot].value;
	},
	useEffect(fn) {
		const slot = cursor++;
		hooks[slot] = { fn };
		pendingEffects.push(hooks[slot]);
	},
	useLayoutEffect(fn) {
		react.useEffect(fn);
	},
	useSyncExternalStore(subscribe, getSnapshot) {
		cursor++;
		return getSnapshot();
	}
};

/**
 * Materialize one element tree the way a renderer would: function components run
 * (so their hooks fire), host elements pass through with expanded children, and
 * any `ref` prop is attached - a renderer attaches refs before effects run, and
 * the popup anchor depends on exactly that ordering.
 */
function expand(node) {
	if (node === null || node === void 0 || typeof node === "boolean") return node;
	if (typeof node === "string" || typeof node === "number") return node;
	if (Array.isArray(node)) return node.map(expand);
	if (typeof node.type === "function") return expand(node.type({ ...node.props, children: void 0 }));
	const children = node.props?.children;
	const expanded = {
		type: node.type,
		props: { ...node.props, children: children === void 0 ? children : expand(children) }
	};
	const ref = node.props?.ref;
	if (ref !== null && ref !== void 0 && typeof ref === "object") ref.current = makeNode(String(node.type));
	return expanded;
}

function render() {
	cursor = 0;
	pendingEffects = [];
	const tree = expand(seat(seatProps));
	for (const effect of pendingEffects) effect.fn();
	return tree;
}

/**
 * A renderer schedules a state update rather than re-entering the component, and
 * drains the queue until the tree stops changing. Mirroring that here keeps the
 * harness from recursing into itself when an effect writes state.
 */
let draining = false;
let queued = false;
function scheduleRender() {
	queued = true;
	if (draining) return;
	draining = true;
	try {
		while (queued) {
			queued = false;
			render();
		}
	} finally {
		draining = false;
	}
}

/** Render and settle every state update the render itself schedules. */
function settle() {
	const tree = render();
	if (queued) {
		scheduleRender();
		return render();
	}
	return tree;
}

// ── browser stubs ────────────────────────────────────────────────────────────
const windowListeners = new Map();
const nodeRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

function makeNode(tag) {
	return {
		tag,
		dataset: {},
		textContent: "",
		children: [],
		style: {},
		className: "",
		clientWidth: 240,
		clientHeight: 26,
		appendChild(child) {
			this.children.push(child);
		},
		contains(candidate) {
			return candidate === this || this.children.includes(candidate);
		},
		closest() {
			return null;
		},
		focus() {},
		querySelector() {
			return null;
		},
		getBoundingClientRect() {
			return { ...nodeRect };
		},
		addEventListener() {},
		removeEventListener() {}
	};
}

globalThis.document = {
	head: { appendChild() {} },
	body: makeNode("body"),
	createElement: makeNode,
	querySelector: () => null,
	addEventListener() {},
	removeEventListener() {}
};

globalThis.window = {
	innerWidth: 1440,
	innerHeight: 900,
	setTimeout: (fn) => fn(),
	addEventListener(type, fn) {
		if (!windowListeners.has(type)) windowListeners.set(type, []);
		windowListeners.get(type).push(fn);
	},
	removeEventListener(type, fn) {
		const list = windowListeners.get(type);
		if (list === void 0) return;
		windowListeners.set(type, list.filter((entry) => entry !== fn));
	}
};

/** One synchronous measure pass, standing in for the browser's ResizeObserver. */
globalThis.ResizeObserver = class {
	constructor(callback) {
		this.callback = callback;
	}
	observe() {
		this.callback();
	}
	disconnect() {}
};

// ── bundle + stubs ───────────────────────────────────────────────────────────
let registration;
globalThis.window.__ModuleLoader__ = {
	load(value) {
		registration = value;
	}
};

const iconsSeen = new Set();
const primitives = new Proxy(
	{},
	{
		// A real icon component: renders one host node, and records the name so the
		// test can pin which icons the seat actually reached for.
		get: (_target, name) => (props) => {
			iconsSeen.add(String(name));
			return react.createElement("span", { "data-icon": String(name), ...props });
		}
	}
);

new Function("window", "document", source)(globalThis.window, globalThis.document);

const bundle = registration.factory((specifier) => {
	if (specifier === "react") return react;
	if (specifier === "react-dom") return { createPortal: (node) => node };
	if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error("unexpected require: " + specifier);
});

// ── the fake per-session model directory ─────────────────────────────────────
const catalog = {
	groups: [
		{
			id: "deepseek-official",
			name: "DeepSeek",
			models: [
				{
					id: "deepseek-v4-flash",
					name: "DeepSeek-V41-Flash",
					reasoning: {
						defaultEffort: "high",
						efforts: [
							{ id: "low", name: "Low" },
							{ id: "medium", name: "Medium" },
							{ id: "high", name: "High" },
							{ id: "max", name: "Max" }
						]
					}
				},
				{
					id: "deepseek-v4-pro",
					name: "DeepSeek-V41-Pro",
					reasoning: { defaultEffort: "medium", efforts: [{ id: "medium", name: "Medium" }] }
				}
			]
		},
		{ id: "other-provider", name: "Other", models: [{ id: "m1", name: "Model One" }] }
	],
	failures: []
};

/** Snapshot store double with the four methods the seat uses. */
function createStore(initial) {
	let snapshot = initial;
	const listeners = new Set();
	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		set(next) {
			snapshot = next;
			for (const listener of [...listeners]) listener();
		},
		update(mutate) {
			const draft = { ...snapshot };
			mutate(draft);
			snapshot = draft;
			for (const listener of [...listeners]) listener();
		}
	};
}

const directoryStore = createStore({
	current: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
	routable: true,
	groups: catalog.groups,
	failures: catalog.failures,
	status: "ready",
	pending: null,
	error: null
});

const selectCalls = [];
const loadCalls = [];
const fakeDirectory = {
	store: directoryStore,
	load: () => {
		loadCalls.push(true);
		return Promise.resolve(directoryStore.getSnapshot());
	},
	select: (selection) => {
		selectCalls.push(selection);
		return Promise.resolve({ ok: true, value: void 0 });
	}
};

const localeRegistrations = [];
const ctx = {
	locale: {
		register(namespace, dictionaries) {
			localeRegistrations.push({ namespace, dictionaries });
			return () => {};
		},
		bind: () => (key) => key
	},
	slots: {
		inject(_key, callback) {
			callback();
			return () => {};
		},
		register(_options, component) {
			seat = component;
			return () => {};
		}
	},
	modelDirectories: { directoryFor: () => fakeDirectory },
	sessions: { subagentAddress: () => void 0 },
	effect(callback) {
		callback();
		return () => {};
	},
	// Present so the bundle's `ctx.inject([...], cb)` form has an implementation.
	inject(_services, callback) {
		callback(ctx);
		return () => {};
	}
};

bundle.apply(ctx);
assert.equal(typeof seat, "function", "apply must register the seat component");

// ── dictionaries ─────────────────────────────────────────────────────────────
assert.deepEqual(localeRegistrations.map((row) => row.namespace), ["reasoning-slider"]);
const dictionaries = localeRegistrations[0].dictionaries;
assert.ok(dictionaries.zh !== void 0 && dictionaries.en !== void 0, "both locales required");
assert.deepEqual(
	Object.keys(dictionaries.zh).sort(),
	Object.keys(dictionaries.en).sort(),
	"zh and en key sets must match"
);

// ── render ───────────────────────────────────────────────────────────────────
seatProps = {
	locked: false,
	available: true,
	directory: directoryStore,
	load: fakeDirectory.load,
	select: fakeDirectory.select,
	t: (key) => key
};

const tree = settle();

// ── tree helpers ─────────────────────────────────────────────────────────────
function collect(node, predicate, found = []) {
	if (Array.isArray(node)) {
		for (const child of node) collect(child, predicate, found);
		return found;
	}
	if (typeof node === "string" || typeof node === "number") {
		if (predicate(node)) found.push(node);
		return found;
	}
	if (node === null || node === void 0 || typeof node !== "object") return found;
	if (predicate(node)) found.push(node);
	if (node.props !== void 0) collect(node.props.children, predicate, found);
	return found;
}

const classesOf = (node) =>
	typeof node.props?.className === "string" ? node.props.className.split(/\s+/) : [];
const byClass = (root, name) => collect(root, (node) => classesOf(node).includes(name));
const texts = (node) => collect(node, (child) => typeof child === "string");

// ── 1. collapsed trigger ─────────────────────────────────────────────────────
const trigger = byClass(tree, "dshrs-trigger");
assert.equal(trigger.length, 1, "exactly one trigger button");
assert.equal(trigger[0].type, "button");
assert.equal(trigger[0].props.disabled, false);
const triggerText = collect(tree, (node) => node.props?.className === "dshrs-triggerText");
assert.ok(
	texts(triggerText).includes("DeepSeek-V41-Flash"),
	"the trigger must show the model name, got " + JSON.stringify(texts(triggerText))
);
assert.ok(
	texts(triggerText).includes("High"),
	"the trigger must show the current effort, got " + JSON.stringify(texts(triggerText))
);
assert.equal(byClass(tree, "dshrs-menu").length, 0, "the popup starts closed");
assert.ok(iconsSeen.has("IconGaugeOutlineRegular"), "the trigger must use the gauge icon");

// ── 2. open the popup ────────────────────────────────────────────────────────
trigger[0].props.onClick();
const opened = settle();

assert.equal(byClass(opened, "dshrs-menu").length, 1, "opening the trigger portals the popup card");
assert.equal(byClass(opened, "dshrs-menu")[0].props["data-dsh-reasoning-slider-menu"], "true");
assert.equal(loadCalls.length, 1, "opening the popup refreshes the directory once");

const slider = byClass(opened, "dshrs-slider");
assert.equal(slider.length, 1, "the root view renders exactly one slider");
assert.equal(slider[0].props.role, "slider");
assert.equal(slider[0].props["aria-valuemin"], 1);
assert.equal(slider[0].props["aria-valuemax"], 4);
assert.equal(slider[0].props["aria-valuenow"], 3, "four levels with 'high' active means position 3");
assert.equal(slider[0].props["aria-valuetext"], "High");

assert.equal(byClass(opened, "dshrs-track").length, 1, "the slider carries the gradient track");
assert.equal(byClass(opened, "dshrs-fill").length, 1, "the track carries the gradient fill");
assert.equal(byClass(opened, "dshrs-knob").length, 1, "the track carries the knob");
assert.equal(byClass(opened, "dshrs-tick").length, 4, "one tick per advertised level");
assert.equal(byClass(opened, "dshrs-tickActive").length, 3, "ticks up to the active level are lit");
assert.ok(byClass(opened, "dshrs-spark").length > 0, "the fill carries twinkling sparkles");
assert.ok(iconsSeen.has("IconSparkleRegular"), "the sparkles must use the sparkle icon");
assert.ok(
	texts(byClass(opened, "dshrs-panelValue")).includes("High"),
	"the panel header names the active level"
);

// ── 3. drag to the far right and release ─────────────────────────────────────
Object.assign(nodeRect, { left: 0, top: 0, right: 240, bottom: 26, width: 240, height: 26 });

slider[0].props.onPointerDown({ button: 0, clientX: 8, preventDefault() {} });
assert.equal(
	(windowListeners.get("pointermove") ?? []).length,
	1,
	"a drag installs exactly one move listener"
);
for (const listener of windowListeners.get("pointermove") ?? []) listener({ clientX: 210 });
const dragged = settle();
assert.equal(
	byClass(dragged, "dshrs-slider")[0].props["aria-valuenow"],
	4,
	"dragging to ~87% previews the last level"
);
assert.equal(
	byClass(dragged, "dshrs-slider")[0].props["data-dragging"],
	"true",
	"the slider reports the drag state"
);
for (const listener of windowListeners.get("pointerup") ?? []) listener({ clientX: 210 });

assert.equal(selectCalls.length, 1, "releasing the drag submits exactly one selection");
assert.deepEqual(
	selectCalls[0],
	{ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
	"the submitted selection keeps the model and carries the dragged effort"
);

// ── 4. the model row opens the provider-grouped picker ───────────────────────
const afterDrag = settle();
const modelRow = byClass(afterDrag, "dshrs-row");
assert.equal(modelRow.length, 1, "the root view renders the model row");
modelRow[0].props.onClick();
const picker = settle();

assert.equal(byClass(picker, "dshrs-slider").length, 0, "the picker replaces the effort panel");
assert.equal(byClass(picker, "dshrs-option").length, 3, "one option per catalog model");
assert.equal(byClass(picker, "dshrs-groupTitle").length, 2, "one heading per provider group");
assert.equal(byClass(picker, "dshrs-optionCheck").length, 1, "exactly the selected model is checked");

byClass(picker, "dshrs-option")[1].props.onClick();
assert.equal(selectCalls.length, 2, "picking another model submits once");
assert.deepEqual(
	selectCalls[1],
	{
		provider: "deepseek-official",
		model: "deepseek-v4-pro",
		reasoningEffort: "medium"
	},
	"picking a model submits that model's own default effort"
);

// ── 5. a stale selection still leaves a working control ──────────────────────
directoryStore.update((draft) => {
	draft.current = { provider: "retired-provider", model: "gone" };
	draft.retainedEffort = "max";
	draft.status = "ready";
});
const stale = settle();
assert.equal(
	texts(collect(stale, (node) => node.props?.className === "dshrs-triggerText")).includes(
		"DeepSeek-V41-Flash"
	),
	true,
	"a selection missing from the catalog falls back to a row that has levels"
);
assert.equal(
	byClass(stale, "dshrs-slider").length,
	1,
	"the fallback row still renders a live slider instead of a dead panel"
);
assert.equal(selectCalls.length, 2, "reading the fallback must not submit anything by itself");

console.log("render-test: ok");
console.log("  trigger : DeepSeek-V41-Flash . High");
console.log("  slider  : 4 levels / aria-valuenow 3 -> drag -> max");
console.log("  submit  :", JSON.stringify(selectCalls[0]));
console.log("  picker  : 3 options across 2 provider groups");
console.log("  fallback: stale selection resolved to a row with levels");
