import { format } from "https://deno.land/std/datetime/mod.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";
import { basename, dirname, extname, join, relative } from "https://deno.land/std/path/mod.ts";
import {
  DirectoryMismatch
} from "../interfaces/types.ts";
import {
  DATE_FORMAT,
  SHOW_RENAME_LOGS,
  SUPPORTED_EXTENSIONS
} from "../utils/constants.ts";
import {
  sanitizePath,
  writeRenameErrorLog
} from "../utils/helpers.ts";

// Rename folders with special characters to sanitized names
export async function renameSpecialCharFolders(sourceDir: string): Promise<void> {
  const dirs = [];
  // Collect all directories first
  try {
    for await (const entry of walk(sourceDir, { includeDirs: true })) {
      if (entry.isDirectory) {
        dirs.push(entry);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error walking source directory tree: ${errorMessage}`);
    console.log("Will continue without complete folder renaming.");
  }

  // Sort directories by depth (deepest first)
  dirs.sort((a, b) => {
    const depthA = a.path.split(/[\/\\]/).length;
    const depthB = b.path.split(/[\/\\]/).length;
    return depthB - depthA;
  });

  // Track renamed directories to avoid repeat attempts
  const renamedPaths = new Set<string>();
  // Track used target names to avoid duplicates
  const usedNames = new Map<string, number>();
  
  let skippedCount = 0;
  let errorCount = 0;
  let successCount = 0;

  // Process directories
  for (const entry of dirs) {
    // Skip already processed paths or if parent has been renamed
    if (renamedPaths.has(dirname(entry.path))) {
      skippedCount++;
      continue;
    }

    const dirName = basename(entry.path);
    const parentDir = dirname(entry.path);
    let sanitizedName = sanitizePath(dirName);
    
    if (dirName !== sanitizedName) {
      // Check if this sanitized name already exists in the same parent directory
      const parentDirKey = parentDir.toLowerCase();
      const sanitizedNameKey = sanitizedName.toLowerCase();
      const dupKey = `${parentDirKey}|${sanitizedNameKey}`;
      
      // If this sanitized name was already used in this directory, add a number suffix
      if (usedNames.has(dupKey)) {
        const counter = (usedNames.get(dupKey) ?? 0) + 1;
        usedNames.set(dupKey, counter);
        sanitizedName = `${sanitizedName}_${counter}`;
      } else {
        usedNames.set(dupKey, 0);
      }
      
      const newPath = join(parentDir, sanitizedName);
      if (SHOW_RENAME_LOGS) {
        console.log(`Renaming directory:\nFrom: ${entry.path}\nTo: ${newPath}\n`);
      }
      
      try {
        // Check if destination already exists to avoid conflicts
        try {
          const destStat = await Deno.stat(newPath);
          if (destStat.isDirectory) {
            console.log(`Destination directory ${newPath} already exists, creating a numbered alternative.`);
            
            // Find an available numbered alternative
            let counter = 1;
            let alternateNewPath;
            
            do {
              const numberedName = `${sanitizedName}_${counter}`;
              alternateNewPath = join(parentDir, numberedName);
              counter++;
              
              try {
                await Deno.stat(alternateNewPath);
                // Path exists, try next number
              } catch {
                // Path doesn't exist, we can use it
                break;
              }
            } while (counter < 100); // Safety limit
            
            console.log(`Using alternative name: ${alternateNewPath}`);
            await Deno.rename(entry.path, alternateNewPath);
            renamedPaths.add(entry.path);
            successCount++;
            continue;
          }
        } catch {
          // Destination doesn't exist, can proceed with original rename
        }
        
        await Deno.rename(entry.path, newPath);
        renamedPaths.add(entry.path);
        successCount++;
      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error renaming directory ${entry.path}: ${errorMessage}`);
        
        // Thử lại với tên thay thế và thêm số
        try {
          console.log(`Trying alternate rename method for ${entry.path}...`);
          
          // Tìm một số hậu tố chưa được sử dụng
          let counter = 1;
          let alternateNewPath;
          
          do {
            const numberedName = `${sanitizedName}_${counter}`;
            alternateNewPath = join(parentDir, numberedName);
            counter++;
            
            try {
              await Deno.stat(alternateNewPath);
              // Đường dẫn đã tồn tại, thử số tiếp theo
            } catch {
              // Đường dẫn chưa tồn tại, có thể sử dụng
              break;
            }
          } while (counter < 100); // Giới hạn an toàn
          
          await Deno.rename(entry.path, alternateNewPath);
          console.log(`Successfully renamed to numbered path: ${alternateNewPath}`);
          renamedPaths.add(entry.path);
          
          // Ghi nhớ lỗi ban đầu để tham khảo
          await writeRenameErrorLog({
            timestamp: format(new Date(), DATE_FORMAT),
            oldPath: entry.path,
            newPath: alternateNewPath,
            error: `Original rename failed (${errorMessage}). Used numbered alternative.`
          });
        } catch (altError) {
          const altErrorMessage = altError instanceof Error ? altError.message : String(altError);
          console.error(`Alternate rename also failed: ${altErrorMessage}`);
          
          // Ghi log cả hai lỗi
          await writeRenameErrorLog({
            timestamp: format(new Date(), DATE_FORMAT),
            oldPath: entry.path,
            newPath: newPath,
            error: `Original error: ${errorMessage}. Alternate method also failed: ${altErrorMessage}`
          });
        }
      }
    }
  }

  console.log(`Directory rename summary: ${successCount} renamed, ${errorCount} failed, ${skippedCount} skipped.`);
}

// Verify conversion completion by comparing source and target directories
export async function checkDirectoryCompletion(sourceDir: string, targetDir: string): Promise<void> {
  console.log("\nVerifying conversion completeness...");
  
  // Lấy tên folder từ đường dẫn nguồn
  const folderName = basename(sourceDir);
  const checkErrorsFileName = `check_errors_${folderName}.txt`;
  
  console.log(`Log file will be saved as: ${checkErrorsFileName}`);
  
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
    } catch (error) {
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
    
    await Deno.writeTextFile(checkErrorsFileName, logContent);
    console.log(`Found ${mismatches.length} directories with mismatched file counts. Check ${checkErrorsFileName} for details.`);
  } else {
    console.log("All directories verified. File counts match between source and target.");
  }
}