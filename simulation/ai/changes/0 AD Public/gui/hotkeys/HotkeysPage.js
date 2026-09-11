class HotkeysPage
{
	constructor(metadata, closePageCallback)
	{
		this.metadata = metadata;

		Engine.GetGUIObjectByName("hotkeyList").onMouseLeftDoubleClickItem = () => {
			const idx = Engine.GetGUIObjectByName("hotkeyList").selected;
			const picker = new HotkeyPicker(
				this.metadata,
				this.onHotkeyPicked.bind(this),
				Engine.GetGUIObjectByName("hotkeyList").list_data[idx],
				clone(this.hotkeys[Engine.GetGUIObjectByName("hotkeyList").list_data[idx]])
			);
		};
		Engine.GetGUIObjectByName("hotkeyList").onHoverChange = () => this.onHotkeyHover();

		Engine.GetGUIObjectByName("hotkeyFilter").onSelectionChange = () => this.setupHotkeyList();
		Engine.GetGUIObjectByName("hotkeyFilter").onHoverChange = () => this.onFilterHover();

		Engine.GetGUIObjectByName("hotkeyTextFilter").onTextEdit = () => this.setupHotkeyList();

		this.saveButton = Engine.GetGUIObjectByName("hotkeySave");
		this.saveButton.enabled = false;

		Engine.GetGUIObjectByName("hotkeyClose").onPress = closePageCallback;
		Engine.GetGUIObjectByName("hotkeyReset").onPress = () => this.resetUserHotkeys();
		this.saveButton.onPress = () => {
			this.saveUserHotkeys();
			this.saveButton.enabled = false;
		};

		this.setupHotkeyData();
		this.setupFilters();
		this.setupHotkeyList();
	}

	setupHotkeyData()
	{
		const hotkeydata = Engine.GetHotkeyMap();
		this.hotkeys = hotkeydata;
		const categories = clone(this.metadata.categories);
		for (const name in categories)
			categories[name].hotkeys = [];
		// Add hotkeys defined in the metadata but not in the C++ map.
		for (const hotkeyName in this.metadata.hotkeys)
			if (!this.hotkeys[hotkeyName])
				this.hotkeys[hotkeyName] = [];
		for (const hotkeyName in this.hotkeys)
		{
			if (this.metadata.hotkeys[hotkeyName])
				for (const cat of this.metadata.hotkeys[hotkeyName].categories)
					categories[cat].hotkeys.push(hotkeyName);
			else
				categories[this.metadata.DEFAULT_CATEGORY].hotkeys.push(hotkeyName);
		}
		for (const cat in categories)
			categories[cat].hotkeys.sort((a, b) => {
				if (!this.metadata.hotkeys[a] || !this.metadata.hotkeys[b])
					return !this.metadata.hotkeys[a] ? 1 : -1;
				return this.metadata.hotkeys[a].order - this.metadata.hotkeys[b].order;
			});
		for (const cat in categories)
			if (categories[cat].hotkeys.length === 0)
				delete categories[cat];
		this.categories = categories;
	}

	setupFilters()
	{
		const dropdown = Engine.GetGUIObjectByName("hotkeyFilter");
		const names = [];
		for (const cat in this.categories)
			names.push(translateWithContext("hotkey metadata", this.categories[cat].name));
		dropdown.list = [translate("All Hotkeys")].concat(names);
		dropdown.list_data = [-1].concat(Object.keys(this.categories));
		dropdown.selected = 0;
	}

	setupHotkeyList()
	{
		const hotkeyList = Engine.GetGUIObjectByName("hotkeyList");
		hotkeyList.selected = -1;
		const textFilter = Engine.GetGUIObjectByName("hotkeyTextFilter").caption.toLowerCase();

		let hotkeys;
		const dropdown = Engine.GetGUIObjectByName("hotkeyFilter");
		if (dropdown.selected && dropdown.selected !== 0)
			hotkeys = this.categories[dropdown.list_data[dropdown.selected]].hotkeys;
		else
			hotkeys = Object.values(this.categories).map(x => x.hotkeys).flat();
		hotkeys = hotkeys.filter(x => {
			return x.indexOf(textFilter) !== -1 ||
				translateWithContext("hotkey metadata", this.metadata.hotkeys[x]?.name || x).toLowerCase().indexOf(textFilter) !== -1;
		});

		hotkeyList.list_name = hotkeys.map(x => translateWithContext("hotkey metadata", this.metadata.hotkeys[x]?.name || x));
		hotkeyList.list_mapping = hotkeys.map(x => formatHotkeyCombinations(this.hotkeys[x]));
		hotkeyList.list = hotkeys.map(() => 0);
		hotkeyList.list_data = hotkeys.map(x => x);
	}

	onFilterHover()
	{
		const dropdown = Engine.GetGUIObjectByName("hotkeyFilter");
		if (dropdown.hovered === -1)
			dropdown.tooltip = "";
		else if (dropdown.hovered === 0)
			dropdown.tooltip = translate("All available hotkeys.");
		else
			dropdown.tooltip = translateWithContext("hotkey metadata", this.categories[dropdown.list_data[dropdown.hovered]].desc);
	}

	onHotkeyHover()
	{
		const hotkeyList = Engine.GetGUIObjectByName("hotkeyList");
		if (hotkeyList.hovered === -1)
			hotkeyList.tooltip = "";
		else
		{
			const hotkey = hotkeyList.list_data[hotkeyList.hovered];
			hotkeyList.tooltip = this.metadata.hotkeys[hotkey]?.desc ?
				translateWithContext("hotkey metadata", this.metadata.hotkeys[hotkey]?.desc) :
				translate(this.UnavailableTooltipString);
		}
	}

	onHotkeyPicked(picker, success)
	{
		picker.close();
		if (!success)
			return;

		// Remove empty combinations which the picker added.
		picker.combinations = picker.combinations.filter(x => x.length);

		this.hotkeys[picker.name] = picker.combinations;

		this.saveButton.enabled = true;
		this.setupHotkeyList();
	}

	async resetUserHotkeys()
	{
		const buttonIndex = await messageBox(
			400, 200,
			translate("Reset all hotkeys to default values?\nWARNING: this cannot be reversed."),
			translate("Confirmation"),
			[translate("No"), translate("Yes")]);
		if (buttonIndex === 0)
			return;

		for (const cat in this.categories)
			this.categories[cat].hotkeys.forEach((name) => {
				Engine.ConfigDB_RemoveValue("user", "hotkey." + name);
			});
		Engine.ConfigDB_SaveChanges("user");
		Engine.ReloadHotkeys();
		this.saveButton.enabled = false;
		this.setupHotkeyData();
		this.setupHotkeyList();
	}

	saveUserHotkeys()
	{
		for (const hotkey in this.hotkeys)
			Engine.ConfigDB_RemoveValue("user", "hotkey." + hotkey);
		Engine.ReloadHotkeys();
		const defaultData = Engine.GetHotkeyMap();
		for (const hotkey in this.hotkeys)
		{
			const keymap = formatHotkeyCombinations(this.hotkeys[hotkey], false);
			if (keymap.join("") !== formatHotkeyCombinations(defaultData[hotkey], false).join(""))
				Engine.ConfigDB_CreateValues("user", "hotkey." + hotkey, keymap);
		}
		Engine.ConfigDB_SaveChanges("user");
		Engine.ReloadHotkeys();
	}
}


function init()
{
	return new Promise(closePageCallback => {
		// FIXME: There are proposals to remove init and allowing to specify
		// controller classes in the gui xml, therefore leave it as a class and
		// suppress the warning.
		/* eslint-disable-next-line no-new */
		new HotkeysPage(new HotkeyMetadata(), closePageCallback);
	});
}

HotkeysPage.prototype.UnavailableTooltipString = markForTranslation("No tooltip available.");
