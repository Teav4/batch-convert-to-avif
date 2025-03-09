import { join, dirname, basename, extname, relative } from "https://deno.land/std/path/mod.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";
import { format } from "https://deno.land/std/datetime/mod.ts";
import { 
  DirectoryMismatch,
  RenameError,
  FolderConversionTask
} from "../interfaces/types.ts";
import {
  sanitizePath,
  writeRenameErrorLog
} from "../utils/helpers.ts";
import {
  SUPPORTED_EXTENSIONS,
  SHOW_RENAME_LOGS,
  CHECK_ERRORS_LOG_FILE,
  DATE_FORMAT
} from "../utils/constants.ts";

// Rename folders with special characters to sanitized names
export async function renameSpecialCharFolders(sourceDir: string): Promise<void> {
  const dirs = [];
  // Collect all directories first
  for await (const entry of walk(sourceDir, { includeDirs: true })) {
    if (entry.isDirectory) {
      dirs.push(entry);
    }
  }

  // Sort directories by depth (deepest first)
  dirs.sort((a, b) => {
    const depthA = a.path.split(/[\/\\]/).length;
    const depthB = b.path.split(/[\/\\]/).length;
    return depthB - depthA;
  });

  // Process directories
  for (const entry of dirs) {
    const dirName = basename(entry.path);
    const parentDir = dirname(entry.path);
    const sanitizedName = sanitizePath(dirName);
    
    if (dirName !== sanitizedName) {
      const newPath = join(parentDir, sanitizedName);
      if (SHOW_RENAME_LOGS) {
        console.log(`Renaming directory:\nFrom: ${entry.path}\nTo: ${newPath}\n`);
      }
      
      try {
        await Deno.rename(entry.path, newPath);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error renaming directory ${entry.path}: ${errorMessage}`);
        await writeRenameErrorLog({
          timestamp: format(new Date(), DATE_FORMAT),
          oldPath: entry.path,
          newPath: newPath,
          error: errorMessage
        });
      }
    }
  }
}

// Verify conversion completion by comparing source and target directories
export async function checkDirectoryCompletion(sourceDir: string, targetDir: string): Promise<void> {
  console.log("\nVerifying conversion completeness...");
  
  const MAX_CHECK_RETRIES = 2;
  let successful = false;
  let sourceDirs = new Map<string, number>();
  let targetDirs = new Map<string, number>();
  
  for (let attempt = 0; attempt <= MAX_CHECK_RETRIES && !successful; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry attempt ${attempt}/${MAX_CHECK_RETRIES} for full directory verification...`);
        // Add a small delay before retrying
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Reset maps for new attempt
        sourceDirs = new Map<string, number>();
        targetDirs = new Map<string, number>();
      }
      
      // Count original image files
      console.log("Counting source files...");
      for await (const entry of walk(sourceDir)) {
        if (entry.isFile && SUPPORTED_EXTENSIONS.includes(extname(entry.path).toLowerCase())) {
          const parentDir = dirname(entry.path);
          const count = sourceDirs.get(parentDir) || 0;
          sourceDirs.set(parentDir, count + 1);
        }
      }
      
      // Count converted AVIF files
      console.log("Counting target files...");
      for await (const entry of walk(targetDir)) {
        if (entry.isFile && extname(entry.path).toLowerCase() === ".avif") {
          const parentDir = dirname(entry.path);
          const count = targetDirs.get(parentDir) || 0;
          targetDirs.set(parentDir, count + 1);
        }
      }
      
      successful = true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (attempt < MAX_CHECK_RETRIES) {
        console.warn(`Error during directory verification attempt ${attempt + 1}: ${errorMessage}`);
        console.warn("Will retry directory verification...");
      } else {
        console.error(`Error during directory verification after all attempts: ${errorMessage}`);
        return; // Exit function after all retries failed
      }
    }
  }
  
  if (!successful) {
    console.error("Failed to verify directories after all retry attempts");
    return;
  }
  
  // For debugging
  console.log(`Found ${sourceDirs.size} source directories with ${Array.from(sourceDirs.values()).reduce((a, b) => a + b, 0)} files`);
  console.log(`Found ${targetDirs.size} target directories with ${Array.from(targetDirs.values()).reduce((a, b) => a + b, 0)} files`);
  
  // Compare directories and log differences
  const mismatches: DirectoryMismatch[] = [];
  let totalMismatches = 0;
  
  console.log("Comparing directories...");
  
  for (const [dirPath, sourceCount] of sourceDirs.entries()) {
    const relativePath = relative(sourceDir, dirPath);
    const targetPath = join(targetDir, relativePath);
    const targetCount = targetDirs.get(targetPath) || 0;
    
    if (sourceCount !== targetCount) {
      mismatches.push({
        sourceDir: dirPath,
        targetDir: targetPath,
        sourceDirFileCount: sourceCount,
        targetDirFileCount: targetCount,
        difference: sourceCount - targetCount
      });
      totalMismatches += Math.abs(sourceCount - targetCount);
    }
  }
  
  // Log mismatches to file if any
  if (mismatches.length > 0) {
    const timestamp = format(new Date(), DATE_FORMAT);
    let logContent = `${timestamp} - Found ${mismatches.length} directories with mismatched file counts (total: ${totalMismatches} files):\n\n`;
    
    for (const mismatch of mismatches) {
      logContent += `Source: ${mismatch.sourceDir} (${mismatch.sourceDirFileCount} files)\n`;
      logContent += `Target: ${mismatch.targetDir} (${mismatch.targetDirFileCount} files)\n`;
      logContent += `Missing: ${mismatch.difference} files\n\n`;
    }
    
    await Deno.writeTextFile(CHECK_ERRORS_LOG_FILE, logContent);
    console.log(`Found ${mismatches.length} directories with mismatched file counts. Check ${CHECK_ERRORS_LOG_FILE} for details.`);
  } else {
    console.log("All directories verified. File counts match between source and target.");
  }
}

