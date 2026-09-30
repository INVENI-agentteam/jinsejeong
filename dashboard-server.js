import http from "node:http";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 파일을 파싱만 하고 process.env는 건드리지 않는다 (다른 프로젝트의 .env를 읽어도 전역 오염 없음).
function parseEnvFile(filePath) {
  const result = {};
  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return result;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const ORG = "INVENI-agentteam";
const ORGANIZATION_MD_PATH = path.join(__dirname, "ORGANIZATION.md");
const WORKSPACE_DIR = path.join(__dirname, ".workspaces");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const CACHE_TTL_MS = 60_000;
const IS_WINDOWS = process.platform === "win32";
const STALE_DAYS = 90;

// 봇 토큰/채팅 ID는 이 대시보드가 아니라 telegram-mcp 서버가 쓰는 .env를 그대로 공유해서 읽는다.
const TELEGRAM_ENV_PATH = "C:/Users/USER/Desktop/skill/telegram-mcp/.env";
const telegramEnv = parseEnvFile(TELEGRAM_ENV_PATH);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || telegramEnv.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || telegramEnv.TELEGRAM_CHAT_ID || "";
const TELEGRAM_CONFIGURED = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

async function notifyTelegram(text) {
  if (!TELEGRAM_CONFIGURED) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.error(`[telegram] 전송 실패 (${res.status}): ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[telegram] 전송 오류: ${err.message || err}`);
  }
}

// --- 커뮤니티 (Supabase) ---------------------------------------------------
const localEnv = parseEnvFile(path.join(__dirname, ".env"));
const SUPABASE_URL = process.env.SUPABASE_URL || localEnv.SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || localEnv.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

async function supabaseRequest(pathAndQuery, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function getCommunityPosts() {
  if (!SUPABASE_CONFIGURED) return [];
  try {
    const [contentsRes, usersRes] = await Promise.all([
      supabaseRequest("contents?select=*&order=created_at.desc"),
      supabaseRequest("user?select=id,name"),
    ]);
    if (!contentsRes.ok) return [];
    const contents = await contentsRes.json();
    const users = usersRes.ok ? await usersRes.json() : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return contents.map((c) => ({ ...c, author_name: nameById.get(c.user_id) || "알 수 없음" }));
  } catch {
    return [];
  }
}

async function findUserByName(name) {
  const res = await supabaseRequest(`user?name=eq.${encodeURIComponent(name)}&select=id,name&limit=1`);
  if (!res.ok) throw new Error(await res.text());
  const [user] = await res.json();
  return user || null;
}

async function createCommunityPost({ author, title, body }) {
  const user = await findUserByName(author);
  if (!user) throw new Error("user 테이블에 없는 이름입니다");

  const res = await supabaseRequest("contents", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ title, body, user_id: user.id }),
  });
  if (!res.ok) throw new Error(await res.text());
  const [post] = await res.json();
  return { ...post, author_name: user.name };
}

function isDash(value) {
  return /^-+$/.test(value.trim());
}

function parseOrgChart(markdown) {
  const tableLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  const dataLines = tableLines.slice(2); // skip header + separator row
  const rows = [];
  let lastBonbu = "";
  let lastBuseo = "";

  for (const line of dataLines) {
    const cols = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cols.length < 6) continue;
    let [no, bonbu, buseo, title, name, github] = cols;

    bonbu = isDash(bonbu) ? lastBonbu : bonbu;
    buseo = isDash(buseo) ? lastBuseo : buseo;
    lastBonbu = bonbu;
    lastBuseo = buseo;

    rows.push({
      no,
      title,
      name,
      github: isDash(github) ? null : github,
      bonbu,
      buseo,
    });
  }

  const tree = [];
  for (const row of rows) {
    let bonbuNode = tree.find((b) => b.name === row.bonbu);
    if (!bonbuNode) {
      bonbuNode = { name: row.bonbu, departments: [] };
      tree.push(bonbuNode);
    }
    let deptNode = bonbuNode.departments.find((d) => d.name === row.buseo);
    if (!deptNode) {
      deptNode = { name: row.buseo, people: [] };
      bonbuNode.departments.push(deptNode);
    }
    deptNode.people.push({
      no: row.no,
      title: row.title,
      name: row.name,
      github: row.github,
    });
  }

  return { rows, tree };
}

async function ghApi(endpoint) {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", endpoint, "-H", "Accept: application/vnd.github+json"],
    { maxBuffer: 20 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

// README는 아래 고정 템플릿을 따른다고 가정하고 파싱한다:
//   ## Agent명
//   <에이전트 이름>
//
//   ## 설명
//   <에이전트 설명>
function extractSection(markdown, headingPattern) {
  const headingRe = new RegExp(`^#{1,6}\\s*${headingPattern}\\s*$`, "i");
  const lines = markdown.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => headingRe.test(line.trim()));
  if (startIdx === -1) return null;

  const collected = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    collected.push(lines[i]);
  }
  const text = collected.join("\n").trim();
  return text || null;
}

function parseAgentReadme(markdown) {
  const nameBlock = extractSection(markdown, "Agent\\s*명");
  const descBlock = extractSection(markdown, "설명");
  const agentName = nameBlock ? nameBlock.split(/\r?\n/)[0].trim().replace(/^[-*]\s*/, "") : null;
  const agentDesc = descBlock ? descBlock.replace(/^[-*]\s*/gm, "").trim() : null;
  return {
    agentName,
    agentDesc,
    isTemplateFollowed: Boolean(agentName || agentDesc),
  };
}

async function getRepoReadme(fullName) {
  try {
    const data = await ghApi(`repos/${fullName}/readme`);
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return parseAgentReadme(content);
  } catch {
    return { agentName: null, agentDesc: null, isTemplateFollowed: false };
  }
}

// 최근 GitHub Actions 실행 결과로 "실제로 동작하는지"를 판단한다.
async function getRepoCiStatus(fullName) {
  try {
    const data = await ghApi(`repos/${fullName}/actions/runs?per_page=1`);
    const run = data.workflow_runs && data.workflow_runs[0];
    if (!run) return { status: "none", conclusion: null, url: null, updatedAt: null };
    const status = run.status === "completed" ? run.conclusion : run.status; // success/failure/in_progress 등
    return { status, conclusion: run.conclusion, url: run.html_url, updatedAt: run.updated_at };
  } catch {
    return { status: "unknown", conclusion: null, url: null, updatedAt: null };
  }
}

// Dependabot 보안 취약점 알림. 권한/설정 미비로 조회 자체가 안 되면 "unknown"으로 구분해 0건과 혼동하지 않는다.
async function getRepoVulnerabilities(fullName) {
  try {
    const alerts = await ghApi(`repos/${fullName}/dependabot/alerts?state=open&per_page=100`);
    return { count: Array.isArray(alerts) ? alerts.length : 0, known: true };
  } catch {
    return { count: 0, known: false };
  }
}

function shieldsSegment(text) {
  return encodeURIComponent(String(text).replace(/-/g, "--").replace(/_/g, "__").replace(/ /g, "_"));
}

function shieldsBadge(label, message, color) {
  return `https://img.shields.io/badge/${shieldsSegment(label)}-${shieldsSegment(message)}-${color}?style=flat-square&labelColor=1e1b17`;
}

function buildRepoBadges({ ci, vuln, license, pushedAt }) {
  const ciTextByStatus = {
    success: "passing",
    failure: "failing",
    in_progress: "in_progress",
    queued: "queued",
    cancelled: "cancelled",
    none: "no_CI",
    unknown: "unknown",
  };
  const ciColorByStatus = {
    success: "2ea043",
    failure: "f85149",
    in_progress: "d29922",
    queued: "d29922",
    cancelled: "8b949e",
    none: "8b949e",
    unknown: "8b949e",
  };
  const ciKey = ci.status in ciTextByStatus ? ci.status : "unknown";
  const buildBadge = shieldsBadge("build", ciTextByStatus[ciKey], ciColorByStatus[ciKey]);

  const licenseBadge = license
    ? shieldsBadge("license", license, "3178c6")
    : shieldsBadge("license", "none", "8b949e");

  const vulnBadge = !vuln.known
    ? shieldsBadge("security", "unknown", "8b949e")
    : vuln.count > 0
    ? shieldsBadge("security", `${vuln.count}_vulnerabilities`, "f85149")
    : shieldsBadge("security", "no_known_issues", "2ea043");

  const ageDays = Math.floor((Date.now() - new Date(pushedAt).getTime()) / 86_400_000);
  const commitBadge = shieldsBadge("last_commit", ageDays <= 0 ? "today" : `${ageDays}d_ago`, "58a6ff");

  return { buildBadge, licenseBadge, vulnBadge, commitBadge };
}

