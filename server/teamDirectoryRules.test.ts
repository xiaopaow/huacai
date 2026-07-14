import { describe, expect, it } from "vitest";
import { publicTeamDirectoryEntry, visibleTeamDirectory } from "./teamDirectoryRules.js";
import type { Employee } from "./types.js";

function employee(id: string, role: Employee["role"], active = true): Employee {
  return {
    id,
    username: id,
    passwordHash: "hash",
    name: id,
    department: role,
    role,
    active,
  };
}

const employees = [
  employee("admin", "管理员"),
  employee("ops", "运营"),
  employee("designer", "设计"),
  employee("reviewer", "审核"),
  employee("disabled-designer", "设计", false),
];

describe("team directory visibility", () => {
  it("shows assignable designers and admins to admins and operators", () => {
    expect(visibleTeamDirectory(employees, { id: "admin", role: "管理员" }).map((item) => item.id)).toEqual([
      "admin",
      "designer",
    ]);
    expect(visibleTeamDirectory(employees, { id: "ops", role: "运营" }).map((item) => item.id)).toEqual([
      "admin",
      "designer",
    ]);
  });

  it("shows only self to designers and reviewers", () => {
    expect(visibleTeamDirectory(employees, { id: "designer", role: "设计" }).map((item) => item.id)).toEqual(["designer"]);
    expect(visibleTeamDirectory(employees, { id: "reviewer", role: "审核" }).map((item) => item.id)).toEqual(["reviewer"]);
  });

  it("publishes only safe directory fields", () => {
    expect(publicTeamDirectoryEntry(employees[0])).toEqual({
      id: "admin",
      name: "admin",
      department: "管理员",
      role: "管理员",
    });
  });
});
