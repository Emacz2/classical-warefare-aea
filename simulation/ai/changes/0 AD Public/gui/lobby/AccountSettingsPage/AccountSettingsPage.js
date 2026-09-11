/**
 * The account settings page allows the player to change some of their account settings.
 */
var AccountSettingsPage = {
	async openPage(xmppMessages)
	{
		const pageElement = Engine.GetGUIObjectByName("accountSettingsPage");
		const requestResult = Engine.GetGUIObjectByName("as_RequestResult");

		try
		{
			pageElement.hidden = false;
			pageElement.onTick = updateTimers;
			await Promise.race([
				new Promise(resolve => {
					Engine.SetGlobalHotkey("cancel", "Press", resolve);
					Engine.GetGUIObjectByName("as_Close").onPress = resolve;
				}),
				AccountSettingsPage._changePasswordLoop(requestResult, xmppMessages)
			]);
		}
		finally
		{
			requestResult.caption = "";
			pageElement.hidden = true;
		}
	},

	async _changePasswordLoop(...args)
	{
		const changePasswordButton = Engine.GetGUIObjectByName("as_ChangePasswordBtn");
		while (true)
		{
			await new Promise(resolve => {
				changePasswordButton.onPress = resolve;
			});
			try
			{
				changePasswordButton.enabled = false;
				await AccountSettingsPage._changePassword(...args);
			}
			finally
			{
				changePasswordButton.enabled = true;
			}
		}
	},

	async _changePassword(requestResult, xmppMessages)
	{
		const SetPasswordError = class extends Error{};
		let timeout;
		try
		{
			requestResult.textcolor = "white";
			requestResult.caption = translate("Changing password…");
			const encryptedPassword = AccountSettingsPage._readAndValidatePassword(SetPasswordError);
			Engine.LobbyChangePassword(encryptedPassword);
			await new Promise((resolve, reject) => {
				xmppMessages.registerXmppMessageHandler("system", "registered", resolve);
				xmppMessages.registerXmppMessageHandler("system", "error", message => {
					reject(new SetPasswordError(message.text));
				});
				timeout = setTimeout(reject.bind(null,
					new SetPasswordError(translate("Request timed out."))), 30000);
			});
			requestResult.caption = translate("Password changed successfully.");
			const rememberPassword = Engine.ConfigDB_GetValue("user", "lobby.rememberpassword");
			const functionSufix = rememberPassword === "true" ? "CreateValue" : "RemoveValue";
			Engine["ConfigDB_" + functionSufix]("user", "lobby.password", encryptedPassword);
			Engine.ConfigDB_SaveChanges("user");
		}
		catch (e)
		{
			if (e instanceof SetPasswordError)
			{
				requestResult.textcolor = "red";
				requestResult.caption = e.message;
			}
			else
			{
				requestResult.caption = "";
				error(uneval(e));
			}
		}
		finally
		{
			clearTimeout(timeout);
		}
	},

	_readAndValidatePassword(SetPasswordError)
	{
		const newPass = Engine.GetGUIObjectByName("as_PasswordInput").caption;
		if (newPass.length < minimumPasswordLength)
			throw new SetPasswordError(translate("Please choose a longer password"));

		if (Engine.GetGUIObjectByName("as_PasswordInputConfirm").caption !== newPass)
			throw new SetPasswordError(translate("Passwords do not match"));

		return Engine.EncryptPassword(newPass, Engine.LobbyGetUsername());
	}
};
