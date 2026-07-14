import type { AmazonListing, Employee } from "./types.js";

export function publicListingForEmployee(
  listing: AmazonListing,
  viewer: Pick<Employee, "id" | "role">,
) {
  if (viewer.role === "管理员") return { ...listing };
  return {
    ...listing,
    ownerName: listing.ownerId === viewer.id ? listing.ownerName : "团队成员",
    lastEditedByName: listing.lastEditedById === viewer.id ? listing.lastEditedByName : "团队成员",
  };
}