// --- 레포지토리 직접 실행 관리 -------------------------------------------
// 신뢰된 조직(ORG) 소속 레포지토리만 클론/실행 대상으로 허용한다.
const runManager = new Map(); // fullName -> { status, port, proc, logs, error }
let nextPort = 5300;

function appendLog(entry, text) {
  entry.logs.push(String(text));
  if (entry.logs.length > 300) entry.logs.shift();
}

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function killEntryProcess(entry) {
  if (!entry.proc) return;
  if (IS_WINDOWS) {
    execFile("taskkill", ["/PID", String(entry.proc.pid), "/T", "/F"], () => {});
  } else {
    try {
      entry.proc.kill("SIGTERM");
    } catch {}
  }
}

function startRun(fullName) {
  const existing = runManager.get(fullName);
  if (existing && (existing.status === "starting" || existing.status === "running")) {
    return existing;
  }

  const entry = { status: "starting", port: null, proc: null, logs: [], error: null };
  runManager.set(fullName, entry);

  (async () => {
    try {
      const dirName = fullName.replace("/", "__");
      const targetDir = path.join(WORKSPACE_DIR, dirName);
      await fs.mkdir(WORKSPACE_DIR, { recursive: true });

      if (await pathExists(targetDir)) {
        appendLog(entry, `[git] 기존 클론 발견 → pull...`);
        await execFileAsync("git", ["-C", targetDir, "pull", "--ff-only"]).catch((e) =>
          appendLog(entry, `[git] pull 실패(무시하고 진행): ${e.message}`)
        );
      } else {
        appendLog(entry, `[git] gh repo clone ${fullName} ...`);
        await execFileAsync("gh", ["repo", "clone", fullName, targetDir, "--", "--depth", "1"]);
      }

      let useNpmStart = false;
      try {
        const pkgRaw = await fs.readFile(path.join(targetDir, "package.json"), "utf-8");
        const pkg = JSON.parse(pkgRaw);
        useNpmStart = Boolean(pkg.scripts && pkg.scripts.start);
      } catch {}

      const port = nextPort++;
      entry.port = port;
      const env = { ...process.env, PORT: String(port) };

      let child;
      if (useNpmStart) {
        appendLog(entry, "[npm] install 중...");
        await new Promise((resolve, reject) => {
          const install = spawn(IS_WINDOWS ? "npm.cmd" : "npm", ["install"], { cwd: targetDir });
          install.stdout.on("data", (d) => appendLog(entry, d.toString()));
          install.stderr.on("data", (d) => appendLog(entry, d.toString()));
          install.on("error", reject);
          install.on("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`npm install 실패 (exit ${code})`))
          );
        });
        appendLog(entry, "[npm] start 중...");
        child = spawn(IS_WINDOWS ? "npm.cmd" : "npm", ["start"], { cwd: targetDir, env });
      } else {
        const candidates = ["index.js", "server.js", "app.js", "main.js"];
        let entryFile = null;
        for (const f of candidates) {
          if (await pathExists(path.join(targetDir, f))) {
            entryFile = f;
            break;
          }
        }
        if (!entryFile) {
          throw new Error(
            "실행 가능한 엔트리를 찾을 수 없습니다 (package.json의 start 스크립트 또는 index.js/server.js/app.js/main.js 필요)"
          );
        }
        appendLog(entry, `[node] node ${entryFile} 실행...`);
        child = spawn("node", [entryFile], { cwd: targetDir, env });
      }

      entry.proc = child;
      entry.status = "running";
      child.stdout.on("data", (d) => appendLog(entry, d.toString()));
      child.stderr.on("data", (d) => appendLog(entry, d.toString()));
      child.on("error", (err) => {
        entry.status = "error";
        entry.error = err.message || String(err);
        appendLog(entry, `[오류] ${entry.error}`);
      });
      child.on("exit", (code) => {
        const wasStopping = entry.status === "stopping";
        entry.status = wasStopping || code === 0 ? "stopped" : "error";
        if (!wasStopping && code !== 0) entry.error = `프로세스가 예기치 않게 종료되었습니다 (exit ${code})`;
        appendLog(entry, `[종료] exit code ${code}`);
      });
    } catch (err) {
      entry.status = "error";
      entry.error = err.message || String(err);
      appendLog(entry, `[오류] ${entry.error}`);
    }
  })();

  return entry;
}

function stopRun(fullName) {
  const entry = runManager.get(fullName);
  if (!entry) return { status: "idle", logs: [] };
  if (entry.proc && entry.status === "running") {
    entry.status = "stopping";
    killEntryProcess(entry);
    appendLog(entry, "[중지 요청됨]");
  } else {
    entry.status = "stopped";
  }
  return entry;
}

function serializeRunEntry(entry) {
  if (!entry) return { status: "idle", port: null, error: null, logs: "" };
  return {
    status: entry.status,
    port: entry.port,
    error: entry.error,
    logs: entry.logs.join(""),
  };
}
// --------------------------------------------------------------------------

let statsCache = null;
let statsCacheAt = 0;
let inFlightStatsPromise = null;
let previousRepoSnapshot = null; // fullName -> pushed_at, 텔레그램 등록/수정 감지용

async function notifyRepoChange(kind, fullName, result, personIndex) {
  const agent = result.agentInfoByRepo[fullName] || {};
  const repoObj = result.repos.find((r) => r.full_name === fullName);
  const contributors = Object.entries(result.byLogin)
    .filter(([, info]) => info.repos.some((r) => r.fullName === fullName))
    .map(([login]) => (personIndex[login] ? personIndex[login].name : login));

  const title = agent.agentName || (repoObj ? repoObj.name : fullName);
  const label = kind === "register" ? "🆕 신규 Agent 등록" : "🔄 Agent 업데이트";
  const lines = [
    `[INVENI Agent 모니터링] ${label}`,
    `Agent: ${title}`,
    contributors.length ? `담당자: ${contributors.join(", ")}` : null,
    `Repo: ${fullName}`,
    repoObj ? repoObj.html_url : null,
  ].filter(Boolean);

  await notifyTelegram(lines.join("\n"));
}

async function fetchOrgStats() {
  const result = { repos: [], members: [], byLogin: {}, agentInfoByRepo: {}, healthByRepo: {}, error: null };
  try {
    const [repos, members] = await Promise.all([
      ghApi(`orgs/${ORG}/repos?per_page=100`),
      ghApi(`orgs/${ORG}/members?per_page=100`),
    ]);
    result.repos = repos;
    result.members = members;

    for (const repo of repos) {
      const [contributors, agentInfo, ci, vuln] = await Promise.all([
        ghApi(`repos/${repo.full_name}/contributors?per_page=100`).catch(() => []),
        getRepoReadme(repo.full_name),
        getRepoCiStatus(repo.full_name),
        getRepoVulnerabilities(repo.full_name),
      ]);

      result.agentInfoByRepo[repo.full_name] = agentInfo;
      const license = repo.license ? repo.license.spdx_id : null;
      result.healthByRepo[repo.full_name] = {
        ci,
        vuln,
        license,
        badges: buildRepoBadges({ ci, vuln, license, pushedAt: repo.pushed_at }),
      };

      for (const c of contributors) {
        if (!c.login) continue;
        if (!result.byLogin[c.login]) {
          result.byLogin[c.login] = { repoCount: 0, commitCount: 0, repos: [] };
        }
        result.byLogin[c.login].repoCount += 1;
        result.byLogin[c.login].commitCount += c.contributions || 0;
        result.byLogin[c.login].repos.push({
          name: repo.name,
          fullName: repo.full_name,
          url: repo.html_url,
          createdAt: repo.created_at,
          pushedAt: repo.pushed_at,
        });
      }
    }

    if (TELEGRAM_CONFIGURED) {
      const currentSnapshot = new Map(repos.map((r) => [r.full_name, r.pushed_at]));
      if (previousRepoSnapshot) {
        const orgChartMarkdown = await fs.readFile(ORGANIZATION_MD_PATH, "utf-8").catch(() => "");
        const personIndex = orgChartMarkdown ? buildPersonIndex(parseOrgChart(orgChartMarkdown).tree) : {};
        for (const [fullName, pushedAt] of currentSnapshot) {
          const prevPushedAt = previousRepoSnapshot.get(fullName);
          if (prevPushedAt === undefined) {
            await notifyRepoChange("register", fullName, result, personIndex);
          } else if (prevPushedAt !== pushedAt) {
            await notifyRepoChange("update", fullName, result, personIndex);
          }
        }
      }
      previousRepoSnapshot = currentSnapshot;
    }
  } catch (err) {
    result.error = err.message || String(err);
  }

  return result;
}

