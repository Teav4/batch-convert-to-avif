import { dirname } from "https://deno.land/std/path/mod.ts";
import { ConversionTask, FolderConversionTask, ProgressInfo } from "../interfaces/types.ts";
import { MAX_CONCURRENT_WORKERS } from "../utils/constants.ts";
import { showProgress } from "../utils/helpers.ts";
import { checkFolderCompletion, processFilesInFolder, retryFailedFiles } from "./folder-processor.ts";

// Process folders in parallel, with sequential processing of files within each folder
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
    const folderTasks = folderMap.get(folderPath);
    if (folderTasks) {
      folderTasks.push(task);
    }
  }
  
  console.log(`Grouped files into ${folderMap.size} folders for processing`);
  console.log(`Processing up to ${MAX_CONCURRENT_WORKERS} folders concurrently (one worker per folder)`);
  
  // Create ordered folder tasks
  const folderTasks: FolderConversionTask[] = Array.from(folderMap.entries())
    .map(([folderPath, files]) => ({
      folderPath,
      files,
      errorFiles: [],
      completed: false
    }));
  
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const startTime = Date.now();
  
  // Function to process a single folder
  async function processSingleFolder(folderTask: FolderConversionTask, folderIndex: number): Promise<{
    successCount: number;
    errorCount: number;
    skippedCount: number;
  }> {
    console.log(`\n[${folderIndex + 1}/${folderTasks.length}] Worker processing folder: ${folderTask.folderPath}`);
    console.log(`Found ${folderTask.files.length} files to process in this folder`);
    
    // Process files within folder sequentially
    const result = await processFilesInFolder(folderTask, globalProgress);
    
    // Try to fix errors if any
    if (result.errorCount > 0) {
      console.log(`\nRetrying ${folderTask.errorFiles.length} failed files in folder: ${folderTask.folderPath}`);
      const retryResult = await retryFailedFiles(folderTask, globalProgress);
      
      result.successCount += retryResult.successCount;
      result.errorCount -= retryResult.successCount; // Reduce error count for successful retries
      
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
    
    return result;
  }
  
  // Create a queue of folders to process
  const folderQueue = [...folderTasks];
  
  // Create a worker pool to process folders
  let activeWorkers = 0;
  let nextFolderIndex = 0;
  
  // Use a promise to wait for all folders to be processed
  return await new Promise<{
    successCount: number;
    errorCount: number;
    skippedCount: number;
    totalTime: number;
  }>((resolve) => {
    // Function to process the next available folder
    function processNextFolder(): void {
      if (folderQueue.length === 0) {
        // If there are no more folders and no active workers, we're done
        if (activeWorkers === 0) {
          const totalTime = Date.now() - startTime;
          resolve({
            successCount,
            errorCount,
            skippedCount,
            totalTime
          });
        }
        return;
      }
      
      // Get the next folder from the queue
      const nextFolder = folderQueue.shift();
      if (!nextFolder) return;
      
      // Increment active workers count
      activeWorkers++;
      
      // Process the folder
      processSingleFolder(nextFolder, nextFolderIndex++)
        .then((result) => {
          // Update counts
          successCount += result.successCount;
          errorCount += result.errorCount;
          skippedCount += result.skippedCount;
          
          // Update progress
          showProgress(globalProgress).catch((err) => {
            console.error("Error showing progress:", err instanceof Error ? err.message : String(err));
          });
          
          // Decrement active workers count
          activeWorkers--;
          
          // Process the next folder
          processNextFolder();
        })
        .catch((error) => {
          console.error(`Error processing folder ${nextFolder.folderPath}:`, error instanceof Error ? error.message : String(error));
          
          // Decrement active workers count
          activeWorkers--;
          
          // Continue with next folder despite error
          processNextFolder();
        });
    }
    
    // Start processing folders with up to MAX_CONCURRENT_WORKERS workers
    for (let i = 0; i < Math.min(MAX_CONCURRENT_WORKERS, folderTasks.length); i++) {
      processNextFolder();
    }
  });
}