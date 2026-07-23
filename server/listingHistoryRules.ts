import type { Employee, ListingGenerationRecord } from "./types.js";

type Viewer = Pick<Employee, "id" | "role">;

export function visibleListingGenerationsForEmployee(
  records: ListingGenerationRecord[],
  viewer: Viewer,
) {
  const activeRecords = records.filter((record) => !record.deletedAt);
  return viewer.role === "管理员"
    ? activeRecords
    : activeRecords.filter((record) => record.generatedById === viewer.id);
}

export function canRestoreListingGeneration(record: ListingGenerationRecord, viewer: Viewer) {
  return !record.deletedAt && (viewer.role === "管理员" || record.generatedById === viewer.id);
}

export function canDeleteListingGeneration(record: ListingGenerationRecord, viewer: Viewer) {
  return !record.deletedAt && (viewer.role === "管理员" || record.generatedById === viewer.id);
}
