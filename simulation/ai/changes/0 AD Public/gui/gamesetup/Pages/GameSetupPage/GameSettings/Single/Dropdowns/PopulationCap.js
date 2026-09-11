const CAPTYPE_PLAYER_POPULATION = "player";
const CAPTYPE_TEAM_POPULATION = "team";
const CAPTYPE_WORLD_POPULATION = "world";

GameSettingControls.PopulationCap = class PopulationCap extends GameSettingControlDropdown
{
	constructor(...args)
	{
		super(...args);

		this.sprintfArgs = {};

		g_GameSettings.population.watch(() => this.render(), ["cap", "perPlayer"]);
		g_GameSettings.map.watch(() => this.render(), ["type"]);
		this.render();
	}

	render()
	{
		this.setEnabled(g_GameSettings.map.type != "scenario" && !g_GameSettings.population.perPlayer);
		this.title.caption = g_GameSettings.population.currentData.CapTitle;
		if (g_GameSettings.population.perPlayer)
			this.label.caption = this.PerPlayerCaption;
		if (!this.enabled)
			return;

		this.dropdown.list_data = g_GameSettings.population.currentData.Options.List;
		this.dropdown.list = this.dropdown.list_data.map(population =>
			population < 10000 ? population : translate("Unlimited")
		);
		this.setSelectedValue(g_GameSettings.population.cap);
	}


	onHoverChange()
	{
		if (this.dropdown.hovered == -1)
			return;
		let tooltip = g_GameSettings.population.currentData.CapTooltip;
		if (this.canTotalPopExceedRecommendedMax())
			tooltip = setStringTags(this.WarningTooltip, this.WarningTags);

		this.dropdown.tooltip = tooltip;
	}


	canTotalPopExceedRecommendedMax()
	{
		const popCap = g_GameSettings.population.currentData.Options.List[this.dropdown.hovered];
		const nbPlayers = g_GameSettings.playerCount.nbPlayers;
		const nbTeams = g_GameSettings.playerTeam.values.reduce((teamList, team) => {
			if (!teamList.includes(team) || team == -1)
				teamList.push(team);
			return teamList;
		}, []).length;

		switch (g_GameSettings.population.capType)
		{
		case CAPTYPE_PLAYER_POPULATION: return nbPlayers * popCap > this.PopulationCapacityRecommendation;
		case CAPTYPE_TEAM_POPULATION: return nbTeams * popCap > this.PopulationCapacityRecommendation;
		case CAPTYPE_WORLD_POPULATION: return popCap > this.PopulationCapacityRecommendation;
		default: return false;
		}
	}

	onSelectionChange(itemIdx)
	{
		g_GameSettings.population.setPopCap(g_GameSettings.population.currentData.Options.List[itemIdx]);
		this.gameSettingsController.setNetworkInitAttributes();
	}
};

GameSettingControls.PopulationCap.prototype.PerPlayerCaption =
	translateWithContext("population limit", "Per Player");

GameSettingControls.PopulationCap.prototype.WarningTooltip =
	translate("Warning: These settings can result in significant lag when all players reach their maximum population capacity.");

GameSettingControls.PopulationCap.prototype.WarningTags = {
	"color": "orange"
};

/**
 * Total number of units that the engine can run with smoothly.
 * It means a 4v4 with 150 population can still run nicely, but more than that might "lag".
 */
GameSettingControls.PopulationCap.prototype.PopulationCapacityRecommendation = 1200;
