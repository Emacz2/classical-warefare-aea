/**
 * This class provides information on the current merchant ships.
 */
TraderStatusText.prototype.Components.prototype.ShipText = class
{
	getText(traderNumber, idleTags)
	{
		const active = traderNumber.shipTrader.trading;
		const inactive = traderNumber.shipTrader.total - active;

		const message = this.IdleShipTraderText[active ? "active" : "no-active"][inactive ? "inactive" : "no-inactive"](inactive);

		const activeString = sprintf(
			translatePlural(
				"There is %(numberTrading)s merchant ship trading",
				"There are %(numberTrading)s merchant ships trading",
				active
			),
			{ "numberTrading": active }
		);

		const inactiveString = sprintf(
			active ?
				translatePlural(
					"%(numberOfShipTraders)s inactive",
					"%(numberOfShipTraders)s inactive",
					inactive
				) :
				translatePlural(
					"%(numberOfShipTraders)s merchant ship inactive",
					"%(numberOfShipTraders)s merchant ships inactive",
					inactive
				),
			{ "numberOfShipTraders": inactive }
		);

		return sprintf(message, {
			"openingTradingString": activeString,
			"inactiveString": setStringTags(inactiveString, idleTags)
		});
	}
};

TraderStatusText.prototype.Components.prototype.ShipText.prototype.IdleShipTraderText = {
	"active": {
		"inactive": () => translate("%(openingTradingString)s, and %(inactiveString)s."),
		"no-inactive": () => translate("%(openingTradingString)s.")
	},
	"no-active": {
		"inactive": inactive => translatePlural("There is %(inactiveString)s.", "There are %(inactiveString)s.", inactive),
		"no-inactive": () => translate("There are no merchant ships.")
	}
};
