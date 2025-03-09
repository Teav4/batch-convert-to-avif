import { join, dirname, basename, extname, relative } from "https://deno.land/std/path/mod.ts";
import { ensureDir, exists } from "https://deno.land/std/fs/mod.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";
import { format } from "https://deno.land/std/datetime/mod.ts";
import { ConversionTask, ProgressInfo } from "../interfaces/types.ts";
import { 
  formatDuration, 
  sanitizePath, 
  ensureTempDir,
  showProgress 
} from "../utils/helpers.ts";
import { 
  SUPPORTED_EXTENSIONS, 
  SHOW_CONVERSION_LOGS,
  MAX_CONCURRENT_TASKS, 
  TEMP_DIR 
} from "../utils/constants.ts";
import { processFilesByFolder } from "./batch-processor.ts";
import { 
  renameSpecialCharFolders, 
  checkDirectoryCompletion 
} from "./directory-handler.ts";

// Main function to convert all images in a directory to AVIF
export async function convertToAvif(sourceDir: string): Promise<void> {
  try {
    const sourceDirInfo = await Deno.stat(sourceDir);
    if (!sourceDirInfo.isDirectory) {
      console.error("Error: Source path is not a directory");
      Deno.exit(1);
    }
  } catch {
    console.error("Error: Source directory does not exist");
    Deno.exit(1);
  }

  console.log("Renaming folders with special characters...");
  await renameSpecialCharFolders(sourceDir);
  console.log("Folder renaming completed.\n");

  // Create temp directory for temporary files
  await ensureTempDir();
  console.log(`Temporary directory created: ${TEMP_DIR}\n`);

  const targetDir = `${sourceDir}_avif`;
  await ensureDir(targetDir);

  const tasks: ConversionTask[] = [];

  console.log("Finding image files...");
  for await (const entry of walk(sourceDir)) {
    if (entry.isFile && SUPPORTED_EXTENSIONS.includes(extname(entry.path).toLowerCase())) {
      const relativePath = relative(sourceDir, entry.path);
      const pathParts = dirname(relativePath).split(/[\/\\]/);
      const sanitizedParts = pathParts.map(part => sanitizePath(part));
      const sanitizedPath = sanitizedParts.join("/");
      const targetPath = join(targetDir, sanitizedPath);
      
      await ensureDir(targetPath);

      tasks.push({
        inputPath: entry.path,
        outputPath: targetPath,
        relativePath: sanitizedPath,
        originalIndex: 0 // Will be updated during folder processing
      });

      if (SHOW_CONVERSION_LOGS) {
        console.log(`Found file: ${entry.path}`);
        console.log(`Will save to: ${targetPath}\n`);
      }
    }
  }

  if (tasks.length === 0) {
    console.log("No image files found in the specified directory.");
    Deno.exit(0);
  }

  console.log(`Found ${tasks.length} files to process across ${new Set(tasks.map(t => dirname(t.inputPath))).size} folders.`);
  console.log(`Using ${MAX_CONCURRENT_TASKS} concurrent tasks per folder.`);
  console.log("Converting files to AVIF format...\n");

  // Create a global progress tracker for all files
  const globalProgress: ProgressInfo = {
    current: 0,
    total: tasks.length,
    startTime: Date.now()
  };

  // Use folder-based processing instead of parallel processing for all files
  console.log("Starting folder-by-folder processing...");
  const result = await processFilesByFolder(tasks, sourceDir, globalProgress);

  console.log("\n\nFinal Statistics:");
  console.log("================");
  console.log(`Total time: ${formatDuration(result.totalTime)}`);
  console.log(`Average time per file: ${(result.totalTime / (tasks.length - result.skippedCount) / 1000).toFixed(2)} seconds`);
  console.log(`Total files found: ${tasks.length}`);
  console.log(`Successfully converted: ${result.successCount}`);
  console.log(`Skipped (already exist): ${result.skippedCount}`);
  console.log(`Failed conversions: ${result.errorCount}`);
  console.log(`Concurrent tasks per folder: ${MAX_CONCURRENT_TASKS}`);
  
  if (result.errorCount > 0) {
    console.log(`See error.txt for error details`);
  }
  
  console.log(`Processing rate: ${(result.successCount / (result.totalTime / 1000)).toFixed(2)} files/second`);
  
  // Kiểm tra sự hoàn chỉnh giữa thư mục gốc và thư mục đích
  await checkDirectoryCompletion(sourceDir, targetDir);
  
  // Clean up temporary directory
  try {
    console.log(`\nCleaning up temporary files in ${TEMP_DIR}...`);
    for await (const entry of Deno.readDir(TEMP_DIR)) {
      if (entry.isFile) {
        await Deno.remove(join(TEMP_DIR, entry.name)).catch(() => {});
      }
    }
    console.log("Cleanup completed.");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error cleaning up temporary files: ${errorMessage}`);
  }
}