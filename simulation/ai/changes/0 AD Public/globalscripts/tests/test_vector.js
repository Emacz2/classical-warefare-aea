function test_serialization()
{
	const test_val = new Vector2D(1, 2);
	const rt = Engine.SerializationRoundTrip(test_val);
	TS_ASSERT_EQUALS(test_val.constructor, rt.constructor);
	TS_ASSERT_EQUALS(rt.add(test_val).x, 2);
}

test_serialization();
