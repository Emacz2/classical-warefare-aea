/**
 * Manages the maximum population capacity.
 * This includes the cap value itself and its type (determining how to distribute the set cap among players).
 * TODO: Should there be a dialog allowing per-player pop limits?
 */
GameSettings.prototype.Attributes.Population = class Population extends GameSetting
{
	init()
	{
		this.perPlayer = null;
		this.capTypeDefault = this.getDefaultValue("PopulationCapacities", "Name");
		this.setPopCapType(this.capTypeDefault);
		this.settings.map.watch(() => this.onMapChange(), ["map"]);
	}

	toInitAttributes(attribs)
	{
		attribs.settings.PopulationCapType = this.capType;
		if (this.perPlayer)
		{
			if (!attribs.settings.PlayerData)
				attribs.settings.PlayerData = [];
			while (attribs.settings.PlayerData.length < this.perPlayer.length)
				attribs.settings.PlayerData.push({});
			for (const i in this.perPlayer)
				if (this.perPlayer[i])
					attribs.settings.PlayerData[i].PopulationLimit = this.perPlayer[i];
		}
		else
			attribs.settings.PopulationCap = this.cap;
	}

	fromInitAttributes(attribs)
	{
		if (this.getLegacySetting(attribs, "PopulationCapType") !== undefined)
			this.setPopCapType(this.getLegacySetting(attribs, "PopulationCapType"));

		if (this.getLegacySetting(attribs, "PopulationCap") !== undefined)
			this.setPopCap(this.getLegacySetting(attribs, "PopulationCap"));
	}

	onMapChange()
	{
		this.perPlayer = null;
		if (this.settings.map.type != "scenario")
			return;

		if (this.getMapSetting("PlayerData")?.some(data => data.PopulationLimit))
		{
			this.perPlayer = this.getMapSetting("PlayerData").map(data => data.PopulationLimit || undefined);
			return;
		}

		this.setPopCapType(this.getMapSetting("PopulationCapType") || this.capTypeDefault);
		if (this.getMapSetting("PopulationCap"))
			this.setPopCap(this.getMapSetting("PopulationCap"));
	}

	setPopCap(cap)
	{
		this.cap = cap;
	}

	setPopCapType(capType)
	{
		this.capType = capType;
		this.currentData = g_Settings.PopulationCapacities.find(type => type.Name == capType);
		this.setPopCap(this.currentData.Options.Default);
	}
};
