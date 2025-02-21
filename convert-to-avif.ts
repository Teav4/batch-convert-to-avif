import { join, dirname, basename, extname, relative } from "https://deno.land/std/path/mod.ts";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { parse } from "https://deno.land/std/flags/mod.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";
import { format } from "https://deno.land/std/datetime/mod.ts";

// Types
interface ProgressInfo {
  current: number;
  total: number;
  startTime: number;
}

interface FileError {
  timestamp: string;
  filePath: string;
  error: string;
}

interface ConversionTask {
  inputPath: string;
  outputPath: string;
  relativePath: string;
}

// Constants
const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tiff"];
const ERROR_LOG_FILE = "error.txt";
let MAX_CONCURRENT_TASKS = navigator.hardwareConcurrency || 4;

// Simple Task Queue implementation
class TaskQueue {
  private queue: ConversionTask[] = [];
  private running = 0;
  private results: { success: number; errors: number } = { success: 0, errors: 0 };
  private currentFirstLevelFolder = "";

  constructor(
    private maxConcurrent: number,
    private sourceDir: string,
    private progressInfo: ProgressInfo
  ) {}

  async add(task: ConversionTask): Promise<void> {
    this.queue.push(task);
    await this.runNext();
  }

  private async runNext(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const task = this.queue.shift()!;

    try {
      // Check and display first level folder
      const firstLevelFolder = getFirstLevelFolder(task.inputPath, this.sourceDir);
      if (firstLevelFolder !== this.currentFirstLevelFolder) {
        this.currentFirstLevelFolder = firstLevelFolder;
        console.log(`Processing folder: ${this.currentFirstLevelFolder}`);
      }

      await convertFile(task);
      this.results.success++;
    } catch (error) {
      this.results.errors++;
      await writeErrorLog({
        timestamp: format(new Date(), "yyyy-MM-dd HH:mm:ss"),
        filePath: task.inputPath,
        error: error.message
      });
    }

    this.progressInfo.current++;
    showProgress(this.progressInfo);

    this.running--;
    await this.runNext();
  }

  async waitForAll(): Promise<{ success: number; errors: number }> {
    while (this.queue.length > 0 || this.running > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.results;
  }
}

// Helper Functions
async function writeErrorLog(error: FileError) {
  const logEntry = `${error.timestamp} - Error processing '${error.filePath}': ${error.error}\n`;
  await Deno.writeTextFile(ERROR_LOG_FILE, logEntry, { append: true });
}

function getFirstLevelFolder(filePath: string, basePath: string): string {
  const relativePath = relative(basePath, filePath);
  return relativePath.split(/[\/\\]/)[0];
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function showProgress(info: ProgressInfo) {
  const { current, total, startTime } = info;
  const now = Date.now();
  const elapsed = now - startTime;
  const rate = current / (elapsed / 1000);
  const percentComplete = Math.round((current / total) * 100 * 100) / 100;
  const remainingItems = total - current;
  
  const estimatedSeconds = rate > 0 ? remainingItems / rate : 0;
  const remainingTime = formatDuration(estimatedSeconds * 1000);
  const elapsedTime = formatDuration(elapsed);
  
  const width = Deno.consoleSize().columns;
  const barWidth = Math.max(10, Math.min(50, width - 60));
  const progressWidth = Math.round((current / total) * barWidth);
  const progressBar = "[" + "=".repeat(progressWidth) + " ".repeat(barWidth - progressWidth) + "]";
  
  const rateStr = rate > 0 ? rate.toFixed(2) : "calculating...";
  const statusLine = 
    `\r${progressBar} ${current}/${total} (${percentComplete}%) - ${rateStr} files/sec - ` +
    `Elapsed: ${elapsedTime} - Remaining: ${remainingTime} - Tasks: ${MAX_CONCURRENT_TASKS}`;
  
  console.log("\r" + " ".repeat(width));
  console.log(statusLine);
}

async function convertFile(task: ConversionTask): Promise<void> {
  const { inputPath, outputPath } = task;
  
  // Normalize paths for command
  const normalizedInputPath = inputPath.replace(/\\/g, "/");
  const normalizedOutputPath = outputPath.replace(/\\/g, "/");

  const process = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-ffi",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "npm:avif",
      `--input=${normalizedInputPath}`,
      "--effort=1",
      "--quality=60",
      "--keep-metadata",
      "--verbose",
      `--output=${normalizedOutputPath}`
    ],
  });

  const { success } = await process.output();
  if (!success) throw new Error("Conversion failed");
}

async function processInParallel(tasks: ConversionTask[], sourceDir: string) {
  const progressInfo: ProgressInfo = {
    current: 0,
    total: tasks.length,
    startTime: Date.now(),
  };

  const queue = new TaskQueue(MAX_CONCURRENT_TASKS, sourceDir, progressInfo);
  
  // Add all tasks to queue
  for (const task of tasks) {
    await queue.add(task);
  }

  // Wait for all tasks to complete
  const results = await queue.waitForAll();
  
  return { 
    errorCount: results.errors, 
    progressInfo 
  };
}

async function convertToAvif(sourceDir: string) {
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

  const targetDir = `${sourceDir}_avif`;
  await ensureDir(targetDir);

  // Collect all image files and prepare tasks
  const tasks: ConversionTask[] = [];

  for await (const entry of walk(sourceDir)) {
    if (entry.isFile && SUPPORTED_EXTENSIONS.includes(extname(entry.path).toLowerCase())) {
      const relativePath = relative(sourceDir, entry.path);
      const targetPath = join(targetDir, dirname(relativePath));
      
      // Tạo thư mục nếu chưa tồn tại
      await ensureDir(targetPath);

      tasks.push({
        inputPath: entry.path,
        outputPath: targetPath,  // Chỉ truyền đường dẫn thư mục
        relativePath
      });
    }
  }

  if (tasks.length === 0) {
    console.log("No image files found in the specified directory.");
    Deno.exit(0);
  }

  console.log(`Found ${tasks.length} files to process.`);
  console.log(`Using ${MAX_CONCURRENT_TASKS} concurrent tasks.`);
  console.log("Converting files to AVIF format...\n");

  const { errorCount, progressInfo } = await processInParallel(tasks, sourceDir);

  // Display final statistics
  const totalTime = Date.now() - progressInfo.startTime;
  const averageTimePerFile = totalTime / tasks.length;
  const successCount = tasks.length - errorCount;

  console.log("\n\nFinal Statistics:");
  console.log("================");
  console.log(`Total time: ${formatDuration(totalTime)}`);
  console.log(`Average time per file: ${(averageTimePerFile / 1000).toFixed(2)} seconds`);
  console.log(`Total files processed: ${tasks.length}`);
  console.log(`Successfully converted: ${successCount}`);
  console.log(`Concurrent tasks: ${MAX_CONCURRENT_TASKS}`);
  if (errorCount > 0) {
    console.log(`Failed conversions: ${errorCount}`);
  }
  console.log(`Processing rate: ${(tasks.length / (totalTime / 1000)).toFixed(2)} files/second`);
}

// Main execution
if (import.meta.main) {
  const args = parse(Deno.args);
  const sourceDir = args._[0] as string;
  
  if (args.workers) {
    MAX_CONCURRENT_TASKS = parseInt(args.workers);
  }

  if (!sourceDir) {
    console.log("Please provide the source directory path.");
    console.log("Usage: deno run --allow-read --allow-write --allow-run --allow-env convert-to-avif.ts <source_directory> [--workers=N]");
    Deno.exit(1);
  }

  await convertToAvif(sourceDir);
}