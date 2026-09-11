/**
 * This class is responsible for loading the affected GUI control classes,
 * and setting them up to communicate with each other.
 */
class SavegamePage
{
	constructor(data, closePageCallback)
	{
		this.savegameList = new SavegameList(data && data.campaignRun || null);

		this.savegameDetails = new SavegameDetails();
		this.savegameList.registerSelectionChangeHandler(this.savegameDetails);

		this.savegameDeleter = new SavegameDeleter();
		this.savegameDeleter.registerSavegameListChangeHandler(this.savegameList);
		this.savegameList.registerSelectionChangeHandler(this.savegameDeleter);

		const savePage = !!data?.savedGameData;
		if (savePage)
		{
			this.savegameWriter = new SavegameWriter(closePageCallback, data.savedGameData);
			this.savegameList.registerSelectionChangeHandler(this.savegameWriter);
			this.savegameList.gameSelection.size.bottom -= 24;
		}
		else
		{
			this.savegameLoader = new SavegameLoader(closePageCallback);
			this.savegameList.registerSelectionChangeHandler(this.savegameLoader);
			this.savegameList.selectFirst();
		}

		Engine.GetGUIObjectByName("title").caption = savePage ? translate("Save Game") : translate("Load Game");
		Engine.GetGUIObjectByName("cancel").onPress = closePageCallback;
	}
}

var g_SavegamePage;

function init(data)
{
	return new Promise(closePageCallback => {
		g_SavegamePage = new SavegamePage(data, closePageCallback);
	});
}
