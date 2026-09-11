/**
 * This class is concerned with choosing and displaying tips about how to play the game.
 * This includes a text and one or more images.
 */
class TipDisplay
{
	/**
	 * @param {boolean} initData.tipScrolling - Whether or not to enable the player to scroll through the tips and the tip images.
	 * @param {boolean} initData.isOnLoadingScreen - Whether or not the tip display is initialized by the game loading screen.
	 * @param {Array|undefined} hotloadData.tipFilesData - Hotloaded value storing last time's tipFilesData.
	 * @param {number|undefined} hotloadData.tipIndex - Hotloaded value pointing to a specific tip.
	 * @param {number|undefined} hotloadData.tipImageIndex - Hotloaded value pointing to a specific tip image.
	 */
	constructor(initData, hotloadData)
	{
		this.tipImage = Engine.GetGUIObjectByName("tipImage");
		this.tipTitle = Engine.GetGUIObjectByName("tipTitle");
		this.tipTitleDecoration = Engine.GetGUIObjectByName("tipTitleDecoration");
		this.tipText = Engine.GetGUIObjectByName("tipText");
		this.tipImageText = Engine.GetGUIObjectByName("tipImageText");
		this.previousTipButton = Engine.GetGUIObjectByName("previousTipButton");
		this.imageControlPanel = Engine.GetGUIObjectByName("imageControlPanel");
		this.nextTipButton = Engine.GetGUIObjectByName("nextTipButton");
		this.previousImageButton = Engine.GetGUIObjectByName("previousImageButton");
		this.nextImageButton = Engine.GetGUIObjectByName("nextImageButton");

		this.previousTipButton.caption = this.CaptionPreviousTip;
		this.nextTipButton.caption = this.CaptionNextTip;

		this.previousTipButton.tooltip = colorizeHotkey("%(hotkey)s: ", "item.prev") + this.TooltipPreviousTip;
		this.nextTipButton.tooltip = colorizeHotkey("%(hotkey)s: ", "item.next") + this.TooltipNextTip;
		this.previousImageButton.tooltip = this.TooltipPreviousImage;
		this.nextImageButton.tooltip = this.TooltipNextImage;

		if (initData.isOnLoadingScreen)
			this.tipFilesData = this.getLoadingScreenTip();
		else
			this.tipFilesData =
				hotloadData?.tipFilesData ||
				shuffleArray(Engine.ReadJSONFile(this.TipFilesDataFile).map(category => category.files).flat().map(tip => {
					tip.imageFiles = shuffleArray(tip.imageFiles);
					return tip;
				}));

		this.currentTip = {};
		this.tipIndex = -1;
		this.tipImageIndex = -1;

		this.enableTipScrolling = initData.tipScrolling;
		const hideButtons = !initData.tipScrolling || this.tipFilesData.length < 2;
		this.previousTipButton.hidden = hideButtons;
		this.nextTipButton.hidden = hideButtons;

		this.previousTipButton.onPress = () => this.onTipIndexChange(-1);
		this.nextTipButton.onPress = () => this.onTipIndexChange(1);
		this.previousImageButton.onPress = () => this.onTipImageIndexChange(-1);
		this.nextImageButton.onPress = () => this.onTipImageIndexChange(1);

		this.onTipIndexChange(hotloadData?.tipIndex ? hotloadData.tipIndex + 1 : 1);
		if (hotloadData?.tipImageIndex)
			this.onTipImageIndexChange(hotloadData.tipImageIndex + 1);
	}

	/**
	 * Returns a randomized tip from a category.
	 * Choosing a category is randomized based on it occurrence probability.
	 * @returns {Array} - An array with a single element containing a tip object.
	 */
	getLoadingScreenTip()
	{
		const tipFiles = Engine.ReadJSONFile(this.TipFilesDataFile);
		const category = this.getRandomWeightedCategory(tipFiles, Engine.HasNetClient());
		const randomTip = pickRandom(category.files);
		randomTip.imageFiles = shuffleArray(randomTip.imageFiles);
		return [randomTip];
	}

