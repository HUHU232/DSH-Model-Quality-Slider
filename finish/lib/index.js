/**
 * dsh-reasoning-slider — host half.
 *
 * Pure browser-surface plugin: the browser half ships through
 * `exports["./client"]` and is discovered by the package.json `dsh.client`
 * declaration. This node half exists only so the plugin can be mounted as an
 * ordinary Loader row; it registers no host service and emits no events, and it
 * imports nothing (so it loads even when the plugin package lives outside the
 * dsh install tree).
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
function apply() {
}

export { apply };
export default apply;
