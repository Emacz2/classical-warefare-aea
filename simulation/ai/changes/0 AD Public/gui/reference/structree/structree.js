/**
 * Initialize the page.
 *
 * @param {Object} data - Parameters passed from the code that calls this page into existence.
 */
function init(data)
{
	const promise = new Promise(closePageCallback => { g_Page = new StructreePage(closePageCallback); });

	if (data?.civ)
		g_Page.civSelection.selectCiv(data.civ);
	else
		g_Page.civSelection.selectFirstCiv();

	return promise;
}
