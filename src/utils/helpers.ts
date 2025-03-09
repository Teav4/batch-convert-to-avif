import { join, dirname, basename, extname, relative } from "https://deno.land/std/path/mod.ts";
import { format } from "https://deno.land/std/datetime/mod.ts";
import { FileError, RenameError } from "../interfaces/types.ts";
import { ERROR_LOG_FILE, RENAME_ERROR_LOG_FILE, DATE_FORMAT } from "./constants.ts";

// Generate random ID for temporary files
export function generateRandomId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// Sanitize path by removing special characters
export function sanitizePath(path: string): string {
  return path.replace(/[<>:"\/\\|?*()[\]{}]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
}

// Write error to log file
export async function writeErrorLog(error: FileError): Promise<void> {
  const logEntry = `${error.timestamp} - Error processing '${error.filePath}': ${error.error}\n`;
  await Deno.writeTextFile(ERROR_LOG_FILE, logEntry, { append: true });
}

// Write rename errors to log file
export async function writeRenameErrorLog(error: RenameError): Promise<void> {
  const logEntry = `${error.timestamp} - Error renaming from '${error.oldPath}' to '${error.newPath}': ${error.error}\n`;
  await Deno.writeTextFile(RENAME_ERROR_LOG_FILE, logEntry, { append: true });
}

// Get the first level folder from a file path
export function getFirstLevelFolder(filePath: string, basePath: string): string {
  const relativePath = relative(basePath, filePath);
  return relativePath.split(/[\/\\]/)[0];
}

// Format duration from milliseconds to HH:MM:SS
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Display progress information
export async function showProgress(info: { current: number; total: number; startTime: number }): Promise<void> {
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
  
  const currentTime = new Date().toISOString().replace('T', ' ').split('.')[0];
  const statusLine = 
    `\r${progressBar} ${current}/${total} (${percentComplete}%) - ${rateStr} files/sec - ` +
    `Elapsed: ${elapsedTime} - Remaining: ${remainingTime} - Tasks: ${(await import("./constants.ts")).MAX_CONCURRENT_TASKS}\n` +
    `Current time: ${currentTime}`;
  
  console.log("\r" + " ".repeat(width));
  console.log(statusLine);
}

// Create and ensure temporary directory exists
export async function ensureTempDir(): Promise<void> {
  const { ensureDir } = await import("https://deno.land/std/fs/mod.ts");
  const { TEMP_DIR } = await import("./constants.ts");
  await ensureDir(TEMP_DIR);
}

// Get a temporary file path with random ID
export async function getTempFilePath(extension: string = ".tmp"): Promise<string> {
  const { join } = await import("https://deno.land/std/path/mod.ts");
  const { TEMP_DIR } = await import("./constants.ts");
  return join(TEMP_DIR, `temp_${generateRandomId()}${extension}`);
}