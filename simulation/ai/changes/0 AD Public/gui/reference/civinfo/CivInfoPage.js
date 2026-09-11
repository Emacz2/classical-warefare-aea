class CivInfoPage extends ReferencePage
{
	constructor(closePageCallback)
	{
		super(closePageCallback);

		this.civSelection = new CivSelectDropdown(this.civData);
		if (!this.civSelection.hasCivs())
		{
			this.closePage();
			return;
		}
		this.civSelection.registerHandler(this.selectCiv.bind(this));

		this.CivEmblem = Engine.GetGUIObjectByName("civEmblem");
		this.CivName = Engine.GetGUIObjectByName("civName");
		this.CivHistory = Engine.GetGUIObjectByName("civHistory");

		this.gameplaySection = new GameplaySection(this);

		const structreeButton = new StructreeButton(this);
		const closeButton = new CloseButton(this);
		Engine.SetGlobalHotkey("civinfo", "Press", this.closePage.bind(this));
	}

	switchToStructreePage()
	{
		this.closePageCallback({
			"nextPage": "page_structree.xml",
			"args": {
				"civ": this.activeCiv
			}
		});
	}

	closePage()
	{
		this.closePageCallback({
			"page": "page_civinfo.xml",
			"args": {
				"civ": this.activeCiv
			}
		});
	}

	/**
	 * Updates the GUI after the user selected a civ from dropdown.
	 *
	 * @param code {string}
	 */
	selectCiv(civCode)
	{
		this.setActiveCiv(civCode);

		this.CivEmblem.sprite = "stretched:" + this.civData[this.activeCiv].Emblem;
		this.CivName.caption = this.civData[this.activeCiv].Name;
		this.CivHistory.caption = this.civData[this.activeCiv].History || "";

		const civInfo = this.civData[civCode];

		if (!civInfo)
			error(sprintf("Error loading civ data for \"%(code)s\"", { "code": civCode }));

		this.gameplaySection.update(this.activeCiv, civInfo);
	}

	/**
	 * Give the first character a larger font.
	 */
	bigFirstLetter(text, size)
	{
		return setStringTags(text[0], { "font": "sans-bold-" + (size + 6) }) + text.substring(1);
	}

	/**
	 * Set heading font - bold and mixed caps
	 *
	 * @param text {string}
	 * @param size {number} - Font size
	 * @returns {string}
	 */
	formatHeading(text, size)
	{
		const textArray = [];

		for (let word of text.split(" "))
		{
			const wordCaps = word.toUpperCase();

			// Usually we wish a big first letter, however this isn't always desirable. Check if
			// `.toLowerCase()` changes the character to avoid false positives from special characters.
			if (word.length && word[0].toLowerCase() != word[0])
				word = this.bigFirstLetter(wordCaps, size);

			textArray.push(setStringTags(word, { "font": "sans-bold-" + size }));
		}

		return textArray.join(" ");
	}

	/**
	 * @returns {string}
	 */
	formatEntry(name, tooltip, description)
	{
		let tooltip_icon = "";
		if (tooltip)
			tooltip_icon = '[icon="iconInfo" tooltip="' + escapeQuotation(tooltip) + '" tooltip_style="civInfoTooltip"]';

		let description_text = "";
		if (description)
			// Translation: Description of an item in the CivInfo page, on a new line and indented.
			description_text = sprintf(translate('\n     %(description)s'), { "description": description, });

		return sprintf(
			// Translation: An entry in the CivInfo Page. The newline and indentation of the description is handled elsewhere.
			// Example:
			// > • Name of a Special Something (i)
			// >     A brief description of the aforementioned something.
			translate("• %(name)s %(info_icon)s%(description)s"),
			{
				"name": setStringTags(name, { "font": "sans-bold-14" }),
				"info_icon": tooltip_icon,
				"description": description_text,
			}
		);
	}
}

CivInfoPage.prototype.CloseButtonTooltip =
	translate("%(hotkey)s: Close Civilization Overview.");

CivInfoPage.prototype.SectionHeaderSize = 16;
CivInfoPage.prototype.SubsectionHeaderSize = 12;