async function getOrgStats() {
  const now = Date.now();
  if (statsCache && now - statsCacheAt < CACHE_TTL_MS) return statsCache;
  if (inFlightStatsPromise) return inFlightStatsPromise;

  inFlightStatsPromise = (async () => {
    const result = await fetchOrgStats();
    statsCache = result;
    statsCacheAt = Date.now();
    inFlightStatsPromise = null;
    return result;
  })();

  return inFlightStatsPromise;
}

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function buildPersonIndex(tree) {
  const index = {};
  for (const bonbu of tree) {
    for (const dept of bonbu.departments) {
      for (const person of dept.people) {
        if (person.github) {
          index[person.github] = { name: person.name, title: person.title, bonbu: bonbu.name, buseo: dept.name };
        }
      }
    }
  }
  return index;
}

// GitHub 기여자 기준으로 중복 없는 레포 목록을 만든다 (여러 명이 기여한 레포는 1건으로 집계).
function buildRepoEntries(stats, personIndex) {
  const map = new Map();
  for (const [login, info] of Object.entries(stats.byLogin)) {
    for (const repo of info.repos) {
      let entry = map.get(repo.fullName);
      if (!entry) {
        const agent = stats.agentInfoByRepo[repo.fullName] || {};
        const health = stats.healthByRepo[repo.fullName] || {};
        entry = {
          fullName: repo.fullName,
          name: repo.name,
          url: repo.url,
          createdAt: repo.createdAt,
          pushedAt: repo.pushedAt,
          agentName: agent.agentName,
          agentDesc: agent.agentDesc,
          isTemplateFollowed: agent.isTemplateFollowed,
          ci: health.ci,
          vuln: health.vuln,
          contributors: [],
        };
        map.set(repo.fullName, entry);
      }
      const person = personIndex[login];
      entry.contributors.push(person ? person.name : login);
    }
  }
  return Array.from(map.values());
}

