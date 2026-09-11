function init(initData)
{
	// This doesn't use the autostart/ folder as those are intended for CLI commands and the duplication isn't big enough.

	const settings = new GameSettings().init();

	settings.fromInitAttributes(initData.attribs);

	settings.launchGame(initData.playerAssignments, initData.storeReplay);

	Engine.SwitchGuiPage("page_loading.xml", {
		"attribs": settings.finalizedAttributes,
		"playerAssignments": initData.playerAssignments
	});
}
