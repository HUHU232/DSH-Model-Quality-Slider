/**
 * dsh-reasoning-slider - browser half (DSH 0.2.0-rc.x client contract).
 *
 * Replaces the shipped composer model seat (`conversation.input.model`, a
 * `single` slot): the popup card keeps the model row, but the reasoning-effort
 * row becomes a draggable slider with a glowing gradient track.
 *
 * Contract notes for this version:
 *   - the bundle registers one factory through `window.__ModuleLoader__.load`;
 *   - `require` may only name the platform module table (react, react-dom,
 *     @deepseek-ai/dsh-client-ui-primitives); this bundle needs no package row;
 *   - the shared per-session model state is the `modelDirectories` service owned
 *     by the shipped `dsh-client-ui-model-selection` host row, reached through
 *     the documented `ctx.inject(["slots", "modelDirectories"], ...)` seam, so
 *     this plugin never re-implements catalog loading or `selectModel`;
 *   - a `single` slot resolves to "the first live entry in priority order, lowest
 *     renders", so the seat claims the cell at priority -1 and the shipped
 *     ModelSelect stays registered and loaded but unrendered. Removing this
 *     plugin restores the shipped control; no shipped package is modified.
 */
window.__ModuleLoader__.load({
	id: "dsh-reasoning-slider",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const react = require("react");
		const reactDom = require("react-dom");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { createElement: h } = react;

		/**
		 * Icon names this bundle uses, with the sibling to fall back to when a build
		 * does not ship the first choice. A name the shared table lacks would reach
		 * React as `undefined` and surface as an opaque "element type is invalid";
		 * resolving through `icon()` degrades to a shipped sibling and reports the
		 * exact name once, so a version skew is named instead of silent.
		 */
		const ICONS = {
			gauge: ["IconGaugeOutlineRegular", "IconGaugeOutlineMedium", "IconSparkleRegular"],
			chevronDown: ["IconChevronDownOutlineRegular", "IconChevronsUpDownOutlineRegular"],
			chevronRight: ["IconChevronRightOutlineRegular", "IconChevronDownOutlineRegular"],
			chevronLeft: ["IconChevronLeftOutlineRegular", "IconChevronUpOutlineRegular"],
			check: ["IconCheckOutlineRegular", "IconCheckCircleOutlineRegular"],
			sparkle: ["IconSparkleRegular", "IconSparkleMedium", "IconEnhanceOutlineRegular"],
			warning: ["IconWarningOutlineRegular", "IconWarningTriangleOutlineRegular"]
		};

		const unresolved = new Set();
		/** One icon component, or null when this build ships none of the candidates. */
		function icon(kind) {
			for (const name of ICONS[kind]) {
				const candidate = primitives[name];
				if (typeof candidate === "function") return candidate;
			}
			if (!unresolved.has(kind)) {
				unresolved.add(kind);
				console.warn(
					"dsh-reasoning-slider: none of " +
						ICONS[kind].join(" / ") +
						" is exported by @deepseek-ai/dsh-client-ui-primitives"
				);
			}
			return null;
		}

		/** Icon indirection so an unresolved name degrades instead of crashing React. */
		function Glyph({ kind, ...rest }) {
			const component = icon(kind);
			if (component === null) return null;
			return h(component, rest);
		}

		// -- styles ------------------------------------------------------------
		const css = `
.dshrs-root{position:relative;min-width:0}
.dshrs-trigger{display:flex;align-items:center;gap:10px;min-width:0;max-width:min(420px,60cqw);height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer;outline:none}
.dshrs-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshrs-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dshrs-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dshrs-triggerText{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-triggerText svg{flex:none}
.dshrs-triggerEffort{color:var(--dsw-alias-label-caption);font-weight:500;flex:none}
.dshrs-triggerChevron{flex:none;color:var(--dsw-alias-label-caption);transition:transform .12s ease}
.dshrs-triggerChevronOpen{transform:rotate(180deg)}
.dshrs-menu{position:fixed;z-index:1100;display:flex;flex-direction:column;width:328px;max-width:calc(100vw - 24px);padding:10px;border:0;border-radius:18px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 18px 48px rgba(0,0,0,.42),0 0 0 .5px var(--dsw-alias-border-l4);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dshrs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:34px;padding:0 8px;border:none;border-radius:10px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left}
.dshrs-row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshrs-row:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.dshrs-row:disabled{cursor:default;opacity:.6}
.dshrs-rowLeft{display:flex;align-items:center;gap:8px;min-width:0}
.dshrs-rowLabel{color:var(--dsw-alias-label-secondary);flex:none}
.dshrs-rowValue{display:flex;align-items:center;gap:4px;min-width:0;color:var(--dsw-alias-link);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-rowChevron{flex:none;color:var(--dsw-alias-label-caption)}
.dshrs-head{display:flex;align-items:center;gap:6px;min-height:28px;padding:0 4px 2px}
.dshrs-back{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
.dshrs-back:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshrs-headTitle{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshrs-panel{display:flex;flex-direction:column;gap:2px;padding:6px 6px 10px;border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dshrs-panelHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:2px 4px 8px}
.dshrs-panelTitle{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshrs-panelValue{font-size:13px;line-height:20px;font-weight:600;color:#a89bff}
.dshrs-slider{position:relative;height:34px;padding:0 3px;touch-action:none;-webkit-user-select:none;user-select:none;cursor:pointer;outline:none;border-radius:999px}
.dshrs-slider:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dshrs-slider[data-disabled="true"]{cursor:default;opacity:.55}
.dshrs-track{position:absolute;left:3px;right:3px;top:4px;bottom:4px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);overflow:hidden}
.dshrs-fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(96deg,#4a30f0 0%,#7a45f6 42%,#a45bfb 72%,#c47bff 100%);box-shadow:0 0 14px rgba(126,72,250,.65),0 0 30px rgba(126,72,250,.32)}
.dshrs-fill::after{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,0));pointer-events:none}
.dshrs-sparkles{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.dshrs-spark{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;color:rgba(255,255,255,.92);opacity:var(--dshrs-spark-opacity,.8);animation:dshrs-twinkle var(--dshrs-spark-duration,2.6s) ease-in-out var(--dshrs-spark-delay,0s) infinite;filter:drop-shadow(0 0 4px rgba(255,255,255,.55))}
@keyframes dshrs-twinkle{0%,62%,100%{transform:scale(.34) rotate(0deg);opacity:calc(var(--dshrs-spark-opacity,.8) * .28)}22%{transform:scale(1) rotate(18deg);opacity:var(--dshrs-spark-opacity,.8)}44%{transform:scale(.68) rotate(6deg);opacity:calc(var(--dshrs-spark-opacity,.8) * .6)}}
.dshrs-ticks{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none}
.dshrs-tick{position:absolute;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:rgba(255,255,255,.34);transition:background .15s ease,transform .15s ease}
.dshrs-tickActive{background:rgba(255,255,255,.95);transform:scale(1.25);box-shadow:0 0 7px rgba(255,255,255,.85)}
.dshrs-knob{position:absolute;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:linear-gradient(180deg,#ffffff 0%,#ececf5 100%);box-shadow:0 2px 7px rgba(0,0,0,.42),0 0 0 4px rgba(255,255,255,.1),0 0 20px rgba(168,116,255,.55);transition:box-shadow .15s ease,transform .15s ease;pointer-events:none}
.dshrs-slider[data-dragging="true"] .dshrs-knob{transform:scale(1.08);box-shadow:0 3px 10px rgba(0,0,0,.45),0 0 0 6px rgba(168,116,255,.22),0 0 26px rgba(168,116,255,.75)}
.dshrs-slider:not([data-disabled="true"]):hover .dshrs-knob{box-shadow:0 3px 9px rgba(0,0,0,.45),0 0 0 5px rgba(168,116,255,.18),0 0 24px rgba(168,116,255,.68)}
.dshrs-hint{padding:6px 4px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.dshrs-status{padding:8px 6px 2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dshrs-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin:2px 0 6px;padding:6px 8px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dshrs-retry{flex:none;border:none;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;padding:2px 6px}
.dshrs-retry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshrs-search{box-sizing:border-box;width:100%;margin:2px 0 6px;padding:6px 10px;border:none;border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:none}
.dshrs-search:focus{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dshrs-search::placeholder{color:var(--dsw-alias-label-caption)}
.dshrs-groups{display:flex;flex-direction:column;gap:2px;max-height:min(46vh,320px);overflow-y:auto;padding-right:2px}
.dshrs-groupTitle{padding:8px 8px 4px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-caption)}
.dshrs-option{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:30px;padding:0 8px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dshrs-option:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshrs-option:disabled{cursor:default}
.dshrs-optionName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-optionCheck{flex:none;display:inline-flex;color:#a89bff}
.dshrs-empty{padding:10px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
`;

		const CSS_TAG_ID = "dsh-reasoning-slider/ReasoningSlider.module.css";
		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-reasoning-slider";
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// -- dictionaries ------------------------------------------------------
		const zh = {
			"trigger.fallback": "\u9009\u62e9\u6a21\u578b",
			"trigger.loading": "\u6b63\u5728\u52a0\u8f7d\u6a21\u578b\u2026",
			"trigger.aria": "\u6a21\u578b\u4e0e\u63a8\u7406\u7b49\u7ea7\uff0c\u5f53\u524d {model}\uff0c\u63a8\u7406\u7b49\u7ea7 {effort}",
			"menu.aria": "\u6a21\u578b\u4e0e\u63a8\u7406\u7b49\u7ea7",
			"menu.model": "\u6a21\u578b",
			"menu.effort": "\u63a8\u7406\u7b49\u7ea7",
			"menu.back": "\u8fd4\u56de\u6a21\u578b\u8bbe\u7f6e",
			"effort.default": "\u9ed8\u8ba4",
			"effort.none": "\u8be5\u6a21\u578b\u672a\u63d0\u4f9b\u63a8\u7406\u7b49\u7ea7",
			"effort.hint": "\u5de6\u53f3\u62d6\u52a8\u6ed1\u5757\u8c03\u6574\u63a8\u7406\u7b49\u7ea7",
			"effort.low": "Low",
			"effort.medium": "Medium",
			"effort.high": "High",
			"effort.max": "Max",
			"picker.title": "\u9009\u62e9\u6a21\u578b",
			"picker.search": "\u641c\u7d22\u6a21\u578b\u2026",
			"picker.empty": "\u6ca1\u6709\u53ef\u7528\u7684\u6a21\u578b\u3002",
			"status.loading": "\u6b63\u5728\u5237\u65b0\u6a21\u578b\u5217\u8868\u2026",
			"error.load": "\u6a21\u578b\u76ee\u5f55\u52a0\u8f7d\u5931\u8d25\uff1a{message}",
			"error.action": "\u6a21\u578b\u64cd\u4f5c\u5931\u8d25\uff1a{message}",
			"error.sessionInUse": "\u4f1a\u8bdd\u6b63\u5728\u5199\u5165\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5",
			"action.reload": "\u91cd\u65b0\u52a0\u8f7d"
		};

		const en = {
			"trigger.fallback": "Select model",
			"trigger.loading": "Loading models\u2026",
			"trigger.aria": "Model and reasoning effort, current {model}, effort {effort}",
			"menu.aria": "Model and reasoning effort",
			"menu.model": "Model",
			"menu.effort": "Effort",
			"menu.back": "Back to model settings",
			"effort.default": "Default",
			"effort.none": "This model provides no reasoning levels",
			"effort.hint": "Drag the slider to change the reasoning level",
			"effort.low": "Low",
			"effort.medium": "Medium",
			"effort.high": "High",
			"effort.max": "Max",
			"picker.title": "Select a model",
			"picker.search": "Search models\u2026",
			"picker.empty": "No models available.",
			"status.loading": "Refreshing the model list\u2026",
			"error.load": "Model catalog failed to load: {message}",
			"error.action": "Model operation failed: {message}",
			"error.sessionInUse": "This session is being written to; try again",
			"action.reload": "Reload"
		};

		/** Locale namespace owned by this plugin. */
		const NS = "reasoning-slider";

		/** Interpolate `{name}` placeholders. */
		function fill(template, values) {
			if (values === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, key) => {
				const value = values[key];
				return value === void 0 ? match : String(value);
			});
		}

		/** Adapter-owned effort ids that ship with a built-in localized name. */
		const BUILTIN_EFFORT_KEYS = {
			low: "effort.low",
			medium: "effort.medium",
			high: "effort.high",
			max: "effort.max",
			xhigh: "effort.max"
		};

		function effortName(t, level) {
			if (level.name !== void 0 && level.name.length > 0) return level.name;
			const key = BUILTIN_EFFORT_KEYS[String(level.id).toLowerCase()];
			return key === void 0 ? String(level.id) : t(key);
		}

		/** Flatten the directory's provider groups into selectable rows. */
		function choicesOf(groups) {
			const rows = [];
			for (const group of groups) {
				for (const model of group.models) rows.push({ group, model });
			}
			return rows;
		}

		function findChoice(rows, selection) {
			if (selection === null || selection === void 0) return void 0;
			return rows.find(
				(row) => row.group.id === selection.provider && row.model.id === selection.model
			);
		}

		/** The effort a selection should carry when the operator picks a model. */
		function defaultEffortOf(model) {
			return model.reasoning === void 0 ? void 0 : model.reasoning.defaultEffort;
		}

		/**
		 * The row the panel describes: the session's own selection while the catalog
		 * advertises it AND it carries levels, otherwise the first row that has
		 * levels. A stale or level-less selection therefore still leaves the
		 * operator a working slider instead of a dead panel.
		 */
		function resolveChoice(rows, selection, fallback) {
			const direct = findChoice(rows, selection);
			if (direct !== void 0 && direct.model.reasoning !== void 0) return direct;
			if (fallback !== void 0 && fallback.model.reasoning !== void 0) return fallback;
			return direct ?? fallback ?? rows.find((row) => row.model.reasoning !== void 0);
		}

		// -- pieces ------------------------------------------------------------
		const SPARKLES = [
			{ left: "7%", delay: "0s", duration: "2.4s", size: 15, opacity: 0.95 },
			{ left: "16%", delay: ".7s", duration: "3.1s", size: 10, opacity: 0.7 },
			{ left: "24%", delay: "1.4s", duration: "2.6s", size: 17, opacity: 0.9 },
			{ left: "34%", delay: ".3s", duration: "3.4s", size: 11, opacity: 0.65 },
			{ left: "43%", delay: "1.9s", duration: "2.8s", size: 14, opacity: 0.85 },
			{ left: "52%", delay: "1.1s", duration: "2.2s", size: 9, opacity: 0.6 },
			{ left: "61%", delay: ".5s", duration: "3.2s", size: 16, opacity: 0.9 },
			{ left: "70%", delay: "2.2s", duration: "2.5s", size: 12, opacity: 0.7 },
			{ left: "79%", delay: "1.6s", duration: "3s", size: 15, opacity: 0.85 },
			{ left: "88%", delay: ".9s", duration: "2.7s", size: 10, opacity: 0.6 }
		];

		function Sparkles({ width, height }) {
			if (width <= 0) return null;
			const middle = (height > 0 ? height : 26) / 2;
			const out = [];
			for (let index = 0; index < SPARKLES.length; index += 1) {
				const spark = SPARKLES[index];
				const x = (width * Number.parseFloat(spark.left)) / 100;
				if (x < 6 || x > width - 6) continue;
				out.push(
					h(
						"span",
						{
							key: index,
							className: "dshrs-spark",
							style: {
								left: x + "px",
								top: middle + (index % 3) * 1.5 - 1.5 + "px",
								"--dshrs-spark-delay": spark.delay,
								"--dshrs-spark-duration": spark.duration,
								"--dshrs-spark-opacity": String(spark.opacity)
							}
						},
						h(Glyph, { kind: "sparkle", size: spark.size })
					)
				);
			}
			return h("div", { className: "dshrs-sparkles", "aria-hidden": true }, out);
		}

		/**
		 * The effort slider: a pill track whose glowing gradient fill ends at the
		 * active level, twinkling inside the track, one tick per level and a white
		 * knob at the current position. Drag, click, or use the arrow keys.
		 */
		function EffortSlider({
			t,
			levels,
			index,
			disabled,
			dragging,
			onDragStart,
			onPreview,
			onCommit,
			onKeyCommit
		}) {
			const trackRef = react.useRef(null);
			const [geometry, setGeometry] = react.useState({ width: 0, height: 0 });
			const count = levels.length;

			react.useEffect(() => {
				const node = trackRef.current;
				if (node === null || typeof ResizeObserver === "undefined") return void 0;
				const measure = () => {
					setGeometry((current) =>
						current.width === node.clientWidth && current.height === node.clientHeight
							? current
							: { width: node.clientWidth, height: node.clientHeight }
					);
				};
				measure();
				const observer = new ResizeObserver(measure);
				observer.observe(node);
				return () => {
					observer.disconnect();
				};
			}, []);

			const fraction = count <= 1 ? 0 : index / (count - 1);
			const fillWidth = geometry.width > 0 ? Math.max(26, fraction * geometry.width) : 0;

			const indexAt = (clientX) => {
				const node = trackRef.current;
				if (node === null || count <= 1) return 0;
				const rect = node.getBoundingClientRect();
				if (rect.width <= 0) return 0;
				const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
				return Math.round(ratio * (count - 1));
			};

			const onPointerDown = (event) => {
				if (disabled || count === 0) return;
				if (event.button !== void 0 && event.button !== 0) return;
				event.preventDefault();
				onDragStart();
				onPreview(indexAt(event.clientX));
				const move = (moveEvent) => {
					onPreview(indexAt(moveEvent.clientX));
				};
				const up = (upEvent) => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", up);
					window.removeEventListener("pointercancel", up);
					onCommit(indexAt(upEvent.clientX));
				};
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
				window.addEventListener("pointercancel", up);
			};

			const onKeyDown = (event) => {
				if (disabled || count === 0) return;
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const step = event.key === "ArrowRight" ? 1 : -1;
				const next = Math.min(count - 1, Math.max(0, index + step));
				if (next === index) return;
				onPreview(next);
				onKeyCommit(next);
			};

			return h(
				"div",
				{
					className: "dshrs-slider",
					role: "slider",
					tabIndex: disabled ? -1 : 0,
					"aria-label": t("menu.effort"),
					"aria-valuemin": 1,
					"aria-valuemax": count,
					"aria-valuenow": index + 1,
					"aria-valuetext": levels[index] === void 0 ? "" : effortName(t, levels[index]),
					"aria-disabled": disabled,
					"data-disabled": disabled ? "true" : "false",
					"data-dragging": dragging ? "true" : "false",
					onPointerDown,
					onKeyDown
				},
				h(
					"div",
					{ ref: trackRef, className: "dshrs-track" },
					h("div", { className: "dshrs-fill", style: { width: fillWidth + "px" } }),
					h(Sparkles, { width: fillWidth, height: geometry.height }),
					h(
						"div",
						{ className: "dshrs-ticks" },
						levels.map((level, position) =>
							h("span", {
								key: level.id,
								className: "dshrs-tick" + (position <= index ? " dshrs-tickActive" : ""),
								style: {
									left: (count <= 1 ? 0 : (position / (count - 1)) * 100) + "%"
								}
							})
						)
					)
				),
				h("div", {
					className: "dshrs-knob",
					style: { left: (count <= 1 ? 50 : fraction * 100) + "%" }
				})
			);
		}

		/** Provider-grouped option rows for the picker. */
		function groupRows(rows, current, busy, onPick) {
			const out = [];
			let lastGroup = null;
			for (const row of rows) {
				if (row.group.id !== lastGroup) {
					lastGroup = row.group.id;
					out.push(
						h(
							"div",
							{ key: "group:" + row.group.id, className: "dshrs-groupTitle" },
							row.group.name
						)
					);
				}
				const selected =
					current !== null &&
					current !== void 0 &&
					current.provider === row.group.id &&
					current.model === row.model.id;
				out.push(
					h(
						"button",
						{
							key: row.group.id + "/" + row.model.id,
							type: "button",
							className: "dshrs-option",
							disabled: busy,
							title: row.model.description ?? row.model.name,
							onClick: () => onPick(row)
						},
						h("span", { className: "dshrs-optionName" }, row.model.name),
						selected
							? h(
									"span",
									{ className: "dshrs-optionCheck" },
									h(Glyph, { kind: "check", size: 14 })
								)
							: null
					)
				);
			}
			return out;
		}

		/** The two-level popup: root (model row + effort slider) and the model picker. */
		function ReasoningSlider({ locked, available, directory, load, select, t }) {
			const state = react.useSyncExternalStore(
				(listener) => directory.subscribe(listener),
				() => directory.getSnapshot()
			);
			const [open, setOpen] = react.useState(false);
			const [view, setView] = react.useState("root");
			const [query, setQuery] = react.useState("");
			const [dragIndex, setDragIndex] = react.useState(null);
			const [dragging, setDragging] = react.useState(false);
			const [menuPos, setMenuPos] = react.useState(null);
			const [anchor, setAnchor] = react.useState(null);
			const [failure, setFailure] = react.useState(null);
			const rootRef = react.useRef(null);
			const triggerRef = react.useRef(null);
			const menuRef = react.useRef(null);
			const searchRef = react.useRef(null);

			const rows = react.useMemo(() => choicesOf(state.groups), [state.groups]);
			const current = state.current;
			const choice = resolveChoice(rows, current, rows.find((row) => row.model.reasoning !== void 0));
			const levels =
				choice === void 0 || choice.model.reasoning === void 0 ? [] : choice.model.reasoning.efforts;
			const settledEffort =
				choice !== void 0 &&
				current !== null &&
				current !== void 0 &&
				current.provider === choice.group.id &&
				current.model === choice.model.id &&
				current.reasoningEffort !== void 0
					? current.reasoningEffort
					: choice === void 0
						? state.retainedEffort
						: defaultEffortOf(choice.model);
			const settledIndex = Math.max(0, levels.findIndex((level) => level.id === settledEffort));
			const index =
				dragIndex === null ? settledIndex : Math.min(Math.max(levels.length - 1, 0), dragIndex);
			const count = levels.length;
			const busy = state.status === "selecting";
			const choosing = locked || busy || choice === void 0;
			const waiting = state.status === "loading" && rows.length === 0;
			const levelLabel = count === 0 ? void 0 : effortName(t, levels[index] ?? levels[0]);

			const modelLabel = waiting
				? t("trigger.loading")
				: (choice === void 0 ? void 0 : choice.model.name) ??
					(current === null || current === void 0
						? t("trigger.fallback")
						: current.provider + "/" + current.model);
			const triggerAria =
				levelLabel === void 0
					? modelLabel
					: t("trigger.aria", { model: modelLabel, effort: levelLabel });

			// The popup anchors to the composer card when one is present.
			react.useEffect(() => {
				if (rootRef.current === null) return;
				setAnchor(rootRef.current.closest("[data-composer-card]") ?? document.body);
			}, []);

			react.useLayoutEffect(() => {
				if (!open) {
					setMenuPos((previous) => (previous === null ? previous : null));
					return void 0;
				}
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect === void 0) return;
					const margin = 12;
					const width = menuRef.current?.offsetWidth ?? 0;
					const height = menuRef.current?.offsetHeight ?? 0;
					let left = rect.left;
					let top = rect.top - 10 - height;
					if (width > 0) {
						left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
					}
					if (height > 0 && top < margin) {
						top = Math.min(rect.bottom + 10, window.innerHeight - height - margin);
					}
					// Same-value bail-out: a fresh object on every placement would
					// re-render forever, because this effect depends on the state it writes.
					setMenuPos((previous) =>
						previous !== null && previous.left === left && previous.top === top
							? previous
							: { left, top }
					);
				};
				place();
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				return () => {
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
				};
			}, [open, view, state]);

			react.useEffect(() => {
				if (!open) return void 0;
				const dismiss = (event) => {
					const target = event.target;
					if (rootRef.current?.contains(target) === true) return;
					if (menuRef.current?.contains(target) === true) return;
					setOpen(false);
				};
				document.addEventListener("mousedown", dismiss);
				return () => {
					document.removeEventListener("mousedown", dismiss);
				};
			}, [open]);

			react.useEffect(() => {
				if (!open || view !== "picker") return;
				searchRef.current?.focus();
			}, [open, view]);

			const submit = (selection) => {
				setFailure(null);
				return select(selection).then(
					(result) => {
						if (result !== void 0 && result !== null && result.ok === false) {
							setFailure(
								result.error.code === "session/writer-held"
									? t("error.sessionInUse")
									: String(result.error.message ?? result.error.code)
							);
						}
					},
					(error) => {
						setFailure(error instanceof Error ? error.message : String(error));
					}
				);
			};

			const commitEffort = (position) => {
				setDragging(false);
				const clamped = Math.min(Math.max(count - 1, 0), position);
				setDragIndex(null);
				if (choice === void 0 || count === 0 || busy) return;
				const level = levels[clamped];
				if (level === void 0 || clamped === settledIndex) return;
				submit({
					provider: choice.group.id,
					model: choice.model.id,
					reasoningEffort: level.id
				});
			};

			const chooseModel = (row) => {
				setView("root");
				setQuery("");
				const effort = defaultEffortOf(row.model);
				const selection = { provider: row.group.id, model: row.model.id };
				if (effort !== void 0) selection.reasoningEffort = effort;
				if (
					current !== null &&
					current !== void 0 &&
					current.provider === selection.provider &&
					current.model === selection.model
				) {
					return;
				}
				submit(selection);
			};

			const onTriggerClick = () => {
				if (open) {
					setOpen(false);
					setView("root");
					return;
				}
				setView("root");
				setQuery("");
				setOpen(true);
				load();
			};

			const normalized = query.trim().toLowerCase();
			const filtered =
				normalized === ""
					? rows
					: rows.filter(
							(row) =>
								row.model.name.toLowerCase().includes(normalized) ||
								row.model.id.toLowerCase().includes(normalized) ||
								row.group.name.toLowerCase().includes(normalized)
						);

			const failureText =
				failure ??
				(state.error === null || state.error === void 0
					? null
					: fill(t("error.load"), { message: state.error }));

			const panel =
				count === 0
					? h("div", { className: "dshrs-empty" }, t("effort.none"))
					: [
							h(
								"div",
								{ key: "head", className: "dshrs-panelHead" },
								h("span", { className: "dshrs-panelTitle" }, t("menu.effort")),
								h("span", { className: "dshrs-panelValue" }, levelLabel)
							),
							h(EffortSlider, {
								key: "slider",
								t,
								levels,
								index,
								disabled: choosing,
								dragging,
								onDragStart: () => setDragging(true),
								onPreview: (position) => setDragIndex(position),
								onCommit: commitEffort,
								onKeyCommit: (position) => {
									setDragIndex(position);
									window.setTimeout(() => commitEffort(position), 280);
								}
							}),
							h("div", { key: "hint", className: "dshrs-hint" }, t("effort.hint"))
						];

			const rootView = [
				h(
					"button",
					{
						key: "model",
						type: "button",
						className: "dshrs-row",
						disabled: locked || busy,
						onClick: () => setView("picker")
					},
					h(
						"span",
						{ className: "dshrs-rowLeft" },
						h("span", { className: "dshrs-rowLabel" }, t("menu.model"))
					),
					h(
						"span",
						{ className: "dshrs-rowValue" },
						modelLabel,
						h(Glyph, { kind: "chevronRight", size: 14, className: "dshrs-rowChevron" })
					)
				),
				h("div", { key: "panel", className: "dshrs-panel" }, panel)
			];

			const pickerView = [
				h(
					"div",
					{ key: "head", className: "dshrs-head" },
					h(
						"button",
						{
							type: "button",
							className: "dshrs-back",
							"aria-label": t("menu.back"),
							onClick: () => {
								setView("root");
								setQuery("");
							}
						},
						h(Glyph, { kind: "chevronLeft", size: 14 })
					),
					h("span", { className: "dshrs-headTitle" }, t("picker.title"))
				),
				h("input", {
					key: "search",
					ref: searchRef,
					className: "dshrs-search",
					type: "search",
					value: query,
					placeholder: t("picker.search"),
					onChange: (event) => setQuery(event.target.value)
				}),
				h(
					"div",
					{ key: "groups", className: "dshrs-groups scrollable" },
					waiting
						? h("div", { className: "dshrs-status" }, t("status.loading"))
						: filtered.length === 0
							? h("div", { className: "dshrs-empty" }, t("picker.empty"))
							: groupRows(filtered, current, busy, chooseModel)
				)
			];

			if (!available) return null;

			return h(
				"div",
				{
					ref: rootRef,
					className: "dshrs-root",
					onKeyDown: (event) => {
						if (event.key !== "Escape" || !open) return;
						event.preventDefault();
						if (view !== "root") {
							setView("root");
							setQuery("");
						} else {
							setOpen(false);
							triggerRef.current?.focus();
						}
					}
				},
				h(
					"button",
					{
						ref: triggerRef,
						type: "button",
						className: "dshrs-trigger",
						"aria-label": triggerAria,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-busy": busy,
						title: triggerAria,
						disabled: locked,
						onClick: onTriggerClick
					},
					h(
						"span",
						{ className: "dshrs-triggerText" },
						h(Glyph, { kind: "gauge", size: 16 }),
						modelLabel,
						levelLabel === void 0
							? null
							: h("span", { className: "dshrs-triggerEffort" }, levelLabel)
					),
					h(Glyph, {
						kind: "chevronDown",
						size: 14,
						className: "dshrs-triggerChevron" + (open ? " dshrs-triggerChevronOpen" : "")
					})
				),
				open && anchor !== null
					? reactDom.createPortal(
							h(
								"div",
								{
									ref: menuRef,
									className: "dshrs-menu",
									role: "dialog",
									"aria-label": t("menu.aria"),
									"data-dsh-reasoning-slider-menu": "true",
									style: menuPos ?? { visibility: "hidden", left: 0, top: 0 }
								},
								failureText !== null && failureText !== void 0
									? h(
											"div",
											{ className: "dshrs-error" },
											h("span", null, failureText),
											h(
												"button",
												{
													type: "button",
													className: "dshrs-retry",
													onClick: () => {
														setFailure(null);
														load();
													}
												},
												t("action.reload")
											)
										)
									: null,
								view === "root" ? rootView : pickerView
							),
							anchor
						)
					: null
			);
		}

		// -- plugin body -------------------------------------------------------
		/**
		 * Services this plugin reads. `slots` is the seat registry, `locale` owns the
		 * dictionaries, `sessions` answers subagent addressing, and
		 * `modelDirectories` is the per-session model state the shipped
		 * model-selection row provides - that service in turn needs the session
		 * remotes on THIS fiber, so `remote` and `remote.session` are declared here
		 * too. A cordis scope only exposes the services its fiber injected: reading
		 * an undeclared one aborts the callback.
		 */
		const inject = [
			"slots",
			"locale",
			"modelDirectories",
			"sessions",
			"remote",
			"remote.session"
		];

		/**
		 * Claim the composer's model seat.
		 *
		 * `conversation.input.model` is a `single` slot whose cell resolves to the
		 * first live entry in priority order (lowest renders). The shipped
		 * ModelSelect registers at the default priority 0, so this plugin claims the
		 * same cell at priority -1: the shipped control stays registered, loaded and
		 * unmodified, and simply stops being the winner. Removing this plugin (or
		 * raising its priority) restores it.
		 *
		 * @param ctx - the client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "reasoning-slider: dictionaries");
			const bound = ctx.locale.bind(NS);
			const own = (key, values) => {
				const template = bound(key);
				return fill(template === void 0 || template === key ? key : template, values);
			};
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const models = scope.modelDirectories;
				const sessions = scope.sessions;
				const seat = (sessionId) => {
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
				};
				const component = (componentProps) =>
					h(ReasoningSlider, {
						...componentProps,
						t: (key, values) => {
							const injected =
								typeof componentProps.t === "function"
									? componentProps.t(key, values)
									: void 0;
							return injected === void 0 || injected === key
								? own(key, values)
								: injected;
						}
					});
				const register = () =>
					scope.slots.register(
						{
							name: "conversation.input.model",
							locale: NS,
							priority: -1,
							inject: seat
						},
						component
					);

				/**
				 * Claim the seat through the DECLARATION seam, never the change stream.
				 *
				 * `slots.inject(key, callback)` runs its callback once per declaration
				 * lifetime (reconciled by `declarationEpoch`), so registering inside it
				 * cannot feed back into the notification it came from. Subscribing to
				 * `slots.subscribe(key, fn)` instead would: that surface fires on every
				 * entry mutation, so a `fn` that disposes and re-registers the seat
				 * schedules the next notification from inside the current one - an
				 * unbounded microtask loop that freezes the page.
				 */
				if (typeof scope.slots.inject === "function") {
					scope.slots.inject("conversation.input.model", register);
					return;
				}

				// Fallback for a build without the declaration seam: register once, then
				// retry only on DECLARATION boundaries (`subscribeDeclaration` is
				// documented not to fire for ordinary entry mutations). The retry still
				// disposes first, because a `single` cell rejects a second entry at the
				// same priority.
				let live;
				const claim = () => {
					if (typeof scope.slots.register !== "function") return;
					const retry = () => {
						if (live !== void 0) {
							live();
							live = void 0;
						}
						try {
							live = register();
						} catch (error) {
							live = void 0;
							if (typeof console !== "undefined") {
								console.debug(
									"dsh-reasoning-slider: model seat not declared yet -",
									error instanceof Error ? error.message : String(error)
								);
							}
						}
					};
					retry();
					if (live === void 0 && typeof scope.slots.subscribeDeclaration === "function") {
						scope.effect(
							() => scope.slots.subscribeDeclaration("conversation.input.model", retry),
							"reasoning-slider: seat declaration"
						);
					}
				};
				claim();
				scope.effect(
					() => () => {
						if (live !== void 0) live();
						live = void 0;
					},
					"reasoning-slider: model seat"
				);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