// Check if a folder has been completely processed with retries
export async function checkFolderCompletion(folderTask: FolderConversionTask, sourceDir: string): Promise<boolean> {
  const { folderPath, files } = folderTask;
  
  // Create relative path from source to target directory
  const relativePath = relative(sourceDir, folderPath);
  const targetFolderPath = join(sourceDir + "_avif", relativePath);
  
  console.log(`\nVerifying folder completion: ${folderPath}`);
  
  // Count source files in this folder
  const sourceCount = files.length;
  
  // Add retry logic - maximum 2 retries
  let targetCount = 0;
  let success = false;
  let lastError = "";
  const MAX_FOLDER_CHECK_RETRIES = 2;
  
  for (let attempt = 0; attempt <= MAX_FOLDER_CHECK_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry folder verification attempt ${attempt}/${MAX_FOLDER_CHECK_RETRIES}`);
        // Add a small delay before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      targetCount = 0;
      // Count target files
      for await (const entry of Deno.readDir(targetFolderPath)) {
        if (entry.isFile && extname(entry.name).toLowerCase() === ".avif") {
          targetCount++;
        }
      }
      success = true;
      break; // Successfully read the directory, exit retry loop
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastError = errorMessage;
      
      if (attempt < MAX_FOLDER_CHECK_RETRIES) {
        console.warn(`Error reading target folder on attempt ${attempt + 1}. Will retry...`);
        console.warn(`Error: ${errorMessage}`);
      } else {
        // Final attempt failed
        console.error(`Error reading target folder ${targetFolderPath} after ${MAX_FOLDER_CHECK_RETRIES + 1} attempts: ${errorMessage}`);
      }
    }
  }
  
  if (!success) {
    console.error(`Failed to verify folder ${targetFolderPath} after all retry attempts`);
    return false;
  }
  
  // Log results
  console.log(`Source files: ${sourceCount}, Target files: ${targetCount}`);
  
  if (sourceCount !== targetCount) {
    console.log(`⚠️ MISMATCH! Folder ${folderPath} has ${sourceCount} source files but ${targetCount} target files`);
    return false;
  } else {
    console.log(`✅ Folder ${folderPath} completed successfully: ${targetCount}/${sourceCount} files converted`);
    return true;
  }
}