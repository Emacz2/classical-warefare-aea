class AutoStart
{
	constructor(cmdLineArgs)
	{
		this.playerAssignments = {
			"local": {
				"player": +(cmdLineArgs?.['autostart-player'] ?? 1),
				"name": "anonymous",
			},
		};
		this.settings = new GameSettings().init();

		// Enable cheats in SP
		this.settings.cheats.setEnabled(true);

		parseCmdLineArgs(this.settings, cmdLineArgs);

		this.settings.launchGame(this.playerAssignments, !('autostart-disable-replay' in cmdLineArgs));
		this.onLaunch();
	}

	onTick()
	{
	}

	/**
	 * In the visual autostart path, we need to show the loading screen.
	 */
	onLaunch()
	{
		Engine.SwitchGuiPage("page_loading.xml", {
			"attribs": this.settings.finalizedAttributes,
			"playerAssignments": this.playerAssignments
		});
	}
}
