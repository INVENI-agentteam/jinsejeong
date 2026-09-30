import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// index.js가 위치한 폴더를 기준으로 .env를 읽는다 (실행 위치 무관)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error(
    `[github-mcp] GITHUB_TOKEN이 설정되지 않았습니다. ` +
      `${path.join(__dirname, ".env")} 파일을 확인하세요.`
  );
  process.exit(1);
}

const GITHUB_API_BASE = "https://api.github.com";

async function githubGet(endpoint, params) {
  const url = new URL(`${GITHUB_API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "github-mcp",
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GitHub API 오류 (${res.status}): ${data.message ?? JSON.stringify(data)}`);
  }
  return data;
}

const sortOrderShape = {
  order: z.enum(["asc", "desc"]).optional().describe("정렬 방향 (기본값: desc)"),
  per_page: z.number().int().min(1).max(100).optional().describe("결과 개수 (기본값: 10, 최대 100)"),
};

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

const server = new McpServer({ name: "github-mcp", version: "1.0.0" });

server.tool(
  "search_repositories",
  "GitHub 리포지토리를 검색한다. GitHub 검색 쿼리 문법(예: 'language:python stars:>1000')을 지원한다.",
  {
    query: z.string().min(1).describe("GitHub 검색 쿼리 (예: 'mcp server language:typescript')"),
    sort: z
      .enum(["stars", "forks", "help-wanted-issues", "updated"])
      .optional()
      .describe("정렬 기준 (기본값: best match)"),
    ...sortOrderShape,
  },
  async ({ query, sort, order, per_page }) => {
    const data = await githubGet("/search/repositories", {
      q: query,
      sort,
      order,
      per_page: per_page ?? 10,
    });

    if (!data.items?.length) {
      return textResult("검색 결과가 없습니다.");
    }

    const lines = data.items.map((repo) => {
      const desc = repo.description ? ` - ${repo.description}` : "";
      return `- ${repo.full_name} (★${repo.stargazers_count})${desc}\n  ${repo.html_url}`;
    });
    return textResult(`총 ${data.total_count}개 중 ${data.items.length}개 표시:\n\n${lines.join("\n")}`);
  }
);

server.tool(
  "search_issues",
  "GitHub 이슈/PR을 검색한다. GitHub 검색 쿼리 문법(예: 'repo:owner/repo is:issue is:open')을 지원한다.",
  {
    query: z
      .string()
      .min(1)
      .describe("GitHub 검색 쿼리 (예: 'repo:facebook/react is:issue is:open label:bug')"),
    sort: z
      .enum(["comments", "reactions", "created", "updated"])
      .optional()
      .describe("정렬 기준 (기본값: best match)"),
    ...sortOrderShape,
  },
  async ({ query, sort, order, per_page }) => {
    const data = await githubGet("/search/issues", {
      q: query,
      sort,
      order,
      per_page: per_page ?? 10,
    });

    if (!data.items?.length) {
      return textResult("검색 결과가 없습니다.");
    }

    const lines = data.items.map((issue) => {
      const type = issue.pull_request ? "PR" : "Issue";
      return `- [${type} #${issue.number}] ${issue.title} (${issue.state})\n  ${issue.html_url}`;
    });
    return textResult(`총 ${data.total_count}개 중 ${data.items.length}개 표시:\n\n${lines.join("\n")}`);
  }
);

server.tool(
  "search_organizations",
  "GitHub organization을 검색한다.",
  {
    query: z.string().min(1).describe("검색할 organization 이름 또는 키워드"),
    ...sortOrderShape,
  },
  async ({ query, order, per_page }) => {
    const data = await githubGet("/search/users", {
      q: `${query} type:org`,
      order,
      per_page: per_page ?? 10,
    });

    if (!data.items?.length) {
      return textResult("검색 결과가 없습니다.");
    }

    const lines = data.items.map((org) => `- ${org.login}\n  ${org.html_url}`);
    return textResult(`총 ${data.total_count}개 중 ${data.items.length}개 표시:\n\n${lines.join("\n")}`);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
