let infomenu =  {
		"caption": translate("Mod Info"),
		"tooltip": translate("View the changes that this mod brings to the game."),
		"onPress": () => {
			Engine.OpenChildPage("page_infomenu.xml");
		}
	};

mainMenuItems.unshift(infomenu)
