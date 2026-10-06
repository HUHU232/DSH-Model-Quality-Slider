/**
 * End-to-end verification of the reasoning-slider fix against a live host.
 *
 * Three independent signals, because the previous failure was invisible to the
 * offline suite:
 *
 *   1. HTTP: the host's index carries a boot-graph row for the plugin, and the
 *      plugin's bundle is served from /plugins.
 *   2. BUNDLE: the served bytes claim the seat through `slots.inject` and contain
 *      no `slots.subscribe(...)` call back into the claim (the freeze edge).
 *   3. BROWSER: a headless page renders the seat with OUR trigger markup and
 *      without the shipped ModelSelect, and answers a post-load DOM probe at all
 *      - a microtask-starved renderer never replies, which is how the freeze
 *      presents.
 *
 * Usage: node tools/verify-live.mjs <gui-url-with-token>
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const guiUrl = process.argv[2];
if (guiUrl === void 0) {
	console.error("usage: node tools/verify-live.mjs <gui-url-with-token>");
	process.exit(2);
}
const origin = new URL(guiUrl).origin;
const token = new URL(guiUrl).searchParams.get("token") ?? "";
const cookie = { Cookie: `dsh_token=${token}` };

const failures = [];
const check = (label, ok, detail) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === void 0 ? "" : "  <- " + detail}`);
	if (!ok) failures.push(label);
};

// ── 1. HTTP surface ──────────────────────────────────────────────────────────
// The GUI fences every request: the browser carries `dsh_token` as a cookie, so
// the raw fetch must present the same thing or it only sees the redirect.
const indexResponse = await fetch(guiUrl, { headers: cookie, redirect: "manual" });
const index = await indexResponse.text();
check(
	"index served with the session cookie",
	indexResponse.status === 200 && index.length > 1000,
	`status ${indexResponse.status}, ${index.length} bytes`
);

const row = /"id":"dsh-reasoning-slider"[^}]*/.exec(index);
check("boot graph has the plugin row", row !== null, row === null ? "row absent" : row[0].slice(0, 90));

let bundleText = "";
if (row !== null) {
	const url = /"url":"([^"]+)"/.exec(row[0])?.[1];
	if (url !== void 0) {
		const response = await fetch(`${origin}/${url}`, { headers: cookie });
		bundleText = await response.text();
		check("plugin bundle served", response.status === 200 && bundleText.length > 1000,
			`status ${response.status}, ${bundleText.length} bytes`);
	}
}

// ── 2. bundle wiring ─────────────────────────────────────────────────────────
check("claims the seat via slots.inject", /slots\.inject\(/.test(bundleText) || /\.inject\("conversation\.input\.model"/.test(bundleText));
const subscribes = [...bundleText.matchAll(/slots\.subscribe\(([^)]*)/g)].map((m) => m[0]);
check(
	"no change-stream subscription on the seat key",
	!/\.subscribe\(\s*"conversation\.input\.model"/.test(bundleText),
	subscribes.length === 0 ? "no slots.subscribe at all" : subscribes.join(" | ").slice(0, 120)
);
check("seat priority is -1", /priority:\s*-1/.test(bundleText));

// ── 3. browser render, with freeze detection ─────────────────────────────────
// Any Chromium with the DevTools protocol works; override with BROWSER_BIN when
// Edge is not on PATH (Chrome, Chromium, or an Edge in another location).
const edge =
	process.env.BROWSER_BIN ??
	(process.platform === "win32"
		? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
		: "/usr/bin/chromium");
const port = 9411;
const profile = mkdtempSync(join(tmpdir(), "dsh-verify-edge-"));
const browser = spawn(
	edge,
	[
		"--headless=new",
		"--disable-gpu",
		"--no-first-run",
		"--no-default-browser-check",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profile}`,
		"--window-size=1280,900",
		"about:blank"
	],
	{ stdio: "ignore" }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The /json/version reply is the readiness signal; /json/list needs a retry. */
let ready = false;
for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
	await sleep(500);
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`);
		ready = response.ok;
	} catch {
		// endpoint not up yet
	}
}
check("browser DevTools endpoint", ready, ready ? "up" : "never came up");

let page = null;
for (let attempt = 0; attempt < 20 && page === null; attempt += 1) {
	try {
		const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
		page = list.find((entry) => entry.type === "page") ?? null;
	} catch {
		// transient
	}
	if (page === null) await sleep(400);
}

if (page === null) {
	check("browser page target", false, "none exposed");
} else {
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
	/** Evaluate with a hard deadline: a starved renderer never answers. */
	const probe = async (expression, timeoutMs = 8000) => {
		const race = await Promise.race([
			send("Runtime.evaluate", { expression, returnByValue: true }),
			sleep(timeoutMs).then(() => "TIMEOUT")
		]);
		if (race === "TIMEOUT") return { timedOut: true };
		return { value: race.result?.result?.value, raw: race.result };
	};

	await send("Runtime.enable");
	await send("Page.enable");
	await send("Network.enable");
	// The GUI's fence accepts the session token as a cookie; set it before the
	// document loads so the shell is served rather than redirected.
	await send("Network.setCookie", {
		name: "dsh_token",
		value: token,
		domain: "127.0.0.1",
		path: "/"
	});
	await send("Page.navigate", { url: guiUrl });
	await sleep(8000); // boot the shell, mount the composer, render the seat

	const alive = await probe("1+1", 8000);
	check("renderer answers after boot (no freeze)", alive.value === 2, alive.timedOut ? "no reply within 8s" : `value ${alive.value}`);

	const markup = await probe(
		`JSON.stringify({
			seat: document.querySelectorAll('[data-slot="conversation.input.model"]').length,
			ourTrigger: document.querySelectorAll('.dshrs-trigger').length,
			slider: document.querySelectorAll('.dshrs-slider').length,
			shipped: document.querySelectorAll('[class*="_7KE1Ra_trigger"]').length,
			css: document.querySelectorAll('style[data-plugin="dsh-reasoning-slider"]').length,
			slotErrors: document.querySelectorAll('[data-slot-error]').length,
			text: (document.querySelector('.dshrs-trigger')||{}).textContent || null
		})`,
		8000
	);

	if (markup.timedOut === true) {
		check("seat markup probe", false, "renderer starved");
	} else {
		const seen = JSON.parse(markup.value ?? "{}");
		console.log("      page state:", JSON.stringify(seen));
		check("plugin CSS injected", seen.css === 1);
		check("our trigger rendered", seen.ourTrigger === 1, `found ${seen.ourTrigger}`);
		check("shipped ModelSelect not rendering", seen.shipped === 0, `found ${seen.shipped}`);
		check("no slot error face", seen.slotErrors === 0, `found ${seen.slotErrors}`);
	}

	// The regression itself: with the old wiring this loop would never settle.
	const settle = await probe(
		`new Promise((resolve) => {
			let ticks = 0;
			const step = () => { ticks += 1; if (ticks >= 5) resolve(ticks); else setTimeout(step, 0); };
			setTimeout(step, 0);
		})`,
		8000
	);
	check("event loop still serves timers", settle.value === 5, settle.timedOut ? "timers starved" : `ticks ${settle.value}`);

	const shot = await send("Page.captureScreenshot", { format: "png" });
	if (shot.result?.data !== void 0) {
		writeFileSync("tools/gui-verify.png", Buffer.from(shot.result.data, "base64"));
		console.log("      screenshot: tools/gui-verify.png");
	}
	socket.close();
}

browser.kill();
await sleep(400);
console.log(failures.length === 0 ? "\nverify-live: ALL GREEN" : `\nverify-live: ${failures.length} FAILED -> ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
