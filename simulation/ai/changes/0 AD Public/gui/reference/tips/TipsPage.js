class TipsPage
{
	constructor(initData, hotloadData, closePageCallback)
	{
		this.closePageCallback = closePageCallback;
		this.tipDisplay = new TipDisplay(initData, hotloadData);
		this.closeButton = new CloseButton(this);
	}

	closePage()
	{
		this.closePageCallback("page_tips.xml");
	}
}

TipsPage.prototype.CloseButtonTooltip = translate("%(hotkey)s: Close Tips and Tricks.");
