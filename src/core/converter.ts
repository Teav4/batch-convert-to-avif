import { exists, move } from "https://deno.land/std/fs/mod.ts";
import { basename, extname, join } from "https://deno.land/std/path/mod.ts";
import { ConversionTask } from "../interfaces/types.ts";
import {
  SHOW_COMMAND_LOGS,
  SHOW_CONVERSION_LOGS,
  TEMP_DIR
} from "../utils/constants.ts";
import {
  ensureTempDir,
  generateRandomId
} from "../utils/helpers.ts";

// Copy a file to temp directory with a simpler name
async function copyToTemp(sourcePath: string, tempDir: string): Promise<string> {
  // Create a simple name for the temp file (no special chars)
  const ext = extname(sourcePath);
  const tempFilePath = join(tempDir, `temp_file${ext}`);
  
  try {
    // Copy the original file to temp location with simple name
    await Deno.copyFile(sourcePath, tempFilePath);
    return tempFilePath;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create temp copy of file: ${errorMessage}`);
  }
}

// Convert a single file to AVIF format
export async function convertFile(task: ConversionTask): Promise<void> {
  const { inputPath, outputPath } = task;
  
  // Create temporary file with random ID 
  await ensureTempDir();
  const tempOutputId = generateRandomId();
  const tempFolderPath = join(TEMP_DIR, tempOutputId);
  await Deno.mkdir(tempFolderPath, { recursive: true });
  
  // Create a copy of the source file with a simple name
  const tempInputFile = await copyToTemp(inputPath, tempFolderPath);
  
  // Normalize paths for command - avif doesn't handle spaces and parentheses well
  const normalizedInputPath = tempInputFile.replace(/\\/g, "/");
  const normalizedTempPath = tempFolderPath.replace(/\\/g, "/");

  // Log file đang xử lý
  if (SHOW_CONVERSION_LOGS) {
    console.log(`\nProcessing: ${inputPath}`);
    console.log(`Temp input file: ${tempInputFile}`);
    console.log(`Temp output folder: ${tempFolderPath}`);
    console.log(`Final output folder: ${outputPath}\n`);
  }

  // Get just the filename without extension from input path
  const outputFileName = basename(tempInputFile, extname(tempInputFile)) + ".avif";

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
      `--output=${normalizedTempPath}`
    ],
    stderr: "piped",
    stdout: "piped"
  });

  const { success, stderr, stdout } = await process.output();
  
  // Decode và hiển thị log
  if (SHOW_COMMAND_LOGS) {
    const outputLog = new TextDecoder().decode(stdout);
    const errorLog = new TextDecoder().decode(stderr);
    
    console.log("\n-------------------- COMMAND OUTPUT --------------------");
    console.log(`Original Input: ${inputPath}`);
    console.log(`Temp Input: ${normalizedInputPath}`);
    console.log(`Temp output folder: ${normalizedTempPath}`);
    
    if (outputLog.trim()) {
      console.log("\nStandard Output:");
      console.log(outputLog);
    }
    
    if (errorLog.trim()) {
      console.log("\nStandard Error:");
      console.log(errorLog);
    }
    
    console.log("--------------------------------------------------------\n");
  }
  
  if (!success) {
    try {
      // Clean up temp directory if it exists
      await Deno.remove(tempFolderPath, { recursive: true }).catch(() => {});
    } catch (_) {
      // Ignore errors when removing temp directory
    }
    
    // Decode and get the error message
    const errorMessage = new TextDecoder().decode(stderr);
    const outputLog = new TextDecoder().decode(stdout);
    
    // Log full error details for debugging
    const detailedError = `
-------------------- CONVERSION ERROR --------------------
Original Input: ${inputPath}
Temp Input: ${normalizedInputPath}
Temp output folder: ${normalizedTempPath}
Error: ${errorMessage}
Output: ${outputLog}
--------------------------------------------------------`;
    
    // Throw detailed error message to be logged in error.txt
    throw new Error(`Conversion failed: ${errorMessage.trim() || "Unknown error"}\n${detailedError}`);
  }
  
  // Expected output file in temp directory
  const tempAvifFilePath = join(tempFolderPath, outputFileName);
  
  // Check if temporary file was created
  if (!await exists(tempAvifFilePath)) {
    throw new Error(`Conversion did not produce expected output file: ${tempAvifFilePath}`);
  }
  
  // Rename the file to sequential numbering
  const targetFileName = `${(task.originalIndex + 1).toString().padStart(3, '0')}.avif`;
  const finalOutputPath = join(outputPath, targetFileName);
  
  // Move the temp file to the final location
  try {
    await move(tempAvifFilePath, finalOutputPath, { overwrite: true });
    
    // Clean up temp directory after successful move
    await Deno.remove(tempFolderPath, { recursive: true }).catch(() => {});
  } catch (error: any) {
    console.error(`Error moving file from ${tempAvifFilePath} to ${finalOutputPath}: ${error.message}`);
    throw new Error(`Failed to move temporary file: ${error.message}`);
  }
}