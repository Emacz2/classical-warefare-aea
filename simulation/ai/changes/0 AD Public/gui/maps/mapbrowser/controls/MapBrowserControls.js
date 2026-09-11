class MapBrowserPageControls
{
	constructor(mapBrowserPage, gridBrowser)
	{
		for (const name in this)
			this[name] = new this[name](mapBrowserPage, gridBrowser);

		this.mapBrowserPage = mapBrowserPage;
		this.gridBrowser = gridBrowser;

		this.setupButtons();

		const alignmentHelper = new AlignmentHelper("max");
		const labelMargin = 5;

		this.mapBrowserSearchBoxLabel = Engine.GetGUIObjectByName("mapBrowserSearchBoxLabel");
		this.mapBrowserSearchBoxControl = Engine.GetGUIObjectByName("mapBrowserSearchBoxControl");
		alignmentHelper.setObject(this.mapBrowserSearchBoxControl, "left", this.mapBrowserSearchBoxLabel.size.right + labelMargin);

		this.mapBrowserMapTypeLabel = Engine.GetGUIObjectByName("mapBrowserMapTypeLabel");
		this.mapBrowserMapTypeControl = Engine.GetGUIObjectByName("mapBrowserMapTypeControl");
		alignmentHelper.setObject(this.mapBrowserMapTypeControl, "left", this.mapBrowserMapTypeLabel.size.right + labelMargin);

		this.mapBrowserMapFilterLabel = Engine.GetGUIObjectByName("mapBrowserMapFilterLabel");
		this.mapBrowserMapFilterControl = Engine.GetGUIObjectByName("mapBrowserMapFilterControl");
		alignmentHelper.setObject(this.mapBrowserMapFilterControl, "left", this.mapBrowserMapFilterLabel.size.right + labelMargin);
	}

	setupButtons()
	{
		this.pickRandom = Engine.GetGUIObjectByName("mapBrowserPagePickRandom");
		this.pickRandom.onPress = () => {
			const index = randIntInclusive(0, this.gridBrowser.itemCount - 1);
			this.gridBrowser.setSelectedIndex(index);
			this.gridBrowser.goToPageOfSelected();
		};

		this.select = Engine.GetGUIObjectByName("mapBrowserPageSelect");
		this.select.onPress = () => this.onSelect();

		this.close = Engine.GetGUIObjectByName("mapBrowserPageClose");
		this.close.onPress = () => this.mapBrowserPage.closePage();

		this.mapBrowserPage.registerOpenPageHandler(this.onOpenPage.bind(this));
		this.gridBrowser.registerSelectionChangeHandler(() => this.onSelectionChange());
	}

	onOpenPage(allowSelection)
	{
		this.pickRandom.hidden = !allowSelection;
		this.select.hidden = !allowSelection;

		const usedCaptions = allowSelection ? MapBrowserPageControls.Captions.cancel :
			MapBrowserPageControls.Captions.close;

		this.close.caption = usedCaptions.caption;
		this.close.tooltip = colorizeHotkey(usedCaptions.tooltip, "cancel");
	}

	onSelectionChange()
	{
		this.select.enabled = this.gridBrowser.selected != -1;
	}

	onSelect()
	{
		this.mapBrowserPage.submitMapSelection();
	}

	static Captions =
		{
			"close":
		{
			"caption": translate("Close"),
			"tooltip": translate("%(hotkey)s: Close map browser.")
		},
			"cancel":
		{
			"caption": translate("Cancel"),
			"tooltip": translate("%(hotkey)s: Close map browser and discard the selection.")
		}
		};
}
