// Constants used throughout the application
export const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tiff"];
export const ERROR_LOG_FILE = "error.txt";
export const RENAME_ERROR_LOG_FILE = "rename_error.txt";
export const CHECK_ERRORS_LOG_FILE = "check_errors.txt";
export const SHOW_RENAME_LOGS = false;           // Tắt log khi rename folder
export const SHOW_CONVERSION_LOGS = false;       // Tắt log khi convert file
export const SHOW_COMMAND_LOGS = false;          // Hiển thị output từ command
export const SKIP_EXISTING_FILES = true;         // Bỏ qua file đã tồn tại
export const DATE_FORMAT = "yyyy-MM-dd HH:mm:ss";
export const TEMP_DIR = "temp";                  // Thư mục lưu file tạm thời
export let MAX_CONCURRENT_WORKERS = navigator.hardwareConcurrency || 4; // Số folder xử lý song song (mỗi worker 1 folder)
export let MAX_RETRY_COUNT = 3;                  // Số lần thử lại tối đa cho các file lỗi

// Update concurrent workers setting
export function setMaxConcurrentWorkers(value: number): void {
  MAX_CONCURRENT_WORKERS = value;
}