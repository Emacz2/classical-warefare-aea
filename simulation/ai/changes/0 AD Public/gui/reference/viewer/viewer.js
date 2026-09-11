/**
 * Override style so we can get a bigger primary name.
 */
// Temporarily overwritten in order to hide a baseline issue in the font engine.
g_TooltipTextFormats.namePrimaryBig.font = /* "sans-bold-20" */ "sans-bold-16";
g_TooltipTextFormats.namePrimarySmall.font = "sans-bold-16";
g_TooltipTextFormats.nameSecondary.font = "sans-bold-16";

/**
 * Page initialisation. May also eventually pre-draw/arrange objects.
 *
 * @param {Object} data - Contains the civCode and the name of the template to display.
 * @param {string} data.templateName
 * @param {string} [data.civ]
 */
function init(data)
{
	const promise = new Promise(closePageCallback => { g_Page = new ViewerPage(closePageCallback); });
	g_Page.selectTemplate(data);
	return promise;
}
