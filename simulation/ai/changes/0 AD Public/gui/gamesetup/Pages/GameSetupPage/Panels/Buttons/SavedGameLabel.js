class SavedGameLabel
{
	constructor(isSavedGame)
	{
		const maxWidth = 140;
		const marginRight = 8;

		const bottomRightPanel = Engine.GetGUIObjectByName("bottomRightPanel");
		const savedGameLabel = Engine.GetGUIObjectByName("savedGameLabel");
		const labelWidth = Math.min(savedGameLabel.getPreferredTextSize().width + 10, maxWidth);

		if (isSavedGame)
		{
			savedGameLabel.parent.size = {
				"left": bottomRightPanel.size.left - labelWidth - marginRight,
				"top": savedGameLabel.parent.size.top,
				"right": bottomRightPanel.size.left - marginRight,
				"bottom": savedGameLabel.parent.size.bottom,
				"rleft": bottomRightPanel.size.rleft,
				"rtop": savedGameLabel.parent.size.rtop,
				"rright": bottomRightPanel.size.rleft,
				"rbottom": savedGameLabel.parent.size.rbottom
			};
			savedGameLabel.hidden = false;
		}
	}
}
