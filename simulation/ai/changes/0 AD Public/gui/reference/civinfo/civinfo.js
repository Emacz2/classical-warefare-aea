/**
 * Initialize the dropdown containing all the available civs.
 */
function init(data)
{
	const promise = new Promise(closePageCallback => { g_Page = new CivInfoPage(closePageCallback); });

	if (data?.civ)
		g_Page.civSelection.selectCiv(data.civ);
	else
		g_Page.civSelection.selectFirstCiv();

	return promise;
}
