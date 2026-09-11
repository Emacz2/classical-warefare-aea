function init(data = {})
{
	return new Promise(closePageCallback => { g_Page = new CatafalquePage(closePageCallback); });
}