function renderPage({ tree }, stats, communityPosts) {
  let totalPeople = 0;
  let mappedPeople = 0;
  let totalRegistered = 0;
  const now = Date.now();

  const personIndex = buildPersonIndex(tree);
  const repoEntries = buildRepoEntries(stats, personIndex);

  const recentEntries = [...repoEntries]
    .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
    .slice(0, 8);

  const staleEntries = repoEntries
    .filter((e) => {
      const ageDays = (now - new Date(e.pushedAt).getTime()) / 86_400_000;
      const ciFailing = e.ci && e.ci.status === "failure";
      const hasVulns = e.vuln && e.vuln.known && e.vuln.count > 0;
      return !e.isTemplateFollowed || ageDays > STALE_DAYS || ciFailing || hasVulns;
    })
    .sort((a, b) => new Date(a.pushedAt).getTime() - new Date(b.pushedAt).getTime());

  const deptStats = [];
  for (const bonbu of tree) {
    for (const dept of bonbu.departments) {
      let count = 0;
      for (const person of dept.people) {
        if (person.github && stats.byLogin[person.github]) count += stats.byLogin[person.github].repoCount;
      }
      deptStats.push({ label: `${bonbu.name} · ${dept.name}`, count });
    }
  }
  const maxDeptCount = Math.max(1, ...deptStats.map((d) => d.count));

  // 통계 카드 클릭 시 보여줄 상세 데이터
  const allPeopleFlat = [];
  for (const bonbu of tree) {
    for (const dept of bonbu.departments) {
      for (const person of dept.people) {
        const info = person.github ? stats.byLogin[person.github] : null;
        allPeopleFlat.push({
          bonbu: bonbu.name,
          buseo: dept.name,
          title: person.title,
          name: person.name,
          github: person.github,
          count: info ? info.repoCount : 0,
        });
      }
    }
  }
  const mappedPeopleFlat = allPeopleFlat.filter((p) => p.github).sort((a, b) => b.count - a.count);

  const registrationRecords = [];
  for (const [login, info] of Object.entries(stats.byLogin)) {
    const person = personIndex[login];
    for (const repo of info.repos) {
      const agent = stats.agentInfoByRepo[repo.fullName] || {};
      registrationRecords.push({
        personName: person ? person.name : login,
        repoFullName: repo.fullName,
        repoUrl: repo.url,
        agentName: agent.agentName,
        pushedAt: repo.pushedAt,
      });
    }
  }
  registrationRecords.sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime());

  const totalPeopleDetailHtml = allPeopleFlat.length
    ? `<table class="detail-table"><thead><tr><th>본부</th><th>부서</th><th>직급</th><th>이름</th><th>GitHub</th></tr></thead><tbody>${allPeopleFlat
        .map(
          (p) => `
        <tr>
          <td>${escapeHtml(p.bonbu)}</td>
          <td>${escapeHtml(p.buseo)}</td>
          <td>${escapeHtml(p.title)}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${p.github ? `<a href="https://github.com/${escapeHtml(p.github)}" target="_blank" rel="noopener">@${escapeHtml(p.github)}</a>` : '<span class="detail-muted">미등록</span>'}</td>
        </tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="section-empty">인원 정보가 없습니다.</div>`;

  const mappedPeopleDetailHtml = mappedPeopleFlat.length
    ? `<table class="detail-table"><thead><tr><th>이름</th><th>부서</th><th>GitHub</th><th>등록 건수</th></tr></thead><tbody>${mappedPeopleFlat
        .map(
          (p) => `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.buseo)}</td>
          <td><a href="https://github.com/${escapeHtml(p.github)}" target="_blank" rel="noopener">@${escapeHtml(p.github)}</a></td>
          <td>${p.count}건</td>
        </tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="section-empty">GitHub이 매핑된 인원이 없습니다.</div>`;

  const repoDetailHtml = stats.repos.length
    ? `<table class="detail-table"><thead><tr><th>레포지토리</th><th>Agent명</th><th>빌드</th><th>보안</th><th>최종수정일</th></tr></thead><tbody>${stats.repos
        .map((r) => {
          const agent = stats.agentInfoByRepo[r.full_name] || {};
          const health = stats.healthByRepo[r.full_name] || {};
          const badges = health.badges || {};
          return `
        <tr>
          <td><a href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener">${escapeHtml(r.full_name)}</a></td>
          <td>${agent.agentName ? escapeHtml(agent.agentName) : '<span class="detail-muted">형식 미준수</span>'}</td>
          <td>${badges.buildBadge ? `<img src="${escapeHtml(badges.buildBadge)}" alt="build" />` : "-"}</td>
          <td>${badges.vulnBadge ? `<img src="${escapeHtml(badges.vulnBadge)}" alt="security" />` : "-"}</td>
          <td>${formatDate(r.pushed_at)}</td>
        </tr>`;
        })
        .join("")}</tbody></table>`
    : `<div class="section-empty">등록된 레포지토리가 없습니다.</div>`;

  const registeredDetailHtml = registrationRecords.length
    ? `<table class="detail-table"><thead><tr><th>담당자</th><th>Agent</th><th>레포지토리</th><th>최종수정일</th></tr></thead><tbody>${registrationRecords
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.personName)}</td>
          <td>${r.agentName ? escapeHtml(r.agentName) : '<span class="detail-muted">형식 미준수</span>'}</td>
          <td><a href="${escapeHtml(r.repoUrl)}" target="_blank" rel="noopener">${escapeHtml(r.repoFullName)}</a></td>
          <td>${formatDate(r.pushedAt)}</td>
        </tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="section-empty">등록된 항목이 없습니다.</div>`;

  const bonbuHtml = tree
    .map((bonbu, bi) => {
      const deptHtml = bonbu.departments
        .map((dept, di) => {
          const peopleHtml = dept.people
            .map((person) => {
              totalPeople += 1;
              let badge = `<span class="badge badge-none">GitHub 미등록</span>`;
              let agentListHtml = "";
              let hasAgents = false;
              const searchTokens = [person.title, person.name];

              if (person.github) {
                mappedPeople += 1;
                searchTokens.push(person.github);
                const info = stats.byLogin[person.github];
                const count = info ? info.repoCount : 0;
                totalRegistered += count;
                const cls = count > 0 ? "badge-active" : "badge-zero";
                badge = `<a class="badge ${cls}" href="https://github.com/${escapeHtml(person.github)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                    <span class="gh-name">@${escapeHtml(person.github)}</span>
                    <span class="gh-count">${count}건</span>
                  </a>`;

                if (info && info.repos.length > 0) {
                  hasAgents = true;
                  agentListHtml = `<ul class="agent-list">${info.repos
                    .map((repo) => {
                      const agent = stats.agentInfoByRepo[repo.fullName] || {};
                      searchTokens.push(agent.agentName, repo.name, repo.fullName);
                      const nameLine = agent.agentName
                        ? escapeHtml(agent.agentName)
                        : `${escapeHtml(repo.name)} <span class="agent-noformat">(형식 미준수)</span>`;
                      const descLine = agent.agentDesc
                        ? escapeHtml(agent.agentDesc)
                        : "설명 없음 (README에 '## 설명' 섹션이 없습니다)";
                      const repoFullNameEsc = escapeHtml(repo.fullName);
                      const ageDays = Math.floor((now - new Date(repo.pushedAt).getTime()) / 86_400_000);
                      const staleTag = ageDays > STALE_DAYS ? `<span class="stale-tag">⚠ ${ageDays}일간 미수정</span>` : "";
                      const health = stats.healthByRepo[repo.fullName] || {};
                      const badges = health.badges || {};
                      const badgesHtml = badges.buildBadge
                        ? `<div class="agent-badges">
                            <img src="${escapeHtml(badges.buildBadge)}" alt="build status" />
                            <img src="${escapeHtml(badges.licenseBadge)}" alt="license" />
                            <img src="${escapeHtml(badges.vulnBadge)}" alt="security" />
                            <img src="${escapeHtml(badges.commitBadge)}" alt="last commit" />
                          </div>`
                        : "";
                      return `
                        <li class="agent-item" data-repo="${repoFullNameEsc}">
                          <div class="agent-name">🤖 ${nameLine}</div>
                          <div class="agent-desc">${descLine}</div>
                          ${badgesHtml}
                          <div class="agent-dates">
                            <span>최초등록일 ${formatDate(repo.createdAt)}</span>
                            <span>최종수정일 ${formatDate(repo.pushedAt)}</span>
                            ${staleTag}
                          </div>
                          <div class="agent-footer">
                            <a class="agent-repo" href="${escapeHtml(repo.url)}" target="_blank" rel="noopener">${repoFullNameEsc}</a>
                            <div class="run-controls">
                              <button type="button" class="run-btn">▶ 실행</button>
                              <a class="open-link" href="#" target="_blank" rel="noopener" style="display:none">↗ 새 창에서 열기</a>
                              <span class="run-status"></span>
                            </div>
                          </div>
                          <pre class="run-log" style="display:none"></pre>
                        </li>`;
                    })
                    .join("")}</ul>`;
                }
              }

              const searchAttr = escapeHtml(searchTokens.filter(Boolean).join(" ").toLowerCase());

              if (hasAgents) {
                return `
                  <li class="person-item" data-search="${searchAttr}">
                    <details class="person">
                      <summary class="person-row">
                        <span class="person-title">${escapeHtml(person.title)}</span>
                        <span class="person-name">${escapeHtml(person.name)}</span>
                        ${badge}
                      </summary>
                      ${agentListHtml}
                    </details>
                  </li>`;
              }

              return `
                <li class="person-row person-row-plain person-item" data-search="${searchAttr}">
                  <span class="person-title">${escapeHtml(person.title)}</span>
                  <span class="person-name">${escapeHtml(person.name)}</span>
                  ${badge}
                </li>`;
            })
            .join("");

          return `
            <details class="dept dept-block" open>
              <summary>${escapeHtml(dept.name)} <span class="count-pill">${dept.people.length}명</span></summary>
              <ul class="people-list">${peopleHtml}</ul>
            </details>`;
        })
        .join("");

      return `
        <details class="bonbu bonbu-block" ${bi === 0 ? "open" : ""}>
          <summary>${escapeHtml(bonbu.name)}</summary>
          <div class="dept-list">${deptHtml}</div>
        </details>`;
    })
    .join("");

  const errorBanner = stats.error
    ? `<div class="banner banner-error">GitHub 데이터를 불러오는 중 오류가 발생했습니다: ${escapeHtml(stats.error)}</div>`
    : "";

  const telegramBanner = TELEGRAM_CONFIGURED
    ? ""
    : `<div class="banner banner-info">📵 Telegram 알림이 꺼져 있습니다. telegram-mcp/.env에 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID를 설정하면 레포지토리 등록·수정 시 알림을 받을 수 있습니다.</div>`;

  const communityBanner = SUPABASE_CONFIGURED
    ? ""
    : `<div class="banner banner-info">📦 커뮤니티 기능이 꺼져 있습니다. .env에 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY를 설정하세요.</div>`;

  const communityListHtml = communityPosts.length
    ? communityPosts
        .map(
          (p, i) => `
          <tr>
            <td>${communityPosts.length - i}</td>
            <td>${escapeHtml(p.author_name)}</td>
            <td>${formatDate(p.created_at)}</td>
            <td>${escapeHtml(p.title)}</td>
            <td class="community-body-cell">${escapeHtml(p.body)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="section-empty">아직 등록된 글이 없습니다.</td></tr>`;

  const deptChartHtml = deptStats.length
    ? deptStats
        .map((d) => {
          const pct = Math.round((d.count / maxDeptCount) * 100);
          return `
            <div class="dept-bar-row">
              <div class="dept-bar-label">${escapeHtml(d.label)}</div>
              <div class="dept-bar-track"><div class="dept-bar-fill" style="width:${pct}%"></div></div>
              <div class="dept-bar-count">${d.count}건</div>
            </div>`;
        })
        .join("")
    : `<div class="section-empty">부서 데이터가 없습니다.</div>`;

  const recentHtml = recentEntries.length
    ? recentEntries
        .map((e) => {
          const isNew = Math.abs(new Date(e.createdAt).getTime() - new Date(e.pushedAt).getTime()) < 60_000;
          const tag = isNew
            ? `<span class="activity-tag tag-new">신규 등록</span>`
            : `<span class="activity-tag tag-update">업데이트</span>`;
          const title = e.agentName ? escapeHtml(e.agentName) : escapeHtml(e.name);
          return `
            <li class="activity-item">
              ${tag}
              <div class="activity-body">
                <div class="activity-title">🤖 ${title}</div>
                <div class="activity-meta">${escapeHtml(e.contributors.join(", "))} · <a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.fullName)}</a></div>
              </div>
              <div class="activity-date">${formatDate(e.pushedAt)}</div>
            </li>`;
        })
        .join("")
    : `<li class="section-empty">아직 등록된 활동이 없습니다.</li>`;

  const staleHtml = staleEntries.length
    ? staleEntries
        .map((e) => {
          const ageDays = Math.floor((now - new Date(e.pushedAt).getTime()) / 86_400_000);
          const reasons = [];
          if (!e.isTemplateFollowed) reasons.push("README 템플릿 미준수");
          if (ageDays > STALE_DAYS) reasons.push(`${ageDays}일간 업데이트 없음`);
          if (e.ci && e.ci.status === "failure") reasons.push("빌드 실패");
          if (e.vuln && e.vuln.known && e.vuln.count > 0) reasons.push(`보안 취약점 ${e.vuln.count}건`);
          return `
            <li class="warning-item">
              <div class="warning-title">${escapeHtml(e.name)} <span class="warning-owner">${escapeHtml(e.contributors.join(", "))}</span></div>
              <div class="warning-reasons">${reasons.map((r) => `<span class="warning-tag">${escapeHtml(r)}</span>`).join("")}</div>
              <a class="agent-repo" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.fullName)}</a>
            </li>`;
        })
        .join("")
    : `<li class="section-empty">방치되었거나 형식을 지키지 않은 레포지토리가 없습니다.</li>`;

  const staleDetailHtml = `<ul class="warning-list">${staleHtml}</ul>`;

  const guideDetailHtml = `
    <div class="guide">
      <div class="guide-step">
        <div class="guide-step-title">1. Organization 멤버로 초대받기</div>
        <p>본인 GitHub 계정이 <strong>${escapeHtml(ORG)}</strong> organization의 멤버로 초대되어 있어야 레포지토리를 생성/기여할 수 있습니다. 아직 초대받지 못했다면 ITC팀에 GitHub 아이디를 전달해 초대를 요청하세요.</p>
      </div>

      <div class="guide-step">
        <div class="guide-step-title">2. 레포지토리 생성 후 소스 업로드</div>
        <p>GitHub에서 <strong>${escapeHtml(ORG)}</strong> organization 아래에 새 레포지토리를 만든 뒤, 로컬 프로젝트에서 아래 명령으로 push 합니다.</p>
        <pre class="guide-code">git remote add origin https://github.com/${escapeHtml(ORG)}/&lt;레포지토리-이름&gt;.git
git add .
git commit -m "Initial commit"
git push -u origin main</pre>
      </div>

      <div class="guide-step">
        <div class="guide-step-title">3. README.md에 Agent 정보 작성 (필수)</div>
        <p>대시보드가 Agent명/설명을 자동으로 인식하도록 README.md에 아래 형식의 섹션을 반드시 포함해 주세요. 이 형식이 없으면 "형식 미준수"로 표시됩니다.</p>
        <pre class="guide-code">## Agent명
(에이전트 이름)

## 설명
(에이전트가 하는 일에 대한 한두 문장 설명)</pre>
      </div>

      <div class="guide-step">
        <div class="guide-step-title">4. 조직도(ORGANIZATION.md) 매핑 확인</div>
        <p>등록 건수 통계는 ORGANIZATION.md에 등록된 이름 ↔ GitHub 아이디 매핑을 기준으로 집계됩니다. 본인 GitHub 아이디가 조직도에 없다면 관리자에게 추가를 요청하세요.</p>
      </div>

      <div class="guide-step">
        <div class="guide-step-title">5. (선택) 빌드 · 라이선스 · 보안 배지 활성화</div>
        <ul class="guide-list">
          <li><strong>빌드 배지</strong>: <code>.github/workflows/</code>에 GitHub Actions 워크플로우를 추가하면 최근 실행 결과가 표시됩니다.</li>
          <li><strong>라이선스 배지</strong>: 레포지토리에 LICENSE 파일을 추가하면 자동 인식됩니다.</li>
          <li><strong>보안 배지</strong>: 레포지토리 Settings → Security에서 Dependabot alerts를 켜두면 취약점이 자동으로 감지됩니다.</li>
        </ul>
      </div>

      <div class="guide-step">
        <div class="guide-step-title">6. 반영 확인</div>
        <p>push 후 최대 1분 이내에 대시보드에 자동 반영됩니다. 신규 등록/업데이트 시 담당 팀 텔레그램으로 알림도 함께 전송됩니다.</p>
      </div>
    </div>`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>INVENI Agent 등록 통계 대시보드</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --surface: #16130f;
    --surface-container-lowest: #100e0a;
    --surface-container-low: #1e1b17;
    --surface-container: #221f1b;
    --surface-container-high: #2d2925;
    --surface-container-highest: #38342f;
    --on-surface: #e9e1da;
    --on-surface-variant: #d1c5b5;
    --outline: #9a8f81;
    --outline-variant: #4d463a;
    --primary: #e6c183;
    --on-primary: #422d00;
    --primary-container: #c5a368;
    --secondary-container: #454749;
    --on-secondary-container: #b4b5b7;
    --error: #ffb4ab;
    --error-container: #93000a;
    --on-error-container: #ffdad6;
    --ivory: #f9f8f3;
    --charcoal-deep: #0f1012;
    --gold-muted: #a68955;
    --glass-stroke: rgba(197, 163, 104, 0.2);
    --glow: rgba(197, 163, 104, 0.08);
    --radius-btn: 4px;
    --radius-card: 8px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Hanken Grotesk", "Segoe UI", system-ui, -apple-system, sans-serif;
    background: linear-gradient(180deg, var(--charcoal-deep) 0%, var(--surface) 55%, var(--surface) 100%);
    color: var(--on-surface);
    display: flex;
    min-height: 100vh;
  }

  .sidebar {
    flex-shrink: 0;
    width: 220px;
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 28px 16px;
    background: rgba(16, 14, 10, 0.5);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border-right: 1px solid var(--glass-stroke);
  }
  .sidebar-logo {
    font-family: "EB Garamond", Georgia, serif;
    font-size: 20px;
    font-weight: 500;
    color: var(--primary);
    letter-spacing: 0.04em;
    padding: 4px 12px 20px;
  }
  .nav-item {
    text-align: left;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--on-surface-variant);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-btn);
    padding: 10px 12px;
    cursor: pointer;
  }
  .nav-item:hover { background: rgba(230, 193, 131, 0.08); color: var(--ivory); }
  .nav-item.active {
    color: var(--on-primary);
    background: var(--primary);
    border-color: var(--primary);
  }

  .page-content {
    flex: 1;
    min-width: 0;
    max-width: 1440px;
    margin: 0 auto;
    padding: 64px;
  }

  @media (max-width: 900px) {
    body { display: block; }
    .sidebar {
      position: static;
      width: auto;
      height: auto;
      flex-direction: row;
      overflow-x: auto;
      border-right: none;
      border-bottom: 1px solid var(--glass-stroke);
    }
    .sidebar-logo { display: none; }
    .page-content { padding: 20px; }
  }

  h1 {
    font-family: "EB Garamond", Georgia, serif;
    font-weight: 500;
    font-size: 40px;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
    color: var(--ivory);
  }
  .subtitle {
    font-size: 16px;
    line-height: 1.6;
    color: var(--on-surface-variant);
    margin-bottom: 80px;
  }
  .subtitle strong { color: var(--primary); font-weight: 600; }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 80px;
    max-width: 1000px;
  }
  .stat-card {
    position: relative;
    background: rgba(34, 31, 27, 0.55);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    padding: 20px 22px;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .stat-card:hover {
    border-color: rgba(197, 163, 104, 0.4);
    box-shadow: 0 0 60px rgba(197, 163, 104, 0.05);
  }
  .stat-card .label {
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--primary);
    margin-bottom: 10px;
  }
  .stat-card .value { font-size: 32px; font-weight: 500; color: var(--ivory); font-variant-numeric: tabular-nums; }
  .stat-card .value.accent { color: var(--primary); }
  .stat-card .value.green { color: var(--primary); }
  .stat-card .value.warn { color: var(--error); }
  .stat-card[data-modal] { cursor: pointer; }
  .stat-card[data-modal]:focus-visible { outline: none; border-color: var(--primary); }

  .modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(15, 16, 18, 0.7);
    backdrop-filter: blur(4px);
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 24px;
  }
  .modal-overlay.open { display: flex; }
  .modal-box {
    width: 100%;
    max-width: 760px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-container);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    box-shadow: 0 20px 80px rgba(0, 0, 0, 0.5);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .modal-title { font-family: "EB Garamond", Georgia, serif; font-size: 20px; font-weight: 500; color: var(--ivory); }
  .modal-close {
    background: transparent;
    border: 1px solid var(--outline-variant);
    color: var(--on-surface-variant);
    border-radius: var(--radius-btn);
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 13px;
  }
  .modal-close:hover { border-color: var(--primary); color: var(--primary); }
  .modal-content { padding: 18px 22px; overflow-y: auto; }

  .detail-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .detail-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--primary);
    padding: 6px 10px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .detail-table td { padding: 8px 10px; border-bottom: 1px solid var(--outline-variant); color: var(--on-surface-variant); }
  .detail-table td a { color: var(--primary); text-decoration: none; }
  .detail-table td a:hover { text-decoration: underline; }
  .detail-table tbody tr:hover { background: rgba(230, 193, 131, 0.05); }
  .detail-table img { height: 16px; display: block; }

  .guide-btn {
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 50;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: var(--ivory);
    background: rgba(34, 31, 27, 0.6);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--primary);
    border-radius: var(--radius-btn);
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .guide-btn:hover { background: rgba(230, 193, 131, 0.14); }

  .guide-step { margin-bottom: 22px; }
  .guide-step:last-child { margin-bottom: 0; }
  .guide-step-title {
    font-family: "EB Garamond", Georgia, serif;
    font-weight: 500;
    font-size: 17px;
    color: var(--primary);
    margin-bottom: 6px;
  }
  .guide-step p { font-size: 13px; line-height: 1.65; color: var(--on-surface-variant); margin: 0 0 8px; }
  .guide-step strong { color: var(--ivory); font-weight: 600; }
  .guide-code {
    background: var(--surface-container-lowest);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-btn);
    padding: 12px 14px;
    font-family: "Hanken Grotesk", monospace;
    font-size: 12px;
    line-height: 1.7;
    color: var(--on-surface-variant);
    overflow-x: auto;
    white-space: pre;
  }
  .guide-list { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.7; color: var(--on-surface-variant); }
  .guide-list code {
    background: var(--surface-container-high);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 12px;
    color: var(--primary);
  }
  .detail-muted { color: var(--outline); font-size: 11px; }

  .panel-section { margin-bottom: 56px; max-width: 1000px; }
  .section-title {
    font-family: "EB Garamond", Georgia, serif;
    font-weight: 500;
    font-size: 22px;
    color: var(--ivory);
    margin-bottom: 16px;
  }
  .section-empty { color: var(--outline); font-size: 13px; padding: 12px 0; list-style: none; }

  .dept-chart {
    background: rgba(34, 31, 27, 0.45);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    padding: 18px 20px;
  }
  .dept-bar-row {
    display: grid;
    grid-template-columns: 200px 1fr 48px;
    align-items: center;
    gap: 14px;
    padding: 7px 0;
  }
  .dept-bar-label { font-size: 12.5px; color: var(--on-surface-variant); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dept-bar-track { height: 8px; background: var(--surface-container-high); border-radius: var(--radius-btn); overflow: hidden; }
  .dept-bar-fill { height: 100%; background: linear-gradient(90deg, var(--gold-muted), var(--primary)); border-radius: var(--radius-btn); }
  .dept-bar-count { font-size: 12px; color: var(--primary); text-align: right; font-variant-numeric: tabular-nums; }

  .activity-list, .warning-list { list-style: none; margin: 0; padding: 0; }
  .activity-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    background: rgba(34, 31, 27, 0.4);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    margin-bottom: 8px;
  }
  .activity-tag {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: var(--radius-btn);
  }
  .tag-new { color: var(--on-primary); background: var(--primary); }
  .tag-update { color: var(--on-surface-variant); background: var(--surface-container-high); border: 1px solid var(--outline-variant); }
  .activity-body { flex: 1; min-width: 0; }
  .activity-title { font-size: 13.5px; font-weight: 600; color: var(--ivory); }
  .activity-meta { font-size: 11.5px; color: var(--outline); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .activity-meta a { color: var(--outline); }
  .activity-date { flex-shrink: 0; font-size: 11px; color: var(--on-surface-variant); font-variant-numeric: tabular-nums; }

  .warning-item {
    padding: 12px 16px;
    background: rgba(147, 0, 10, 0.08);
    border: 1px solid rgba(255, 180, 171, 0.25);
    border-radius: var(--radius-card);
    margin-bottom: 8px;
  }
  .warning-title { font-size: 13.5px; font-weight: 600; color: var(--ivory); }
  .warning-owner { font-size: 11.5px; color: var(--outline); font-weight: 400; margin-left: 6px; }
  .warning-reasons { display: flex; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
  .warning-tag {
    font-size: 10.5px;
    color: var(--on-error-container);
    background: rgba(147, 0, 10, 0.2);
    border: 1px solid var(--error-container);
    padding: 2px 8px;
    border-radius: var(--radius-btn);
  }
  .stale-tag { color: var(--error); }

  .search-bar { max-width: 1000px; margin-bottom: 20px; }
  #search-input {
    width: 100%;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 14px;
    color: var(--ivory);
    background: rgba(34, 31, 27, 0.5);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-btn);
    padding: 12px 16px;
    outline: none;
    transition: border-color 0.15s ease;
  }
  #search-input:focus { border-color: var(--primary); }
  #search-input::placeholder { color: var(--outline); }

  .community-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .community-list-header .section-title { margin-bottom: 0; }

  .community-table-wrap {
    background: rgba(34, 31, 27, 0.45);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    padding: 8px 12px;
    overflow-x: auto;
  }
  .community-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .community-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--primary);
    padding: 10px 12px;
    border-bottom: 1px solid var(--outline-variant);
    white-space: nowrap;
  }
  .community-table td {
    padding: 12px;
    border-bottom: 1px solid var(--outline-variant);
    color: var(--on-surface-variant);
    vertical-align: top;
  }
  .community-table tr:hover td { background: rgba(230, 193, 131, 0.05); }
  .community-table td:first-child { color: var(--outline); width: 48px; }
  .community-table td:nth-child(2) { color: var(--ivory); font-weight: 600; white-space: nowrap; }
  .community-table td:nth-child(3) { white-space: nowrap; font-size: 12px; }
  .community-table td:nth-child(4) { color: var(--ivory); font-weight: 600; }
  .community-body-cell { white-space: pre-wrap; word-break: break-word; max-width: 480px; }

  .community-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: rgba(34, 31, 27, 0.45);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    padding: 18px 20px;
  }
  .community-form input,
  .community-form textarea {
    width: 100%;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 13.5px;
    color: var(--ivory);
    background: var(--surface-container-lowest);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-btn);
    padding: 10px 12px;
    outline: none;
  }
  .community-form input:focus,
  .community-form textarea:focus { border-color: var(--primary); }
  .community-form textarea { min-height: 140px; resize: vertical; font-family: inherit; }
  .community-form-buttons { display: flex; align-items: center; gap: 10px; }

  .banner { padding: 12px 16px; border-radius: var(--radius-card); font-size: 13px; margin-bottom: 24px; max-width: 1000px; }
  .banner-error { background: rgba(147, 0, 10, 0.25); color: var(--on-error-container); border: 1px solid var(--error-container); }
  .banner-info { background: rgba(230, 193, 131, 0.08); color: var(--on-surface-variant); border: 1px solid var(--glass-stroke); }

  .org-chart { max-width: 1000px; }
  details.bonbu {
    background: rgba(34, 31, 27, 0.45);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    margin-bottom: 16px;
    padding: 4px 4px;
  }
  details.bonbu > summary {
    cursor: pointer;
    font-family: "EB Garamond", Georgia, serif;
    font-weight: 500;
    font-size: 24px;
    color: var(--ivory);
    padding: 16px 20px;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  details.bonbu > summary::before {
    content: "▶";
    font-size: 11px;
    color: var(--primary);
    transition: transform 0.15s ease;
  }
  details.bonbu[open] > summary::before { transform: rotate(90deg); }
  details.bonbu > summary::-webkit-details-marker { display: none; }

  .dept-list { padding: 0 16px 16px 28px; }
  details.dept {
    border-left: 2px solid var(--outline-variant);
    margin: 10px 0;
    padding-left: 14px;
  }
  details.dept > summary {
    cursor: pointer;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--on-surface-variant);
    list-style: none;
    padding: 8px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  details.dept > summary::-webkit-details-marker { display: none; }
  details.dept > summary::before {
    content: "▸";
    color: var(--primary);
  }
  .count-pill {
    background: var(--surface-container-high);
    color: var(--on-surface-variant);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: var(--radius-btn);
    border: 1px solid var(--outline-variant);
  }

  .people-list { list-style: none; margin: 0; padding: 0; }
  details.person { margin: 2px 0; }
  details.person > summary { list-style: none; cursor: pointer; }
  details.person > summary::-webkit-details-marker { display: none; }
  details.person > summary::after {
    content: "▾";
    margin-left: 6px;
    color: var(--on-surface-variant);
    font-size: 11px;
  }
  .person-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: var(--radius-btn);
  }
  .person-row:hover { background: rgba(230, 193, 131, 0.06); }
  .person-row-plain { cursor: default; }

  .agent-list {
    list-style: none;
    margin: 4px 0 12px;
    padding: 0 0 0 20px;
    border-left: 2px dashed var(--outline-variant);
  }
  .agent-item {
    background: rgba(16, 14, 10, 0.5);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-card);
    padding: 12px 14px;
    margin: 8px 0;
  }
  .agent-name { font-family: "Hanken Grotesk", sans-serif; font-size: 14px; font-weight: 600; color: var(--ivory); margin-bottom: 4px; }
  .agent-noformat { font-weight: 400; color: var(--on-surface-variant); font-size: 11px; }
  .agent-desc { font-size: 13px; color: var(--on-surface-variant); line-height: 1.5; margin-bottom: 8px; white-space: pre-wrap; }
  .agent-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .agent-badges img { height: 18px; display: block; border-radius: 2px; }

  .agent-dates {
    display: flex;
    gap: 16px;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--outline);
    margin-bottom: 10px;
  }
  .agent-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--outline-variant);
  }
  .agent-repo { font-size: 11px; color: var(--primary); text-decoration: none; }
  .agent-repo:hover { text-decoration: underline; }

  .run-controls { display: flex; align-items: center; gap: 10px; }
  .run-btn {
    font-size: 12px;
    font-family: "Hanken Grotesk", sans-serif;
    font-weight: 600;
    color: var(--ivory);
    background: transparent;
    border: 1px solid var(--primary);
    border-radius: var(--radius-btn);
    padding: 5px 14px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .run-btn:hover { background: rgba(230, 193, 131, 0.12); }
  .run-btn:disabled { opacity: 0.45; cursor: default; }
  .run-btn.running { color: var(--on-primary); background: var(--primary); border-color: var(--primary); }
  .open-link { font-size: 11px; color: var(--primary); text-decoration: none; }
  .open-link:hover { text-decoration: underline; }
  .run-status { font-size: 11px; color: var(--on-surface-variant); }
  .run-log {
    margin: 10px 0 0;
    max-height: 140px;
    overflow: auto;
    background: var(--surface-container-lowest);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-btn);
    padding: 10px 12px;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1.6;
    color: var(--on-surface-variant);
    white-space: pre-wrap;
  }

  .person-title {
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
    background: transparent;
    border: 1px solid var(--glass-stroke);
    padding: 3px 9px;
    border-radius: var(--radius-btn);
    min-width: 64px;
    text-align: center;
  }
  .person-name { font-size: 15px; font-weight: 500; min-width: 64px; color: var(--ivory); }

  .badge {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: "Hanken Grotesk", sans-serif;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: var(--radius-btn);
    text-decoration: none;
    border: 1px solid var(--outline-variant);
  }
  .badge-none { color: var(--outline); }
  .badge-zero { color: var(--on-surface-variant); background: var(--surface-container-high); }
  .badge-active { color: var(--on-primary); background: var(--primary); border-color: var(--primary); font-weight: 700; }
  .gh-name { opacity: 0.85; }

  footer {
    margin-top: 80px;
    color: var(--outline);
    font-size: 12px;
    letter-spacing: 0.02em;
  }
