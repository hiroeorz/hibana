/** 既存のディレクトリが存在する場合に用いるエラー */
export class ProjectDirExistsError extends Error {
  constructor(path: string) {
    super(`Target directory already exists: ${path}`);
    this.name = "ProjectDirExistsError";
  }
}

/** テンプレート取得時の失敗を表すエラー */
export class TemplateDownloadError extends Error {
  constructor(message?: string) {
    super(message ?? "Failed to download template repository.");
    this.name = "TemplateDownloadError";
  }
}

/** 設定ファイルの更新に失敗した場合のエラー */
export class ConfigUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigUpdateError";
  }
}
