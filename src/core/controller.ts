import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";
import { dirname, extname, join, relative } from "https://deno.land/std/path/mod.ts";
import { ConversionTask, ProgressInfo } from "../interfaces/types.ts";
import {
  MAX_CONCURRENT_WORKERS,
  SHOW_CONVERSION_LOGS,
  SUPPORTED_EXTENSIONS,
  TEMP_DIR
} from "../utils/constants.ts";
import {
  ensureTempDir,
  formatDuration,
  sanitizePath
} from "../utils/helpers.ts";
import { processFilesByFolder } from "./batch-processor.ts";
import {
  checkDirectoryCompletion,
  renameSpecialCharFolders
} from "./directory-handler.ts";

// Main function to convert all images in a directory to AVIF
export async function convertToAvif(sourceDir: string): Promise<void> {
  try {
    const sourceDirInfo = await Deno.stat(sourceDir);
    if (!sourceDirInfo.isDirectory) {
      console.error("Error: Source path is not a directory");
      Deno.exit(1);
    }
  } catch (_error) {
    console.error("Error: Source directory does not exist");
    Deno.exit(1);
  }

  console.log("Renaming folders with special characters...");
  try {
    await renameSpecialCharFolders(sourceDir);
    console.log("Folder renaming completed.\n");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error during folder renaming process: ${errorMessage}`);
    console.log("Continuing with conversion regardless of renaming errors.\n");
  }

  // Create temp directory for temporary files
  await ensureTempDir();
  console.log(`Temporary directory created: ${TEMP_DIR}\n`);

  const targetDir = `${sourceDir}_avif`;
  await ensureDir(targetDir);

  const tasks: ConversionTask[] = [];

  console.log("Finding image files...");
  for await (const entry of walk(sourceDir)) {
    if (entry.isFile && SUPPORTED_EXTENSIONS.includes(extname(entry.path).toLowerCase())) {
      try {
        const relativePath = relative(sourceDir, entry.path);
        const pathParts = dirname(relativePath).split(/[\/\\]/);
        const sanitizedParts = pathParts.map(part => sanitizePath(part));
        const sanitizedPath = sanitizedParts.join("/");
        const targetPath = join(targetDir, sanitizedPath);
        
        // Ensure target directory exists
        try {
          await ensureDir(targetPath);
        } catch (err) {
          const dirError = err instanceof Error ? err.message : String(err);
          console.error(`Error creating directory ${targetPath}: ${dirError}`);
          console.log(`Attempting alternative approach for ${targetPath}...`);
          
          // Try creating directories one by one if batch creation failed
          const parts = targetPath.split(/[\/\\]/);
          let currentPath = "";
          for (const part of parts) {
            if (!part) continue;
            currentPath = currentPath ? join(currentPath, part) : part;
            try {
              await ensureDir(currentPath);
            } catch (_e) {
              console.error(`Failed to create directory ${currentPath}`);
            }
          }
        }

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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error processing file path ${entry.path}: ${errorMessage}`);
        // Continue with next file instead of stopping
      }
    }
  }

  if (tasks.length === 0) {
    console.log("No image files found in the specified directory.");
    Deno.exit(0);
  }

  console.log(`Found ${tasks.length} files to process across ${new Set(tasks.map(t => dirname(t.inputPath))).size} folders.`);
  console.log(`Processing up to ${MAX_CONCURRENT_WORKERS} folders concurrently.`);
  console.log(`Each folder will process files sequentially with one dedicated worker.`);
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
  console.log(`Concurrent workers: ${MAX_CONCURRENT_WORKERS}`);
  
  if (result.errorCount > 0) {
    console.log(`See error.txt for error details`);
  }
  
  console.log(`Processing rate: ${(result.successCount / (result.totalTime / 1000)).toFixed(2)} files/second`);
  
  // Kiểm tra sự hoàn chỉnh giữa thư mục gốc và thư mục đích
  try {
    await checkDirectoryCompletion(sourceDir, targetDir);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error during directory completion check: ${errorMessage}`);
  }
  
  // Clean up temporary directory
  try {
    console.log(`\nCleaning up temporary files in ${TEMP_DIR}...`);
    for await (const entry of Deno.readDir(TEMP_DIR)) {
      if (entry.isFile) {
        await Deno.remove(join(TEMP_DIR, entry.name)).catch(() => {});
      }
    }
    console.log("Cleanup completed.");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error cleaning up temporary files: ${errorMessage}`);
  }
}