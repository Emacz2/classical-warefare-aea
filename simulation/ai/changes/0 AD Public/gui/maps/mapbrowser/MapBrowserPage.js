/**
 * TODO: better global state handling in the GUI.
 */
const g_MapTypes = prepareForDropdown(g_Settings && g_Settings.MapTypes);

function init()
{
	const cache = new MapCache();
	const filters = new MapFilters(cache);
	const browser = new MapBrowser(cache, filters);
	browser.openPage(false);
	browser.controls.MapFiltering.select("default", "skirmish");
	return new Promise(closePageCallback => { browser.registerClosePageHandler(closePageCallback); });
}
