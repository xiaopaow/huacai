export function directActivityWriteDisabledResponse() {
  return {
    status: 410,
    body: {
      code: "ACTIVITY_DIRECT_WRITE_DISABLED",
      error: "工作量统计由系统业务流程自动记录，不能手动写入",
    },
  };
}
