Resources = {
	"BuildChoicesSchema": () => {
		let schema = "";
		for (const res of ["food", "metal"])
		{
			for (const subtype in ["meat", "grain"])
				schema += "<value>" + res + "." + subtype + "</value>";
			schema += "<value> treasure." + res + "</value>";
		}
		return "<choice>" + schema + "</choice>";
	}
};

Engine.LoadHelperScript("Player.js");
Engine.LoadComponentScript("interfaces/ResourceDropsite.js");
Engine.LoadComponentScript("ResourceDropsite.js");

Engine.RegisterGlobal("ApplyValueModificationsToEntity", (prop, oVal, ent) => oVal);

const owner = 1;
const entity = 11;
const dropper = 12;

const template = {
	"Sharable": "true",
	"Types": "food"
};

const cmpResourceDropsite = ConstructComponent(entity, "ResourceDropsite", template);
TS_ASSERT(cmpResourceDropsite.IsSharable());

AddMock(dropper, IID_Ownership, {
	"GetOwner": () => 1
});

AddMock(SYSTEM_ENTITY, IID_PlayerManager, {
	"GetPlayerByID": (id) => owner
});

AddMock(owner, IID_Player, {
	"AddResources": (type, amount) => {}
});

TS_ASSERT_UNEVAL_EQUALS(cmpResourceDropsite.ReceiveResources({
	"food": 1,
	"wood": 1
}, dropper), { "food": 1 });
