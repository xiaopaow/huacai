import { describe, expect, it } from "vitest";
import { directActivityWriteDisabledResponse } from "./activityRules.js";

describe("activity rules", () => {
  it("disables direct browser writes so employee metrics remain system-recorded", () => {
    expect(directActivityWriteDisabledResponse()).toEqual({
      status: 410,
      body: {
        code: "ACTIVITY_DIRECT_WRITE_DISABLED",
        error: "工作量统计由系统业务流程自动记录，不能手动写入",
      },
    });
  });
});
