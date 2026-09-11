/**
 * This class is responsible for display and performance of the Load button.
 */
class SavegameLoader
{
	constructor(closePageCallback)
	{
		this.closePageCallback = closePageCallback;
		this.confirmButton = Engine.GetGUIObjectByName("confirmButton");
		this.confirmButton.caption = translate("Load");
		this.confirmButton.enabled = false;
	}

	onSelectionChange(gameID, metadata, label)
	{
		this.confirmButton.enabled = !!metadata;
		this.confirmButton.onPress = () => {
			this.loadGame(gameID, metadata);
		};
	}

	async loadGame(gameId, metadata)
	{
		// Check compatibility before really loading it
		const engineInfo = Engine.GetEngineInfo();
		const sameMods = hasSameMods(metadata.mods, engineInfo.mods);
		const compatibleEngineVersions = metadata.engine_serialization_version && metadata.engine_serialization_version == engineInfo.engine_serialization_version;

		if (compatibleEngineVersions && sameMods)
		{
			this.closePageCallback(gameId);
			return;
		}

		// Version not compatible ... ask for confirmation
		let message = "";

		if (!compatibleEngineVersions)
		{
			if (metadata.engine_serialization_version)
				message += sprintf(translate("This savegame needs 0 A.D. version %(requiredCompatibleVersion)s or compatible. You are running version %(currentVersion)s, compatible down to %(compatibleVersion)s."), {
					"requiredCompatibleVersion": metadata.engine_serialization_version,
					"currentVersion": engineInfo.engine_version,
					"compatibleVersion": engineInfo.engine_serialization_version,
				}) + "\n";
			else
				message += translate("This savegame needs an older version of 0 A.D.") + "\n";
		}

		if (!sameMods)
		{
			if (!metadata.mods)
				metadata.mods = [];

			message += translate("This savegame needs a different sequence of mods:") + "\n" +
				comparedModsString(metadata.mods, engineInfo.mods) + "\n";
		}

		message += translate("Do you still want to proceed?");

		const buttonIndex = await messageBox(
			500, 250,
			message,
			translate("Warning"),
			[translate("No"), translate("Yes")]);
		if (buttonIndex === 1)
			this.closePageCallback(gameId);
	}
}
