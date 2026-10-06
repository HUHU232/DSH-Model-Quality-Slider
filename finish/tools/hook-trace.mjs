/**
 * Hook-order trace: a deliberately dumb harness that counts every React hook the
 * bundle's seat component calls. Kept as a diagnostic because it pins the seat's
 * hook ORDER — a React contract that a conditional hook would break.
 *
 * Run: node tools/hook-trace.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

const calls = [];
let createElementCalls = 0;

const react = {
	createElement: (type, props, ...children) => {
		createElementCalls += 1;
		return { type, props: { ...(props ?? {}), children } };
	},
	useState(initial) {
		calls.push("useState");
		return [initial, () => {}];
	},
	useRef(initial) {
		calls.push("useRef");
		return { current: initial };
	},
	useMemo(factory) {
		calls.push("useMemo");
		return factory();
	},
	useCallback(fn) {
		calls.push("useCallback");
		return fn;
	},
	useEffect() {
		calls.push("useEffect");
	},
	useLayoutEffect() {
		calls.push("useLayoutEffect");
	},
	useSyncExternalStore(_subscribe, getSnapshot) {
		calls.push("useSyncExternalStore");
		return getSnapshot();
	}
};

globalThis.document = {
	head: { appendChild() {} },
	body: {},
	createElement: () => ({ dataset: {}, style: {} }),
	querySelector: () => null,
	addEventListener() {},
	removeEventListener() {}
};

let registration;
globalThis.window = {
	innerWidth: 1440,
	innerHeight: 900,
	setTimeout: (fn) => fn(),
	addEventListener() {},
	removeEventListener() {},
	__ModuleLoader__: {
		load(value) {
			registration = value;
		}
	}
};

new Function("window", "document", source)(globalThis.window, globalThis.document);

const bundle = registration.factory((specifier) => {
	if (specifier === "react") return react;
	if (specifier === "react-dom") return { createPortal: (node) => node };
	if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
		return new Proxy({}, { get: () => () => null });
	}
	throw new Error("unexpected require: " + specifier);
});

let seat;
bundle.apply({
	locale: { register: () => () => {}, bind: () => (key) => key },
	slots: {
		inject(_key, callback) {
			callback();
		},
		register(_options, component) {
			seat = component;
			return () => {};
		}
	},
	remote: {
		session: {
			modelCatalog: () => ({ then: () => {} }),
			selectModel: () => Promise.resolve({ ok: true })
		}
	},
	sessions: {},
	effect(callback) {
		callback();
		return () => {};
	}
});

console.log("seat registered      :", typeof seat);
const element = seat({
	locked: false,
	sessionId: "s",
	useProjection: () => undefined,
	t: (key) => key
});
console.log("createElement calls  :", createElementCalls);
console.log(
	"element type         :",
	element === null || element === void 0
		? String(element)
		: typeof element.type === "function"
			? element.type.name
			: String(element.type)
);
console.log("element prop keys    :", element?.props ? Object.keys(element.props).join(",") : "none");

// Materialize one level: the element the seat produced is the component under
// test, so render it directly with the same props the slot would hand it.
if (element !== null && element !== void 0 && typeof element.type === "function") {
	const inner = element.type({
		...element.props,
		children: void 0
	});
	console.log(
		"rendered root        :",
		inner === null || inner === void 0 ? String(inner) : String(inner.type)
	);
}

console.log("hook calls           :", calls.length);
console.log(calls.map((name, index) => `  ${index + 1}. ${name}`).join("\n"));
