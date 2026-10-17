extends SceneTree
## Minimal, dependency-free test runner.
##
##   godot --headless --path . -s res://tests/run_tests.gd
##
## Runs every method starting with "test_" in res://tests/test_*.gd and prints
## machine-readable result lines (parsed by XyoLua GameForge):
##   GFTEST|PASS|<file>|<test>
##   GFTEST|FAIL|<file>|<test>|<message>
##   GFTEST|SKIP|<file>|<test>|<reason>
##   GFTEST|SUMMARY|<total>|<passed>|<failed>|<skipped>
## The process exits with code 1 when a test fails.

const TEST_DIR := "res://tests"


func _initialize() -> void:
	var total := 0
	var failed := 0
	var skipped := 0
	var files := Array(DirAccess.get_files_at(TEST_DIR))
	files.sort()
	for file_name in files:
		var file := str(file_name)
		if not (file.begins_with("test_") and file.ends_with(".gd")):
			continue
		var script := load("%s/%s" % [TEST_DIR, file]) as GDScript
		if script == null or not script.can_instantiate():
			total += 1
			failed += 1
			print("GFTEST|FAIL|%s|load|Could not load the test script (parse error?)" % file)
			continue
		for method in script.get_script_method_list():
			var test_name := str(method.get("name", ""))
			if not test_name.begins_with("test_"):
				continue
			total += 1
			var instance: Object = script.new()
			if instance.has_method("before_each"):
				instance.call("before_each")
			instance.call(test_name)
			var failures: Array = instance.get("failures")
			var skip_reason := str(instance.get("skipped_reason"))
			if failures.is_empty() and skip_reason != "":
				skipped += 1
				print("GFTEST|SKIP|%s|%s|%s" % [file, test_name, skip_reason])
			elif failures.is_empty():
				print("GFTEST|PASS|%s|%s" % [file, test_name])
			else:
				failed += 1
				print("GFTEST|FAIL|%s|%s|%s" % [file, test_name, "; ".join(PackedStringArray(failures))])
	print("GFTEST|SUMMARY|%d|%d|%d|%d" % [total, total - failed - skipped, failed, skipped])
	quit(1 if failed > 0 else 0)
