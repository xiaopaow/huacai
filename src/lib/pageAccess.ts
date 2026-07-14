import type { EmployeeAccount, PageKey } from "../types/domain";

const pagePermissions: Record<Exclude<EmployeeAccount["role"], "管理员">, PageKey[]> = {
  "运营": ["dashboard", "products", "create", "listings", "listingHistory", "tasks", "assets", "assetHistory", "settings"],
  "设计": ["dashboard", "create", "tasks", "assets", "assetHistory", "settings"],
  "审核": ["dashboard", "tasks", "reviews", "settings"],
};

export function canAccessPage(role: EmployeeAccount["role"], page: PageKey) {
  if (role === "管理员") return true;
  return pagePermissions[role].includes(page);
}

export function firstAccessiblePage(role: EmployeeAccount["role"]) {
  return role === "审核" ? "reviews" : "dashboard";
}
