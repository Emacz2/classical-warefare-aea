Engine.RegisterInterface("Diplomacy");

/**
 * Message of the form { "player": number, "otherPlayer": number }
 * sent from Diplomacy component when diplomacy changed for one player or between two players.
 */
Engine.RegisterMessageType("DiplomacyChanged");

/**
 * Message of the form { "player": number, "oldTeam": number, "newTeam", number }
 * sent from the Diplomacy component when a player switches teams.
 */
Engine.RegisterMessageType("TeamChanged");
