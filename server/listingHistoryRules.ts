import type { Employee, ListingGenerationRecord } from "./types.js";

type Viewer = Pick<Employee, "id" | "role">;

export function visibleListingGenerationsForEmployee(
  records: ListingGenerationRecord[],
  viewer: Viewer,
) {
  return viewer.role === "管理员"
    ? records
    : records.filter((record) => record.generatedById === viewer.id);
}

export function canRestoreListingGeneration(record: ListingGenerationRecord, viewer: Viewer) {
  return viewer.role === "管理员" || record.generatedById === viewer.id;
}
