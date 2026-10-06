/**
 * Control arm for the freeze regression test.
 *
 * This is the wiring this package USED TO ship, reconstructed minimally so the
 * real `SlotCore` can be pointed at it. It is never loaded by any host: nothing
 * declares it, and its registration id (`dsh-reasoning-slider-control`) is not a
 * package in this repo. Its only consumer is `tools/slot-live-test.mjs`.
 *
 * The defect, in one line: it subscribes to the seat key's CHANGE stream and its
 * listener disposes + re-registers the seat, so every notification schedules the
 * next one - an unbounded microtask loop that starves the browser renderer.
 * `lib/client.js` claims the seat through the declaration seam instead.
 */
window.__ModuleLoader__.load({
	id: "dsh-reasoning-slider-control",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const react = require("react");

		function apply(ctx) {
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const models = scope.modelDirectories;
				const sessions = scope.sessions;
				let live;
				const claim = () => {
					if (typeof scope.slots.register !== "function") return;
					if (live !== void 0) {
						live();
						live = void 0;
					}
					const options = {
						name: "conversation.input.model",
						locale: "reasoning-slider",
						priority: -1,
						inject: (sessionId) => {
							const directory = models.directoryFor(sessionId);
							const available = sessions.subagentAddress(sessionId) === void 0;
							return {
								available,
								directory: directory.store,
								load: () => {
									if (available) directory.load().catch(() => {});
								},
								select: (selection) =>
									available ? directory.select(selection) : Promise.resolve(void 0)
							};
						}
					};
					const component = () => react.createElement("div", null, "seat");
					try {
						live = scope.slots.register(options, component);
					} catch (error) {
						live = void 0;
					}
				};
				claim();
				scope.effect(
					() => {
						if (typeof scope.slots.subscribe !== "function") return () => {};
						return scope.slots.subscribe("conversation.input.model", claim);
					},
					"control: seat declaration"
				);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots", "locale", "modelDirectories", "sessions", "remote", "remote.session"];
		return module.exports;
	}
});
