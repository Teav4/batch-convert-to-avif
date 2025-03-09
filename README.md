# AVIF Conversion Tool

A high-performance tool for bulk converting images to AVIF format with parallel folder processing.

## Features

- **Multi-folder Processing**: Process multiple folders concurrently
- **Sequential File Processing**: Process files within each folder sequentially for better organization
- **Automatic Directory Structure Preservation**: Maintains your folder structure in the output
- **Special Character Handling**: Automatically renames folders with special characters for compatibility
- **Progress Tracking**: Visual progress bar with time estimation
- **Error Recovery**: Automatic retry for failed conversions
- **Verification**: Verifies that all files were processed correctly

## Requirements

- [Deno](https://deno.land/) (v1.20.0 or later)
- Supported operating systems: Windows, macOS, Linux

## Installation

1. Install Deno from https://deno.land/
2. Clone or download this repository

## Usage

### Basic Usage

```bash
run.bat <source_directory> [workers]
```

For example:
```bash
run.bat "C:\Photos\Vacation" 4
```

### Parameters

- `<source_directory>`: The directory containing images to convert
- `[workers]` (optional): Number of concurrent folder processes (default: number of CPU cores)

## Supported File Formats

- PNG (.png)
- JPEG (.jpg, .jpeg)
- BMP (.bmp)
- GIF (.gif)
- TIFF (.tiff)

## Output

Converted files are saved to a new directory with the same name as the source directory plus "_avif" suffix.

For example, if your source directory is "C:\Photos\Vacation", the output will be "C:\Photos\Vacation_avif".

## How It Works

1. The tool scans the source directory for supported image files
2. It organizes files by their parent folders
3. Up to `workers` concurrent processes handle different folders simultaneously  
4. Files within each folder are processed sequentially and renamed to sequential numbers (001.avif, 002.avif, etc.)
5. Errors are logged and retry attempts are made when necessary
6. After processing, a verification step checks that all source files have corresponding output files

## Advanced Configuration

You can modify the following constants in `src/utils/constants.ts`:

- `SKIP_EXISTING_FILES`: Skip files that already exist in the target directory
- `MAX_RETRY_COUNT`: Maximum number of retry attempts for failed conversions
- `SHOW_CONVERSION_LOGS`: Enable detailed logging for each file conversion
- `SHOW_RENAME_LOGS`: Enable logs for folder renaming operations

## Error Handling

Error logs are saved in the following files:
- `error.txt`: Contains errors related to file conversion
- `rename_error.txt`: Contains errors related to folder renaming
- `check_errors_[foldername].txt`: Contains information about any mismatches between source and output directories

## License

This project is provided as-is with no warranty. Use at your own risk.