	/**
	 * Returns a randomized category from an array of categories based on the probability weight.
	 * @param {boolean} isMultiplayer - True if we want to include the multiplayer category.
	 * @param {Array} tipFiles - An array containing all categories from the TipFilesDataFile.
	 * @returns {Object} - A randomized category object.
	 */
	getRandomWeightedCategory(tipFiles, isMultiplayer)
	{
		const totalProbability = tipFiles.reduce((sum, category) => sum + (isMultiplayer ? category.loadingScreenOccurrence_MP : category.loadingScreenOccurrence_SP), 0);
		const random = Math.random() * totalProbability;

		let cumulative = 0;
		for (const category of tipFiles)
		{
			cumulative += (isMultiplayer ? category.loadingScreenOccurrence_MP : category.loadingScreenOccurrence_SP);
			if (random <= cumulative)
				return category;
		}
		return undefined;
	}

	getHotloadData()
	{
		return {
			"tipFilesData": this.tipFilesData,
			"tipIndex": this.tipIndex,
			"tipImageIndex": this.tipImageIndex
		};
	}

	onTipIndexChange(number)
	{
		this.tipIndex += number;
		this.tipIndex = Math.max(0, Math.min(this.tipIndex, this.tipFilesData.length - 1));
		this.currentTip = this.tipFilesData[this.tipIndex];

		this.updateTipText();
		this.rebuildTipButtons();
		this.onTipImageIndexChange(-this.tipImageIndex);
	}

	onTipImageIndexChange(number)
	{
		this.tipImageIndex += number;
		this.tipImageIndex = Math.max(0, Math.min(this.tipImageIndex, this.currentTip.imageFiles.length - 1));

		this.updateTipImage();
		this.rebuildTipImageButtons();
	}

	updateTipText()
	{
		const tipText = Engine.TranslateLines(Engine.ReadFile(this.TextPath + this.currentTip.textFile)).split("\n");

		this.tipTitle.caption = tipText.shift();
		this.scaleGuiElementsToFit();
		this.tipText.caption = tipText.map(text =>
			text && "[icon=\"BulletPoint\"] " + text).join("\n\n");
	}

	updateTipImage()
	{
		this.tipImage.sprite = "stretched:" + this.ImagePath + this.currentTip.imageFiles[this.tipImageIndex];
		this.imageControlPanel.hidden = !this.enableTipScrolling || this.currentTip.imageFiles.length === 1;

		if (!this.imageControlPanel.hidden)
			this.tipImageText.caption = (this.tipImageIndex + 1) + "  /  " + this.currentTip.imageFiles.length;
	}

	rebuildTipButtons()
	{
		this.previousTipButton.enabled = !this.previousTipButton.hidden && this.tipIndex !== 0;
		this.nextTipButton.enabled = !this.nextTipButton.hidden && this.tipIndex < this.tipFilesData.length - 1;
	}

	rebuildTipImageButtons()
	{
		this.previousImageButton.enabled = this.tipImageIndex > 0;
		this.nextImageButton.enabled = this.tipImageIndex < this.currentTip.imageFiles.length - 1;
	}

	scaleGuiElementsToFit()
	{
		const titleTextSize = this.tipTitle.getTextSize();
		this.tipTitle.size.bottom = this.tipTitle.size.top + titleTextSize.height;

		Object.assign(this.tipTitleDecoration.size, {
			"left": -(titleTextSize.width / 2 + 12),
			"top": this.tipTitle.size.bottom - 4,
			"right": titleTextSize.width / 2 + 12,
			"bottom": this.tipTitle.size.bottom + 12,
			"rleft": 50, "rtop": 0, "rright": 50, "rbottom": 0
		});

		this.tipText.size.top = this.tipTitleDecoration.size.bottom + 16;
	}

}

TipDisplay.prototype.CaptionPreviousTip = translateWithContext("button", "Previous");
TipDisplay.prototype.TooltipPreviousTip = translate("Switch to the previous tip.");
TipDisplay.prototype.CaptionNextTip = translateWithContext("button", "Next");
TipDisplay.prototype.TooltipNextTip = translate("Switch to the next tip.");

TipDisplay.prototype.TooltipPreviousImage = translate("Switch to the previous image.");
TipDisplay.prototype.TooltipNextImage = translate("Switch to the next image.");

/**
 * JSON file assigning one or more tip image files (.png) to each tip text file (.txt).
 */
TipDisplay.prototype.TipFilesDataFile = "gui/reference/tips/tipfiles.json";

/**
 * Directory storing .txt files containing the multi and single player tips.
 */
TipDisplay.prototype.TextPath = "gui/reference/tips/texts/";

/**
 * Subdirectory of art/textures/ui storing the .png images illustrating the tips.
 */
TipDisplay.prototype.ImagePath = "tips/";
