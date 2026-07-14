export interface BackupSummary {
  name: string;
  createdAt: string;
}

export function normalizedBackupRetention(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 14;
  return Math.min(90, Math.max(3, Math.floor(parsed)));
}

export function backupsToPrune<T extends BackupSummary>(backups: T[], retention: number) {
  return [...backups]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(Math.max(3, retention));
}
