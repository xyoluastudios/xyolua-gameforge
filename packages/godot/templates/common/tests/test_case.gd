extends RefCounted
## Base class for tests run by tests/run_tests.gd.
## Every method whose name starts with "test_" is a test.

var failures: Array[String] = []
## Set by skip(); the runner reports the test as skipped.
var skipped_reason := ""


func skip(reason: String) -> void:
	skipped_reason = reason


func assert_true(condition: bool, message: String = "expected true") -> void:
	if not condition:
		failures.append(message)


func assert_false(condition: bool, message: String = "expected false") -> void:
	if condition:
		failures.append(message)


func assert_eq(actual: Variant, expected: Variant, message: String = "") -> void:
	if not _equal(actual, expected):
		failures.append("%s expected <%s> but got <%s>" % [message, str(expected), str(actual)])


func assert_ne(actual: Variant, unexpected: Variant, message: String = "") -> void:
	if _equal(actual, unexpected):
		failures.append("%s did not expect <%s>" % [message, str(actual)])


func _equal(a: Variant, b: Variant) -> bool:
	var numeric := [TYPE_INT, TYPE_FLOAT]
	if typeof(a) in numeric and typeof(b) in numeric:
		return is_equal_approx(float(a), float(b))
	if typeof(a) != typeof(b):
		return false
	return a == b
