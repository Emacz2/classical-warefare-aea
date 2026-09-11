class AIGameSettingControlDropdown extends GameSettingControlDropdown
{
	onOpenPage(playerIndex, enabled)
	{
		this.setEnabled(enabled);
		this.playerIndex = playerIndex;
		this.render();
	}

	/**
	 * Overloaded: no need to trigger a relayout,
	 * but updateVisibility must be called manually
	 * as the AI control manager does not subscribe to updateLayout.
	 */
	setHidden(hidden)
	{
		this.hidden = hidden;
		this.updateVisibility();
	}

	setControl(aiConfigPage)
	{
		aiConfigPage.registerOpenPageHandler(this.onOpenPage.bind(this));

		const i = aiConfigPage.getRow();

		this.frame = Engine.GetGUIObjectByName("aiSettingFrame[" + i + "]");
		this.title = this.frame.children[0];
		this.dropdown = this.frame.children[1];
		this.label = this.frame.children[2];

		this.frame.size.top = i * (this.Height + this.Margin);
		this.frame.size.bottom = this.frame.size.top + this.Height;

		this.setHidden(false);
	}
}

AIGameSettingControlDropdown.prototype.Height= 28;

AIGameSettingControlDropdown.prototype.Margin= 7;
