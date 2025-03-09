import { parse } from "https://deno.land/std/flags/mod.ts";
import { convertToAvif } from "./core/controller.ts";
import { setMaxConcurrentWorkers } from "./utils/constants.ts";

if (import.meta.main) {
  const args = parse(Deno.args);
  const sourceDir = args._[0] as string;
  
  if (args.workers) {
    setMaxConcurrentWorkers(parseInt(args.workers));
  }

  if (!sourceDir) {
    console.log("Please provide the source directory path.");
    console.log("Usage: deno run --allow-read --allow-write --allow-run --allow-env main.ts <source_directory> [--workers=N]");
    Deno.exit(1);
  }

  await convertToAvif(sourceDir);
}