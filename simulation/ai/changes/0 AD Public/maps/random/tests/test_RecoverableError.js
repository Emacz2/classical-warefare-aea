export function* generateMap()
{
	try
	{
		yield;
		TS_FAIL("The yield statement didn't throw.");
	}
	catch (error)
	{
		TS_ASSERT(error instanceof Error);
		TS_ASSERT_EQUALS(error.message, "Failed to convert the yielded value to an integer.");
	}
}
