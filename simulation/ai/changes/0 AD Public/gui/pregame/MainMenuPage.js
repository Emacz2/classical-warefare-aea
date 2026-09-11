import { BackgroundHandler } from "gui/pregame/BackgroundHandler.js";
import { MainMenuItemHandler } from "gui/pregame/MainMenuItemHandler.js";
import { SplashScreenHandler } from "gui/pregame/SplashscreenHandler.js";

function initMusic()
{
	globalThis.initMusic();
	globalThis.music.setState(global.music.states.MENU);
}

function initProjectInformation(projectInformation)
{
	for (const objectName in projectInformation)
		for (const propertyName in projectInformation[objectName])
			Engine.GetGUIObjectByName(objectName)[propertyName] = projectInformation[objectName][propertyName];
}

function initCommunityButton(communityButtons)
{
	const buttons = Engine.GetGUIObjectByName("communityButtons").children;

	communityButtons.forEach((buttonInfo, i) => {
		const button = buttons[i];
		button.hidden = false;
		for (const propertyName in buttonInfo)
			button[propertyName] = buttonInfo[propertyName];
	});

	if (buttons.length < communityButtons.length)
		error("GUI page has space for " + buttons.length + " community buttons, but " + menuItems.length + " items are provided!");
}

/**
 * This is the handler that coordinates all other handlers on this GUI page.
 */
export class MainMenuPage
{
	constructor(closePageCallback, data, hotloadData, mainMenuItems, backgroundLayerData,
		projectInformation, communityButtons)
	{
		this.backgroundHandler = new BackgroundHandler(pickRandom(backgroundLayerData));
		this.menuHandler = new MainMenuItemHandler(closePageCallback, mainMenuItems);
		this.splashScreenHandler = new SplashScreenHandler(data, hotloadData && hotloadData.splashScreenHandler);

		initMusic();
		initProjectInformation(projectInformation);
		initCommunityButton(communityButtons);
	}

	getHotloadData()
	{
		return {
			"splashScreenHandler": this.splashScreenHandler.getHotloadData()
		};
	}
}
