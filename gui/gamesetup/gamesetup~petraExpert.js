// Petra Expert AI difficulty patch for 0 A.D. A28.
// Loaded as a gamesetup append script so we do not replace gui/common/settings.js.

(function()
{
	if (typeof g_Settings != "undefined" &&
		g_Settings.AIDifficulties &&
		!g_Settings.AIDifficulties.some(difficulty => difficulty.Name == "expert"))
	{
		g_Settings.AIDifficulties.push({
			"Name": "expert",
			"Title": translateWithContext("aiDiff", "Expert")
		});
	}

	if (typeof AIGameSettingControls != "undefined" &&
		AIGameSettingControls.AIDifficulty)
	{
		AIGameSettingControls.AIDifficulty.prototype.render = function()
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
		};
	}
})();