</style>
</head>
<body>
  <button type="button" id="guide-btn" class="guide-btn">📘 등록가이드</button>

  <nav class="sidebar">
    <div class="sidebar-logo">INVENI</div>
    <button type="button" class="nav-item active" data-view="agent">Agent 등록 현황</button>
    <button type="button" class="nav-item" data-view="community">커뮤니티</button>
  </nav>

  <div class="detail-templates" style="display:none">
    <div id="detail-total-people">${totalPeopleDetailHtml}</div>
    <div id="detail-mapped-people">${mappedPeopleDetailHtml}</div>
    <div id="detail-repos">${repoDetailHtml}</div>
    <div id="detail-registered">${registeredDetailHtml}</div>
    <div id="detail-stale">${staleDetailHtml}</div>
    <div id="detail-guide">${guideDetailHtml}</div>
  </div>

  <div id="modal-overlay" class="modal-overlay">
    <div class="modal-box">
      <div class="modal-header">
        <div class="modal-title" id="modal-title"></div>
        <button type="button" class="modal-close" id="modal-close">✕</button>
      </div>
      <div class="modal-content" id="modal-content"></div>
    </div>
  </div>

  <div class="page-content">

  <div id="view-agent" class="view">

  <h1>INVENI Agent 등록 통계 대시보드</h1>
  <div class="subtitle">CLAUDE.md 조직도 × GitHub Organization <strong>${escapeHtml(ORG)}</strong> 등록 현황</div>

  ${errorBanner}
  ${telegramBanner}

  <div class="stats-grid">
    <div class="stat-card" data-modal="detail-total-people" data-title="전체 인원 (${totalPeople}명)"><div class="label">전체 인원</div><div class="value">${totalPeople}명</div></div>
    <div class="stat-card" data-modal="detail-mapped-people" data-title="GitHub 매핑 인원 (${mappedPeople}명)"><div class="label">GitHub 매핑 인원</div><div class="value accent">${mappedPeople}명</div></div>
    <div class="stat-card" data-modal="detail-repos" data-title="Org 레포지토리 (${stats.repos.length}개)"><div class="label">Org 레포지토리 수</div><div class="value">${stats.repos.length}개</div></div>
    <div class="stat-card" data-modal="detail-registered" data-title="총 등록 건수 (${totalRegistered}건)"><div class="label">총 등록 건수</div><div class="value green">${totalRegistered}건</div></div>
    <div class="stat-card" data-modal="detail-stale" data-title="방치 / 미준수 (${staleEntries.length}건)"><div class="label">방치 / 미준수</div><div class="value ${staleEntries.length > 0 ? "warn" : ""}">${staleEntries.length}건</div></div>
  </div>

  <section class="panel-section">
    <div class="section-title">부서별 등록 현황</div>
    <div class="dept-chart">${deptChartHtml}</div>
  </section>

  <section class="panel-section">
    <div class="section-title">최근 활동</div>
    <ul class="activity-list">${recentHtml}</ul>
  </section>

  <section class="panel-section">
    <div class="section-title">방치된 / 미준수 레포지토리</div>
    <ul class="warning-list">${staleHtml}</ul>
  </section>

  <div class="search-bar">
    <input id="search-input" type="text" placeholder="이름, 부서, GitHub 아이디, Agent명으로 검색..." autocomplete="off" />
  </div>

  <div class="org-chart">
    ${bonbuHtml}
  </div>

  <footer>마지막 갱신: ${new Date().toLocaleString("ko-KR")} · 60초 캐시 · gh CLI 기반 실시간 조회</footer>

  </div><!-- /view-agent -->

  <div id="view-community" class="view" style="display:none">

  <h1>커뮤니티</h1>
  <div class="subtitle">INVENI 조직도 기반 게시판</div>

  ${communityBanner}

  <section class="panel-section" id="community-list-view">
    <div class="community-list-header">
      <div class="section-title">등록된 글</div>
      <button type="button" id="community-write-btn" class="run-btn">✏ 글쓰기</button>
    </div>
    <div class="community-table-wrap">
      <table class="community-table">
        <thead><tr><th>순번</th><th>작성자</th><th>작성일</th><th>제목</th><th>내용</th></tr></thead>
        <tbody id="community-list">${communityListHtml}</tbody>
      </table>
    </div>
  </section>

  <section class="panel-section" id="community-write-view" style="display:none">
    <div class="section-title">글쓰기</div>
    <form id="community-form" class="community-form">
      <input id="community-author" type="text" placeholder="작성자" required />
      <input id="community-title" type="text" placeholder="제목" required />
      <textarea id="community-body" placeholder="내용을 입력하세요" required></textarea>
      <div class="community-form-buttons">
        <button type="button" id="community-cancel-btn" class="run-btn">← 취소</button>
        <button type="submit" class="run-btn">등록</button>
        <span id="community-form-status" class="run-status"></span>
      </div>
    </form>
  </section>

  </div><!-- /view-community -->

  </div><!-- /page-content -->

