class Emblem
{
	constructor(page, emblemNum)
	{
		this.page = page;

		this.Emblem = Engine.GetGUIObjectByName("emblem[" + emblemNum + "]");
		this.EmblemImage = this.Emblem.children[0];
		this.EmblemCaption = this.Emblem.children[1];

		const size = this.Emblem.size;
		this.cx = (size.right - size.left) / 2;
		this.cy = (size.bottom - size.top) / 2;
	}

	setCiv(civCode, civData)
	{
		const template = this.page.TemplateParser.getEntity(this.CatafalqueTemplateMethod(civCode), civCode);
		if (!template)
			return false;

		this.EmblemImage.sprite = "stretched:" + civData.Emblem;
		this.EmblemImage.tooltip = getAurasTooltip(template);
		this.EmblemCaption.caption = getEntityPrimaryNameFormatted(template);
		this.Emblem.hidden = false;
		return true;
	}

	setPosition(x, y)
	{
		Object.assign(this.Emblem.size, {
			"left": x - this.cx,
			"top": y - this.cy,
			"right": x + this.cx,
			"bottom": y + this.cy
		});
	}
}

Emblem.prototype.CatafalqueTemplateMethod =
	civCode => "units/" + civCode + "/catafalque";
