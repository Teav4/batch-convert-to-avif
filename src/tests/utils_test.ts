import { assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { sanitizePath } from "../utils/helpers.ts";

// Test sanitizePath function
Deno.test("sanitizePath should replace special characters with underscores", () => {
  assertEquals(sanitizePath("file name"), "file_name");
  assertEquals(sanitizePath("folder/with\\path"), "folder_with_path");
  assertEquals(sanitizePath("test?file"), "test_file");
  assertEquals(sanitizePath("special:chars!"), "special_chars_");
});

// Basic sanity test to ensure test system is working
Deno.test("Basic sanity test", () => {
  assertEquals(1 + 1, 2);
});