<script>
  const pollTimers = {};

  function renderRun(item, data) {
    const btn = item.querySelector(".run-btn");
    const link = item.querySelector(".open-link");
    const status = item.querySelector(".run-status");
    const log = item.querySelector(".run-log");

    btn.classList.toggle("running", data.status === "running");
    btn.disabled = data.status === "starting" || data.status === "stopping";

    if (data.status === "running") {
      btn.textContent = "■ 중지";
      status.textContent = "실행 중 (포트 " + data.port + ")";
      link.style.display = "inline";
      link.href = "http://localhost:" + data.port;
    } else if (data.status === "starting") {
      btn.textContent = "⏳ 준비 중";
      status.textContent = "클론/설치/시작 중...";
      link.style.display = "none";
    } else if (data.status === "stopping") {
      btn.textContent = "⏳ 중지 중";
      status.textContent = "중지하는 중...";
      link.style.display = "none";
    } else if (data.status === "error") {
      btn.textContent = "▶ 실행";
      status.textContent = "오류: " + (data.error || "알 수 없음");
      link.style.display = "none";
    } else if (data.status === "stopped") {
      btn.textContent = "▶ 실행";
      status.textContent = "중지됨";
      link.style.display = "none";
    } else {
      btn.textContent = "▶ 실행";
      status.textContent = "";
      link.style.display = "none";
    }

    if (data.logs) {
      log.style.display = "block";
      log.textContent = data.logs;
      log.scrollTop = log.scrollHeight;
    }
  }

  async function fetchStatus(repo) {
    const res = await fetch("/api/status?repo=" + encodeURIComponent(repo));
    return res.json();
  }

  function pollStatus(item, repo) {
    clearInterval(pollTimers[repo]);
    pollTimers[repo] = setInterval(async () => {
      try {
        const data = await fetchStatus(repo);
        renderRun(item, data);
        if (data.status === "stopped" || data.status === "error" || data.status === "idle") {
          clearInterval(pollTimers[repo]);
        }
      } catch {
        clearInterval(pollTimers[repo]);
      }
    }, 1200);
  }

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".run-btn");
    if (!btn) return;
    const item = btn.closest(".agent-item");
    if (!item) return; // 커뮤니티 등 다른 곳에서 재사용하는 run-btn 클래스는 여기서 처리하지 않는다
    e.preventDefault();
    const repo = item.dataset.repo;
    const stopping = btn.classList.contains("running");
    btn.disabled = true;
    try {
      const res = await fetch(stopping ? "/api/stop" : "/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      const data = await res.json();
      renderRun(item, data);
      if (!stopping) pollStatus(item, repo);
    } catch (err) {
      item.querySelector(".run-status").textContent = "요청 실패: " + err.message;
    } finally {
      btn.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".agent-item[data-repo]").forEach(async (item) => {
      const repo = item.dataset.repo;
      try {
        const data = await fetchStatus(repo);
        renderRun(item, data);
        if (data.status === "starting" || data.status === "running" || data.status === "stopping") {
          pollStatus(item, repo);
        }
      } catch {}
    });
  });

  function applyFilter(query) {
    const q = query.trim().toLowerCase();
    document.querySelectorAll(".bonbu-block").forEach((bonbu) => {
      let bonbuHasMatch = false;
      bonbu.querySelectorAll(".dept-block").forEach((dept) => {
        let deptHasMatch = false;
        dept.querySelectorAll(".person-item").forEach((item) => {
          const hay = item.dataset.search || "";
          const match = !q || hay.includes(q);
          item.style.display = match ? "" : "none";
          if (match) deptHasMatch = true;
        });
        dept.style.display = deptHasMatch ? "" : "none";
        if (q && deptHasMatch) dept.open = true;
        if (deptHasMatch) bonbuHasMatch = true;
      });
      bonbu.style.display = bonbuHasMatch ? "" : "none";
      if (q && bonbuHasMatch) bonbu.open = true;
    });
  }

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => applyFilter(e.target.value));
  }

  function closeModal() {
    document.getElementById("modal-overlay").classList.remove("open");
  }

  function openModal(sourceId, title) {
    const src = document.getElementById(sourceId);
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-content").innerHTML = src ? src.innerHTML : "";
    document.getElementById("modal-overlay").classList.add("open");
  }

  document.querySelectorAll(".stat-card[data-modal]").forEach((card) => {
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    const trigger = () => openModal(card.dataset.modal, card.dataset.title);
    card.addEventListener("click", trigger);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        trigger();
      }
    });
  });

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  document.getElementById("guide-btn").addEventListener("click", () => openModal("detail-guide", "📘 Agent 등록 가이드"));

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach((v) => (v.style.display = "none"));
      document.getElementById("view-" + btn.dataset.view).style.display = "block";
    });
  });

  function escapeHtmlJs(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function formatDateJs(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  }

  function renderCommunityList(posts) {
    const tbody = document.getElementById("community-list");
    if (!posts.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="section-empty">아직 등록된 글이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = posts
      .map(
        (p, i) =>
          "<tr>" +
          "<td>" + (posts.length - i) + "</td>" +
          "<td>" + escapeHtmlJs(p.author_name) + "</td>" +
          "<td>" + formatDateJs(p.created_at) + "</td>" +
          "<td>" + escapeHtmlJs(p.title) + "</td>" +
          '<td class="community-body-cell">' + escapeHtmlJs(p.body) + "</td>" +
          "</tr>"
      )
      .join("");
  }

  async function refreshCommunityList() {
    const res = await fetch("/api/community");
    const data = await res.json();
    renderCommunityList(data.posts || []);
  }

  function showCommunityList() {
    document.getElementById("community-list-view").style.display = "block";
    document.getElementById("community-write-view").style.display = "none";
  }

  function showCommunityWrite() {
    document.getElementById("community-list-view").style.display = "none";
    document.getElementById("community-write-view").style.display = "block";
  }

  const communityWriteBtn = document.getElementById("community-write-btn");
  if (communityWriteBtn) communityWriteBtn.addEventListener("click", showCommunityWrite);

  const communityCancelBtn = document.getElementById("community-cancel-btn");
  if (communityCancelBtn) communityCancelBtn.addEventListener("click", showCommunityList);

  const communityForm = document.getElementById("community-form");
  if (communityForm) {
    console.log("[community] form found, submit listener attached");
    communityForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("[community] submit event fired");
      const status = document.getElementById("community-form-status");
      try {
        const authorEl = document.getElementById("community-author");
        const titleEl = document.getElementById("community-title");
        const bodyEl = document.getElementById("community-body");
        const author = authorEl.value.trim();
        const title = titleEl.value.trim();
        const body = bodyEl.value.trim();
        if (!author || !title || !body) {
          status.textContent = "작성자/제목/내용을 모두 입력하세요";
          return;
        }
        status.textContent = "등록 중...";
        const res = await fetch("/api/community", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author, title, body }),
        });
        const data = await res.json();
        console.log("[community] POST /api/community response", res.status, data);
        if (!res.ok) throw new Error(data.error || "등록 실패");
        status.textContent = "";
        authorEl.value = "";
        titleEl.value = "";
        bodyEl.value = "";
        await refreshCommunityList();
        showCommunityList();
      } catch (err) {
        console.error("[community] 등록 처리 중 오류", err);
        if (status) status.textContent = "오류: " + err.message;
      }
    });
  } else {
    console.error("[community] #community-form 요소를 찾지 못했습니다");
  }

  window.addEventListener("error", (e) => {
    console.error("[page error]", e.message, e.filename, e.lineno, e.colno, e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[unhandled rejection]", e.reason);
  });
</script>
</body>
</html>`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const markdown = await fs.readFile(ORGANIZATION_MD_PATH, "utf-8");
      const orgChart = parseOrgChart(markdown);
      const [stats, communityPosts] = await Promise.all([getOrgStats(), getCommunityPosts()]);
      const html = renderPage(orgChart, stats, communityPosts);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Server error: ${err.message || err}`);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/community") {
    const posts = await getCommunityPosts();
    console.log(`[community] GET /api/community → ${posts.length}건`);
    sendJson(res, 200, { posts });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/community") {
    try {
      if (!SUPABASE_CONFIGURED) throw new Error("Supabase가 설정되지 않았습니다");
      const { author, title, body } = await readJsonBody(req);
      console.log(`[community] POST /api/community 요청: author=${author}, title=${title}`);
      if (!author || !title || !body) throw new Error("작성자/제목/내용을 모두 입력하세요");
      const post = await createCommunityPost({ author, title, body });
      console.log(`[community] 등록 성공: id=${post.id}`);
      sendJson(res, 200, { post });
    } catch (err) {
      console.error(`[community] 등록 실패: ${err.message || err}`);
      sendJson(res, 400, { error: err.message || String(err) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    const repo = url.searchParams.get("repo");
    sendJson(res, 200, serializeRunEntry(repo ? runManager.get(repo) : null));
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/run" || url.pathname === "/api/stop")) {
    try {
      const { repo } = await readJsonBody(req);
      if (!repo || typeof repo !== "string") throw new Error("repo 파라미터가 필요합니다");
      if (!repo.startsWith(`${ORG}/`)) throw new Error("허용되지 않은 레포지토리입니다");

      const entry = url.pathname === "/api/run" ? startRun(repo) : stopRun(repo);
      sendJson(res, 200, serializeRunEntry(entry));
    } catch (err) {
      sendJson(res, 400, { status: "error", error: err.message || String(err) });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`INVENI Agent 대시보드 실행 중: http://localhost:${PORT}`);
  if (TELEGRAM_CONFIGURED) {
    console.log("[telegram] 레포지토리 등록/수정 알림이 활성화되었습니다.");
  } else {
    console.log("[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID가 없어 알림이 비활성화되어 있습니다 (.env 참고).");
  }
  if (SUPABASE_CONFIGURED) {
    console.log("[supabase] 커뮤니티 기능이 활성화되었습니다.");
  } else {
    console.log("[supabase] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY가 없어 커뮤니티 기능이 비활성화되어 있습니다 (.env 참고).");
  }
  getOrgStats().catch((err) => console.error(`[stats] 초기 조회 오류: ${err.message || err}`));
  setInterval(() => {
    getOrgStats().catch((err) => console.error(`[stats] 갱신 오류: ${err.message || err}`));
  }, CACHE_TTL_MS);
});
