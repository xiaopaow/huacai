import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
const skipDocker = process.argv.includes("--skip-docker");
const errors = [];
const warnings = [];
const ok = [];

function parseEnv(source) {
  const result = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function strongPassword(value) {
  return value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function runCommand(command, args) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    };
  } catch {
    return { ok: false, output: "" };
  }
}

let env = {};
try {
  env = parseEnv(await readFile(envPath, "utf8"));
  ok.push("已找到 .env.local");
} catch {
  errors.push("缺少 .env.local：请先复制 .env.example 并填写生产配置");
}

for (const key of ["INITIAL_ADMIN_PASSWORD", "INITIAL_EMPLOYEE_PASSWORD"]) {
  const value = env[key] ?? "";
  if (!strongPassword(value) || /replace|changeme|password|123456/i.test(value)) {
    errors.push(`${key} 必须设置为至少 12 位且同时包含字母和数字的非示例密码`);
  } else {
    ok.push(`${key} 已设置强密码`);
  }
}
if (env.INITIAL_ADMIN_PASSWORD && env.INITIAL_ADMIN_PASSWORD === env.INITIAL_EMPLOYEE_PASSWORD) {
  errors.push("管理员与员工初始密码不能相同");
}

if (!env.OPENAI_API_KEY) warnings.push("未配置 OPENAI_API_KEY，生图和 AI Listing 将不可用");
else ok.push("AI API Key 已配置（值未显示）");

for (const key of ["OPENAI_IMAGE_API_URL", "OPENAI_TEXT_API_URL", "OUTBOUND_PROXY"]) {
  const value = env[key];
  if (!value) continue;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    errors.push(`${key} 不是有效的 HTTP(S) URL`);
  }
}

if (env.CORS_ORIGINS) {
  for (const value of env.CORS_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value.replace(/\/$/, "")) throw new Error("invalid origin");
    } catch {
      errors.push(`CORS_ORIGINS 包含无效来源：${value}`);
    }
  }
}

if (env.AMAZON_MODE === "production") {
  if (env.AMAZON_PRODUCTION_CONFIRMATION !== "I_UNDERSTAND") {
    errors.push("Amazon 正式模式缺少 AMAZON_PRODUCTION_CONFIRMATION=I_UNDERSTAND");
  }
  for (const key of ["AMAZON_SELLER_ID", "AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET", "AMAZON_REFRESH_TOKEN"]) {
    if (!env[key]) errors.push(`Amazon 正式模式缺少 ${key}`);
  }
} else {
  ok.push("Amazon 保持 sandbox 模式，不会写入真实店铺");
}

const dataDirectory = resolve(root, "data");
try {
  await mkdir(resolve(dataDirectory, "uploads"), { recursive: true });
  await mkdir(resolve(dataDirectory, "backups"), { recursive: true });
  await access(dataDirectory, constants.R_OK | constants.W_OK);
  const probe = resolve(dataDirectory, `.deploy-write-${randomUUID()}`);
  await writeFile(probe, "ok", { flag: "wx" });
  await rm(probe);
  ok.push("data 持久化目录可读写");
} catch {
  errors.push("data 目录不可写；Linux 服务器请执行 sudo chown -R 1000:1000 data");
}

if (!skipDocker) {
  const dockerVersion = runCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (!dockerVersion.ok || !dockerVersion.output) errors.push("Docker 服务未启动或当前用户无权访问 Docker");
  else ok.push(`Docker 服务可用（${dockerVersion.output}）`);

  const composeConfig = runCommand("docker", ["compose", "--env-file", "deploy/compose.env.example", "config", "--quiet"]);
  if (!composeConfig.ok) errors.push("Docker Compose 配置校验失败");
  else ok.push("Docker Compose 配置校验通过");
}

for (const message of ok) console.log(`✓ ${message}`);
for (const message of warnings) console.warn(`! ${message}`);
for (const message of errors) console.error(`✗ ${message}`);
console.log(`\n结果：${errors.length} 个错误，${warnings.length} 个提醒`);
if (errors.length) process.exitCode = 1;
