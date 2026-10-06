/**
 * Reproduction of the reasoning-slider freeze, WITHOUT the real slot system.
 *
 * Two SlotCore behaviours are all that matter, both read off the shipped source:
 *
 *   1. `subscribe(key, fn)` is notified from `flush()`, which runs as a
 *      **microtask**: `flushScheduled = false; const dirty = [...this.dirty];
 *      this.dirty.clear(); for (const rec of dirty) for (const fn of [...rec.listeners]) fn();`
 *   2. every `register(...)` and every registration disposer calls `markDirty`,
 *      which schedules the next flush.
 *
 * The retired plugin registered the seat on the same key whose change stream it
 * subscribed to, and its disposer ran first on every call - so each notification
 * disposed and re-registered, and each re-registration scheduled the next
 * notification. This script replays that wiring against a small model of those
 * two behaviours and drives the microtask queue deterministically.
 *
 * Usage: node tools/freeze-repro.mjs [rounds]
 */
const rounds = Number(process.argv[2] ?? 25);

/** Model of SlotCore's key record: listeners, dirty set, scheduled flush. */
function createRecord() {
	return {
		listeners: new Set(),
		dirty: new Set(),
		flushScheduled: false,
		flushes: 0,
		registrations: 0
	};
}

const record = createRecord();
const queue = [];

function markDirty() {
	record.dirty.add(record);
	if (record.flushScheduled) return;
	record.flushScheduled = true;
	queue.push(flush);
}

function subscribe(fn) {
	record.listeners.add(fn); // adding a listener does not mark dirty
}

function register() {
	record.registrations += 1;
	markDirty();
	return () => {
		record.registrations -= 1;
		markDirty(); // the real disposer also marks the record dirty
	};
}

function flush() {
	record.flushScheduled = false;
	record.flushes += 1;
	const dirty = [...record.dirty];
	record.dirty.clear();
	for (const _rec of dirty) for (const fn of [...record.listeners]) fn();
}

/** The retired wiring: claim() disposes + re-registers; subscribe() drives claim. */
let live;
const claim = () => {
	if (live !== void 0) {
		live();
		live = void 0;
	}
	live = register();
};
claim();

// Control arm: USE_SUBSCRIBE=0 keeps the identical register/dispose plumbing but
// removes the only edge that points back into claim(). If the loop needs that
// edge, this arm terminates and the other does not.
const useSubscribe = process.env.USE_SUBSCRIBE !== "0";
if (useSubscribe) subscribe(claim);
console.log("arm              :", useSubscribe ? "subscribe(claim) [as shipped]" : "no subscription [control]");

// Drive the queue the way a JS engine drains microtasks: one round = drain what
// was queued when the round started. A terminating wiring runs out of work.
let round = 0;
while (round < rounds && queue.length > 0) {
	round += 1;
	const batch = queue.splice(0, queue.length);
	for (const task of batch) task();
}

console.log("rounds run       :", round, "of", rounds);
console.log("flushes observed :", record.flushes);
console.log("registrations    :", record.registrations, "(a sane wiring holds exactly 1)");
console.log("work still queued:", queue.length);

if (queue.length > 0) {
	console.log(
		"\nVERDICT: does not terminate. Every flush disposes + re-registers the seat, and\n" +
			"every registration/disposal schedules the next flush, so the microtask queue is\n" +
			"never empty. In the browser that starves rendering and input: the page freezes."
	);
} else {
	console.log("\nVERDICT: terminated after", round, "rounds (wiring is benign)");
}
process.exit(0);
