/**
 * This class obtains the list of savegames from the engine,
 * builds the list dependent on selected filters and sorting order.
 *
 * If the selected savegame changes, class instances that subscribed via
 * registerSelectionChangeHandler will have their onSelectionChange function
 * called with the relevant savegame data.
 */
class SavegameList
{
	constructor(campaignRun)
	{
		this.savedGamesMetadata = [];
		this.selectionChangeHandlers = [];

		// If not null, only show games for the following campaign run
		// (campaign save-games are not shown by default).
		// Campaign games are saved in the same folder as regular ones,
		// as there is no strong reason to do otherwise (since games from different runs
		// need to be hidden from one another anyways, we need code to handle it).
		this.campaignRun = campaignRun;

		this.gameSelection = Engine.GetGUIObjectByName("gameSelection");
		this.gameSelectionFeedback = Engine.GetGUIObjectByName("gameSelectionFeedback");
		this.confirmButton = Engine.GetGUIObjectByName("confirmButton");
		this.compatibilityFilter = Engine.GetGUIObjectByName("compatibilityFilter");
		this.compatibilityFilter.onPress = () => { this.updateSavegameList(); };

		this.initSavegameList();
	}

	initSavegameList()
	{
		const engineInfo = Engine.GetEngineInfo();

		this.gameSelection.onSelectionColumnChange = () => { this.updateSavegameList(); };
		this.gameSelection.onMouseLeftDoubleClickItem = () => { this.confirmButton.onPress(); };
		this.gameSelection.onSelectionChange = () => {
			const gameId = this.gameSelection.list_data[this.gameSelection.selected];
			const metadata = this.savedGamesMetadata[this.gameSelection.selected];
			const label = this.generateSavegameLabel(metadata, engineInfo);
			for (const handler of this.selectionChangeHandlers)
				handler.onSelectionChange(gameId, metadata, label);
		};

		this.updateSavegameList();
	}

	registerSelectionChangeHandler(selectionChangeHandler)
	{
		this.selectionChangeHandlers.push(selectionChangeHandler);
	}

	onSavegameListChange()
	{
		this.updateSavegameList();

		// Allow subscribers (delete button) to update their press function in case
		// the list items changed but the selected index remained the same.
		this.gameSelection.onSelectionChange();
	}

	selectFirst()
	{
		if (this.gameSelection.list.length)
			this.gameSelection.selected = 0;
	}

	updateSavegameList()
	{
		let savedGames = Engine.GetSavedGames();

		// Get current game version and loaded mods
		const engineInfo = Engine.GetEngineInfo();

		if (this.compatibilityFilter.checked)
			savedGames = savedGames.filter(game => {
				return this.isCompatibleSavegame(game.metadata, engineInfo) &&
				this.campaignFilter(game.metadata, this.campaignRun);
			});
		else if (this.campaignRun)
			savedGames = savedGames.filter(game => this.campaignFilter(game.metadata, this.campaignRun));


		this.gameSelection.enabled = !!savedGames.length;
		this.gameSelectionFeedback.hidden = !!savedGames.length;

		const selectedGameId = this.gameSelection.list_data[this.gameSelection.selected];

		// Save metadata for the detailed view
		this.savedGamesMetadata = savedGames.map(game => {
			game.metadata.id = game.id;
			return game.metadata;
		});

		const sortKey = this.gameSelection.selected_column;
		const sortOrder = this.gameSelection.selected_column_order;

		this.savedGamesMetadata = this.savedGamesMetadata.sort((a, b) => {
			let cmpA, cmpB;
			switch (sortKey)
			{
			case 'date':
				cmpA = +a.time;
				cmpB = +b.time;
				break;
			case 'mapName':
				cmpA = translate(a.initAttributes.settings.mapName);
				cmpB = translate(b.initAttributes.settings.mapName);
				break;
			case 'mapType':
				cmpA = translateMapType(a.initAttributes.mapType);
				cmpB = translateMapType(b.initAttributes.mapType);
				break;
			case 'description':
				cmpA = a.description;
				cmpB = b.description;
				break;
			default:
				error("Unknown sortKey in updateSavegameList: " + sortKey);
			}

			if (cmpA < cmpB)
				return -sortOrder;
			else if (cmpA > cmpB)
				return +sortOrder;

			return 0;
		});

		let list = this.savedGamesMetadata.map(metadata => {
			const isCompatible = this.isCompatibleSavegame(metadata, engineInfo) &&
			                   this.campaignFilter(metadata, this.campaignRun);
			// Backwards compatibility for pre-A25 savegames
			const mapName = metadata.initAttributes.settings?.mapName ?? metadata.initAttributes.settings.Name;
			return {
				"date": this.generateSavegameDateString(metadata, engineInfo),
				"mapName": compatibilityColor(translate(mapName), isCompatible),
				"mapType": compatibilityColor(translateMapType(metadata.initAttributes.mapType), isCompatible),
				"description": compatibilityColor(metadata.description, isCompatible)
			};
		});

		if (list.length)
			list = prepareForDropdown(list);

		this.gameSelection.list_date = list.date || [];
		this.gameSelection.list_mapName = list.mapName || [];
		this.gameSelection.list_mapType = list.mapType || [];
		this.gameSelection.list_description = list.description || [];

		// Change these last, otherwise crash
		this.gameSelection.list = this.savedGamesMetadata.map(metadata => 0);
		this.gameSelection.list_data = this.savedGamesMetadata.map(metadata => metadata.id);

		// Restore selection if the selected savegame still exists.
		// If the last savegame was deleted, or if it was hidden by the compatibility filter, select the new last item.
		const selectedGameIndex = this.savedGamesMetadata.findIndex(metadata => metadata.id == selectedGameId);
		if (selectedGameIndex != -1)
			this.gameSelection.selected = selectedGameIndex;
		else if (this.gameSelection.selected >= this.savedGamesMetadata.length)
			this.gameSelection.selected = this.savedGamesMetadata.length - 1;
	}

	campaignFilter(metadata, campaignRun)
	{
		if (!campaignRun)
			return !metadata.initAttributes.campaignData;
		if (metadata.initAttributes.campaignData)
			return metadata.initAttributes.campaignData.run == campaignRun;
		return false;
	}

	isCompatibleSavegame(metadata, engineInfo)
	{
		return engineInfo &&
			metadata.engine_serialization_version &&
			metadata.engine_serialization_version == engineInfo.engine_serialization_version &&
			hasSameMods(metadata.mods, engineInfo.mods);
	}

	generateSavegameDateString(metadata, engineInfo)
	{
		return compatibilityColor(
			Engine.FormatMillisecondsIntoDateStringLocal(metadata.time * 1000, translate("yyyy-MM-dd HH:mm:ss")),
			this.isCompatibleSavegame(metadata, engineInfo));
	}

	generateSavegameLabel(metadata, engineInfo)
	{
		if (!metadata)
			return undefined;

		return sprintf(
			metadata.description ?
				translate("%(dateString)s %(map)s - %(description)s") :
				translate("%(dateString)s %(map)s"),
			{
				"dateString": this.generateSavegameDateString(metadata, engineInfo),
				"map": metadata.initAttributes.map,
				"description": metadata.description || ""
			});
	}
}
