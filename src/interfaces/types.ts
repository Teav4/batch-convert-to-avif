// Types
export interface ProgressInfo {
  current: number;
  total: number;
  startTime: number;
}

export interface FileError {
  timestamp: string;
  filePath: string;
  error: string;
}

export interface RenameError {
  timestamp: string;
  oldPath: string;
  newPath: string;
  error: string;
}

export interface ConversionTask {
  inputPath: string;
  outputPath: string;
  relativePath: string;
  originalIndex: number; // Index for sequential numbering
}

export interface FolderConversionTask {
  folderPath: string;
  files: ConversionTask[];
  errorFiles: ConversionTask[];
  completed: boolean;
}

export interface DirectoryMismatch {
  sourceDir: string;
  targetDir: string;
  sourceDirFileCount: number;
  targetDirFileCount: number;
  difference: number;
}