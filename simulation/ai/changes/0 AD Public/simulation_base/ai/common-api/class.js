/**
 * Provides a nicer syntax for defining classes,
 * with support for OO-style inheritance.
 */
export function Class(data)
{
	let ctor;
	if (data._init)
		ctor = data._init;
	else
		ctor = function() { };

	if (data._super)
		ctor.prototype = { "__proto__": data._super.prototype };

	for (const key in data)
		ctor.prototype[key] = data[key];

	return ctor;
}
