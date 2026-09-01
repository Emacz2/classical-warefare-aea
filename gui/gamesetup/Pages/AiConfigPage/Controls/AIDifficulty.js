AIGameSettingControls.AIDifficulty = class extends AIGameSettingControlDropdown
{
	constructor(...args)
	{
		super(...args);
		g_GameSettings.playerAI.watch(() => this.render(), ["values"]);
	}

	render()
	{
		let difficulties = g_Settings.AIDifficulties.slice();
		if (!difficulties.some(difficulty => difficulty.Name == "expert"))
			difficulties.push({
				"Name": "expert",
				"Title": translateWithContext("aiDiff", "Expert")
			});

		this.dropdown.list = difficulties.map(difficulty => difficulty.Title);
		this.dropdown.list_data = difficulties.map((difficulty, i) => i);

		let ai = g_GameSettings.playerAI.get(this.playerIndex);
		this.setHidden(!ai);

		if (!!ai)
			this.setSelectedValue(ai.difficulty);
	}

	onSelectionChange(itemIdx)
	{
		g_GameSettings.playerAI.setDifficulty(this.playerIndex, this.dropdown.list_data[itemIdx]);
		this.gameSettingsController.setNetworkInitAttributes();
	}
};

AIGameSettingControls.AIDifficulty.prototype.ConfigDifficulty =
	"gui.gamesetup.aidifficulty";

AIGameSettingControls.AIDifficulty.prototype.TitleCaption =
	translate("AI Difficulty");
