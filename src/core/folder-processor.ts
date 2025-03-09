import { format } from "https://deno.land/std/datetime/mod.ts";
import { exists } from "https://deno.land/std/fs/mod.ts";
import { basename, extname, join } from "https://deno.land/std/path/mod.ts";
import {
  FolderConversionTask,
  ProgressInfo
} from "../interfaces/types.ts";
import {
  DATE_FORMAT,
  MAX_RETRY_COUNT,
  SHOW_CONVERSION_LOGS,
  SKIP_EXISTING_FILES
} from "../utils/constants.ts";
import {
  showProgress,
  writeErrorLog
} from "../utils/helpers.ts";
import { convertFile } from "./converter.ts";

// Process all files within a single folder sequentially
export async function processFilesInFolder(
  folderTask: FolderConversionTask,
  globalProgress: ProgressInfo
): Promise<{ 
  successCount: number; 
  errorCount: number; 
  skippedCount: number; 
}> {
  const { files, folderPath } = folderTask;

  // Sort files by name in ascending order (Windows Explorer style)
  files.sort((a, b) => {
    const fileNameA = basename(a.inputPath);
    const fileNameB = basename(b.inputPath);
    
    // Natural sort algorithm to match Windows Explorer behavior
    return fileNameA.localeCompare(fileNameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Update originalIndex based on sorted order
  files.forEach((task, index) => {
    task.originalIndex = index;
  });
  
  console.log(`Starting sequential conversion of ${files.length} files in ${folderPath}`);
  
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  
  // Process files sequentially within the folder
  for (let i = 0; i < files.length; i++) {
    const task = files[i];
    try {
      // Check if file already exists
      const targetFileName = `${(task.originalIndex + 1).toString().padStart(3, '0')}.avif`;
      const finalOutputPath = join(task.outputPath, targetFileName);
      
      if (SKIP_EXISTING_FILES && await exists(finalOutputPath)) {
        if (SHOW_CONVERSION_LOGS) {
          console.log(`Skipping existing file: ${finalOutputPath}`);
        }
        skippedCount++;
      } else {
        await convertFile(task);
        successCount++;
      }
    } catch (error) {
      errorCount++;
      folderTask.errorFiles.push(task); // Add to error files for retry
      
      console.error(`\nError processing file: ${task.inputPath}`);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error message: ${errorMessage}`);
      
      await writeErrorLog({
        timestamp: format(new Date(), DATE_FORMAT),
        filePath: task.inputPath,
        error: errorMessage
      });
    }
    
    // Update global progress
    globalProgress.current++;
    await showProgress(globalProgress);
  }
  
  return { successCount, errorCount, skippedCount };
}

// Retry failed files in a folder
export async function retryFailedFiles(
  folderTask: FolderConversionTask,
  globalProgress: ProgressInfo
): Promise<{
  successCount: number;
  errorCount: number;
}> {
  const { errorFiles } = folderTask;
  if (errorFiles.length === 0) {
    return { successCount: 0, errorCount: 0 };
  }
  
  let successCount = 0;
  let remainingErrors = errorFiles.length;
  
  console.log(`Will retry ${errorFiles.length} failed files with up to ${MAX_RETRY_COUNT} attempts each`);
  
  for (const task of errorFiles) {
    let retrySuccess = false;
    
    for (let attempt = 0; attempt < MAX_RETRY_COUNT && !retrySuccess; attempt++) {
      console.log(`Retry attempt ${attempt + 1}/${MAX_RETRY_COUNT} for file: ${task.inputPath}`);
      
      try {
        await convertFile(task);
        retrySuccess = true;
        successCount++;
        remainingErrors--;
        console.log(`Retry successful for file: ${task.inputPath}`);
        
        // We don't increment globalProgress.current here because the error files
        // were already counted in the progress when they failed
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Retry attempt ${attempt + 1} failed: ${errorMessage}`);
        
        if (attempt === MAX_RETRY_COUNT - 1) {
          await writeErrorLog({
            timestamp: format(new Date(), DATE_FORMAT),
            filePath: task.inputPath,
            error: `Failed after ${MAX_RETRY_COUNT} retry attempts: ${errorMessage}`
          });
        }
      }
    }
  }
  
  // Show updated progress
  await showProgress(globalProgress);
  
  return { successCount, errorCount: remainingErrors };
}

// Check if a folder has been completely processed
export async function checkFolderCompletion(folderTask: FolderConversionTask, sourceDir: string): Promise<boolean> {
  const { folderPath, files } = folderTask;
  
  // Create relative path from source to target directory
  const { relative } = await import("https://deno.land/std/path/mod.ts");
  const relativePath = relative(sourceDir, folderPath);
  const targetFolderPath = join(sourceDir + "_avif", relativePath);
  
  console.log(`\nVerifying folder completion: ${folderPath}`);
  
  // Count source files in this folder
  const sourceCount = files.length;
  
  // Count target files
  let targetCount = 0;
  try {
    for await (const entry of Deno.readDir(targetFolderPath)) {
      if (entry.isFile && extname(entry.name).toLowerCase() === ".avif") {
        targetCount++;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error reading target folder ${targetFolderPath}: ${errorMessage}`);
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