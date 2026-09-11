/**
 * Message of the form {}
 * sent from Player component.
 */
Engine.RegisterMessageType("DisabledTechnologiesChanged");

/**
 * Message of the form {}
 * sent from Player component.
 */
Engine.RegisterMessageType("DisabledTemplatesChanged");

/**
 * Message of the form { "to": number, "from": number, "amounts": object }
 * sent from Player component whenever a tribute is sent.
 */
Engine.RegisterMessageType("TributeExchanged");

/**
 * Message of the form { "player": player, "type": "cheat" }
 * sent from Player when some multiplier of that player has changed
 */
Engine.RegisterMessageType("MultiplierChanged");
