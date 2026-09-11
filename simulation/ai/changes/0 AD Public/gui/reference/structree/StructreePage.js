/**
 * This class represents the Structure Tree GUI page.
 *
 * Further methods are described within draw.js
 */
class StructreePage extends ReferencePage
{
	constructor(closePageCallback)
	{
		super(closePageCallback);

		this.structureBoxes = [];
		this.trainerBoxes = [];

		this.StructreePage = Engine.GetGUIObjectByName("structreePage");
		this.Background = Engine.GetGUIObjectByName("background");
		this.CivEmblem = Engine.GetGUIObjectByName("civEmblem");
		this.CivName = Engine.GetGUIObjectByName("civName");
		this.CivHistory = Engine.GetGUIObjectByName("civHistory");

		this.TrainerSection = new TrainerSection(this);
		this.TreeSection = new TreeSection(this);

		this.civSelection = new CivSelectDropdown(this.civData);
		if (!this.civSelection.hasCivs())
		{
			this.closePage();
			return;
		}
		this.civSelection.registerHandler(this.selectCiv.bind(this));

		const civInfoButton = new CivInfoButton(this);
		const closeButton = new CloseButton(this);
		Engine.SetGlobalHotkey("structree", "Press", this.closePage.bind(this));
	}

	closePage()
	{
		this.closePageCallback({
			"page": "page_structree.xml",
			"args": {
				"civ": this.activeCiv
			}
		});
	}

	selectCiv(civCode)
	{
		this.setActiveCiv(civCode);

		this.CivEmblem.sprite = "stretched:" + this.civData[this.activeCiv].Emblem;
		this.CivName.caption = this.civData[this.activeCiv].Name;
		this.CivHistory.caption = this.civData[this.activeCiv].History || "";

		const templateLists = this.TemplateLister.getTemplateLists(this.activeCiv);
		this.TreeSection.draw(templateLists.structures, this.activeCiv);
		this.TrainerSection.draw(templateLists.units, this.activeCiv);
	}
}

StructreePage.prototype.CloseButtonTooltip =
	translate("%(hotkey)s: Close Structure Tree.");

// Gap between the `TreeSection` and `TrainerSection` gui objects (when the latter is visible)
StructreePage.prototype.SectionGap = 12;

// Margin around the edge of the structree on lower resolutions,
// preventing the UI from being clipped by the edges of the screen.
StructreePage.prototype.BorderMargin = 16;
