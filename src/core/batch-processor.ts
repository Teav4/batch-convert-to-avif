import { dirname } from "https://deno.land/std/path/mod.ts";
import { ConversionTask, FolderConversionTask, ProgressInfo } from "../interfaces/types.ts";
import { processFilesInFolder, retryFailedFiles, checkFolderCompletion } from "./folder-processor.ts";
import { showProgress } from "../utils/helpers.ts";

// Process files sequentially by folder with multi-threading within folders
export async function processFilesByFolder(
  tasks: ConversionTask[], 
  sourceDir: string, 
  globalProgress: ProgressInfo
): Promise<{ 
  successCount: number; 
  errorCount: number; 
  skippedCount: number; 
  totalTime: number 
}> {
  // Group tasks by folder
  const folderMap = new Map<string, ConversionTask[]>();
  
  for (const task of tasks) {
    const folderPath = dirname(task.inputPath);
    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, []);
    }
    folderMap.get(folderPath)!.push(task);
  }
  
  console.log(`Grouped files into ${folderMap.size} folders for processing`);
  
  // Create ordered folder tasks
  const folderTasks: FolderConversionTask[] = Array.from(folderMap.entries())
    .map(([folderPath, files]) => ({
      folderPath,
      files,
      errorFiles: [],
      completed: false
    }));
  
  // Process each folder sequentially
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < folderTasks.length; i++) {
    const folderTask = folderTasks[i];
    console.log(`\n[${i + 1}/${folderTasks.length}] Processing folder: ${folderTask.folderPath}`);
    console.log(`Found ${folderTask.files.length} files to process in this folder`);
    
    // Display total progress before processing this folder
    await showProgress(globalProgress);
    
    // Process files within folder in parallel
    const result = await processFilesInFolder(folderTask, globalProgress);
    
    successCount += result.successCount;
    errorCount += result.errorCount;
    skippedCount += result.skippedCount;
    
    // Try to fix errors if any
    if (result.errorCount > 0) {
      console.log(`\nRetrying ${folderTask.errorFiles.length} failed files in folder: ${folderTask.folderPath}`);
      const retryResult = await retryFailedFiles(folderTask, globalProgress);
      
      successCount += retryResult.successCount;
      errorCount -= retryResult.successCount; // Reduce error count for successful retries
      
      if (retryResult.successCount > 0) {
        console.log(`Successfully converted ${retryResult.successCount} files on retry`);
      }
      
      if (retryResult.errorCount > 0) {
        console.log(`${retryResult.errorCount} files still failed after retry attempts`);
      }
    }
    
    // Check folder completion
    await checkFolderCompletion(folderTask, sourceDir);
    
    // Mark folder as completed
    folderTask.completed = true;
    
    // Show progress after this folder is done
    await showProgress(globalProgress);
  }
  
  const totalTime = Date.now() - startTime;
  
  return {
    successCount,
    errorCount,
    skippedCount,
    totalTime
  };
}