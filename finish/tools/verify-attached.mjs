/**
 * Browser verification against an ALREADY RUNNING headless Edge.
 *
 * Edge is launched outside this script (Node's child_process cannot bring it up
 * under the Windows sandbox), and this script is only the CDP client: it attaches
 * to the page target, installs the GUI session cookie, navigates, and probes.
 *
 * The probes are the freeze regression: a live renderer answers `1+1` and serves
 * timers after boot, while a microtask-starved one answers nothing at all.
 *
 * Usage: node tools/verify-attached.mjs <gui-url-with-token> [debug-port]
 */
const guiUrl = process.argv[2];
const port = Number(process.argv[3] ?? 9411);
if (guiUrl === void 0) {
	console.error("usage: node tools/verify-attached.mjs <gui-url-with-token> [port]");
	process.exit(2);
}
const token = new URL(guiUrl).searchParams.get("token") ?? "";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
const check = (label, ok, detail) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === void 0 ? "" : "  <- " + detail}`);
	if (!ok) failures.push(label);
};

let page = null;
for (let attempt = 0; attempt < 20 && page === null; attempt += 1) {
	try {
		const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
		page = list.find((entry) => entry.type === "page") ?? null;
	} catch {
		// endpoint warming up
	}
	if (page === null) await sleep(400);
}
check("attached to a page target", page !== null);
if (page === null) process.exit(1);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	socket.addEventListener("open", resolve, { once: true });
	socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
	const message = JSON.parse(String(event.data));
	if (message.id === void 0) return;
	const entry = pending.get(message.id);
	pending.delete(message.id);
	entry?.(message);
});
const send = (method, params = {}) => {
	const id = nextId++;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise((resolve) => pending.set(id, resolve));
};
/** Evaluate with a hard deadline: a starved renderer never replies. */
const probe = async (expression, timeoutMs = 8000) => {
	const race = await Promise.race([
		send("Runtime.evaluate", { expression, returnByValue: true }),
		sleep(timeoutMs).then(() => "TIMEOUT")
	]);
	if (race === "TIMEOUT") return { timedOut: true };
	return { value: race.result?.result?.value };
};

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Network.setCookie", { name: "dsh_token", value: token, domain: "127.0.0.1", path: "/" });
await send("Page.navigate", { url: guiUrl });
await sleep(9000);

const alive = await probe("1+1", 8000);
check("renderer answers after boot (no freeze)", alive.value === 2, alive.timedOut ? "no reply within 8s" : `1+1=${alive.value}`);

const state = await probe(
	`JSON.stringify({
		seat: document.querySelectorAll('[data-slot="conversation.input.model"]').length,
		ourTrigger: document.querySelectorAll('.dshrs-trigger').length,
		sliderInTrigger: document.querySelectorAll('.dshrs-trigger').length,
		shipped: document.querySelectorAll('[class*="_7KE1Ra_trigger"]').length,
		css: document.querySelectorAll('style[data-plugin="dsh-reasoning-slider"]').length,
		slotErrors: document.querySelectorAll('[data-slot-error]').length,
		text: (document.querySelector('.dshrs-trigger')||{}).textContent || null
	})`,
	8000
);

if (state.timedOut === true) {
	check("page state probe", false, "renderer starved");
} else {
	const seen = JSON.parse(state.value ?? "{}");
	console.log("      page state:", JSON.stringify(seen));
	check("plugin CSS injected", seen.css === 1, `style tags: ${seen.css}`);
	check("our trigger rendered in the seat", seen.ourTrigger === 1, `found ${seen.ourTrigger}`);
	check("shipped ModelSelect not rendering", seen.shipped === 0, `found ${seen.shipped}`);
	check("no slot error face", seen.slotErrors === 0, `found ${seen.slotErrors}`);
}

const settle = await probe(
	`new Promise((resolve) => { let n = 0; const step = () => { n += 1; if (n >= 5) resolve(n); else setTimeout(step, 0); }; setTimeout(step, 0); })`,
	8000
);
check("event loop still serves timers", settle.value === 5, settle.timedOut ? "timers starved" : `ticks ${settle.value}`);

// Open the popup and confirm the slider itself renders.
const opened = await probe(
	`(() => {
		const trigger = document.querySelector('.dshrs-trigger');
		if (trigger === null) return JSON.stringify({ opened: false });
		trigger.click();
		return JSON.stringify({
			opened: true,
			menu: document.querySelectorAll('[data-dsh-reasoning-slider-menu="true"]').length
		});
	})()`,
	8000
);
if (opened.timedOut !== true) {
	console.log("      popup click:", opened.value);
	await sleep(1200);
	const popup = await probe(
		`JSON.stringify({
			slider: document.querySelectorAll('.dshrs-slider').length,
			track: document.querySelectorAll('.dshrs-track').length,
			fill: document.querySelectorAll('.dshrs-fill').length,
			knob: document.querySelectorAll('.dshrs-knob').length,
			ticks: document.querySelectorAll('.dshrs-tick').length,
			sparks: document.querySelectorAll('.dshrs-spark').length,
			value: document.querySelector('.dshrs-panelValue')?.textContent ?? null
		})`,
		8000
	);
	if (popup.timedOut === true) {
		check("popup probe", false, "renderer starved after opening the popup");
	} else {
		const seen = JSON.parse(popup.value ?? "{}");
		console.log("      popup state:", JSON.stringify(seen));
		check("slider rendered", seen.slider === 1, `sliders: ${seen.slider}`);
		check("gradient track + glow fill", seen.track === 1 && seen.fill === 1);
		check("knob rendered", seen.knob === 1);
		check("one tick per level", seen.ticks >= 2, `ticks: ${seen.ticks}`);
		check("twinkling sparkles inside the fill", seen.sparks > 0, `sparkles: ${seen.sparks}`);
	}
}

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data !== void 0) {
	const { writeFileSync } = await import("node:fs");
	writeFileSync("tools/gui-verify.png", Buffer.from(shot.result.data, "base64"));
	console.log("      screenshot: tools/gui-verify.png");
}

socket.close();
console.log(failures.length === 0 ? "\nverify-attached: ALL GREEN" : `\nverify-attached: ${failures.length} FAILED -> ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
