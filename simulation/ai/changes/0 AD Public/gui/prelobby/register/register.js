function init()
{
	Engine.GetGUIObjectByName("continue").caption = translate("Register");

	initLobbyTerms();

	initRememberPassword();

	updateFeedback();

	return Promise.race([ onRegistered(), cancelButton() ]);
}

function updateFeedback()
{
	setFeedback(checkUsername(true) || checkPassword(true) || checkPasswordConfirmation() || checkTerms());
}

function onUsernameEdit()
{
	updateFeedback();
}

function continueButton()
{
	setFeedback(translate("Registering…"));

	Engine.StartRegisterXmppClient(
		Engine.GetGUIObjectByName("username").caption,
		getEncryptedPassword());

	Engine.ConnectXmppClient();
}

async function onRegistered()
{
	await new Promise(resolve => { g_LobbyMessages.registered = resolve; });
	saveCredentials();

	setFeedback(translate("Registered"));

	Engine.StopXmppClient();
	return true;
}
