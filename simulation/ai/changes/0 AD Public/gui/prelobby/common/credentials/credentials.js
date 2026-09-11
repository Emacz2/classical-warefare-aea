function checkUsername(register)
{
	const username = Engine.GetGUIObjectByName("username").caption;
	if (!username)
		return translate("Please enter your username");

	if (register && !username.match(/^(?=.*[a-z])[a-z0-9._-]{3,20}$/i))
		return translate("Invalid username");

	return "";
}

function checkPassword(register)
{
	const password = Engine.GetGUIObjectByName("password").caption;

	if (!password)
		return register ?
			translateWithContext("register", "Please enter your password") :
			translateWithContext("login", "Please enter your password");

	if (register && password.length < minimumPasswordLength)
		return translate("Please choose a longer password");

	return "";
}

function checkPasswordConfirmation()
{
	const password1 = Engine.GetGUIObjectByName("password").caption;
	if (!password1)
		return translate("Please enter your password again");

	const password2 = Engine.GetGUIObjectByName("passwordRepeat").caption;
	if (password1 != password2)
		return translate("Passwords do not match");

	return "";
}

function initRememberPassword()
{
	Engine.GetGUIObjectByName("rememberPassword").checked =
		Engine.ConfigDB_GetValue("user", "lobby.rememberpassword") == "true";
}

async function toggleRememberPassword()
{
	const checkbox = Engine.GetGUIObjectByName("rememberPassword");
	const enabled = Engine.ConfigDB_GetValue("user", "lobby.rememberpassword") == "true";
	if (!checkbox.checked && enabled && Engine.ConfigDB_GetValue("user", "lobby.password"))
	{
		const buttonIndex = await messageBox(
			360, 160,
			translate("Are you sure you want to delete the password after connecting?"),
			translate("Confirmation"),
			[translate("No"), translate("Yes")]);

		if (buttonIndex === 0)
		{
			checkbox.checked = true;
			return;
		}
	}

	Engine.ConfigDB_CreateAndSaveValue("user", "lobby.rememberpassword", String(!enabled));
}

function getEncryptedPassword()
{
	const typedUnencryptedPassword = Engine.GetGUIObjectByName("password").caption;
	const storedEncryptedPassword = Engine.ConfigDB_GetValue("user", "lobby.password");

	if (typedUnencryptedPassword == storedEncryptedPassword.substr(0, 10))
		return storedEncryptedPassword;

	return Engine.EncryptPassword(
		typedUnencryptedPassword,
		Engine.GetGUIObjectByName("username").caption);
}

function saveCredentials()
{
	const username = Engine.GetGUIObjectByName("username").caption;
	Engine.ConfigDB_CreateValue("user", "playername.multiplayer", username);
	Engine.ConfigDB_CreateValue("user", "lobby.login", username);

	if (Engine.ConfigDB_GetValue("user", "lobby.rememberpassword") == "true")
		Engine.ConfigDB_CreateValue("user", "lobby.password", getEncryptedPassword());
	else
	{
		Engine.ConfigDB_RemoveValue("user", "lobby.password");
	}
	Engine.ConfigDB_SaveChanges("user");
}
