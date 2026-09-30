# INVENI Agent 등록 통계 대시보드

INVENI 임직원들이 GitHub organization(`INVENI-agentteam`)에 등록한 agent(레포지토리)를 모니터링하기 위한 대시보드입니다. 조직도(`ORGANIZATION.md`)와 GitHub 등록 현황을 매핑해서 누가 어떤 agent를 등록했는지, 정상 동작하는지, 방치되지 않았는지를 한눈에 보여줍니다.

## Agent명
INVENI Agent 등록 통계 대시보드

## 설명
INVENI 임직원들이 GitHub organization에 등록한 agent를 모니터링하는 대시보드입니다. 조직도와 GitHub 등록 현황을 매핑해 누가 어떤 agent를 등록했는지, 빌드·보안 상태가 정상인지, 오래 방치된 건 아닌지를 한눈에 보여주고, 신규 등록·수정 시 Telegram 알림을 보내며 조직 구성원용 커뮤니티 게시판도 제공합니다.

## 주요 기능

### Agent 등록 현황
- **조직도**: `ORGANIZATION.md` 기반 본부 → 부서 → 인원 트리, 펼치기/접기 가능
- **통계 카드**: 전체 인원 / GitHub 매핑 인원 / Org 레포지토리 수 / 총 등록 건수 / 방치·미준수 건수 — 클릭 시 상세 목록 팝업
- **부서별 등록 현황**: 본부·부서별 등록 건수 막대그래프
- **최근 활동**: 최근 등록/수정된 agent 타임라인
- **방치된 / 미준수 레포지토리 경고**: README 템플릿 미준수, 90일 이상 미수정, 빌드 실패, 보안 취약점을 자동 감지해 사유와 함께 표시
- **Agent 카드**: README의 `## Agent명` / `## 설명` 섹션을 파싱해 표시, 최초등록일 · 최종수정일, 빌드/라이선스/보안/최근 커밋 상태를 shields.io 배지로 표시
- **검색/필터**: 이름, 부서, GitHub 아이디, Agent명으로 조직도 필터링
- **실행 버튼**: 등록된 레포지토리를 서버가 직접 clone → `npm start` 또는 `node index.js` 등으로 실행하고 로그를 실시간으로 표시 (신뢰된 organization 소속 레포만 허용)
- **등록가이드 팝업**: 신규 agent 등록 절차와 README 템플릿 안내
- **Telegram 알림**: organization에 새 레포가 등록되거나 기존 레포가 업데이트되면 Telegram으로 알림 전송

### 커뮤니티
- Supabase 기반 게시판. 등록된 글을 순번·작성자·작성일·제목·내용으로 목록 표시
- 글쓰기 → 등록 시 `contents` 테이블에 저장 (작성자는 `user` 테이블과 FK로 연결)

## 실행 방법

```bash
node dashboard-server.js
```

기본 포트는 `4173`이며 `PORT` 환경변수로 변경할 수 있습니다. 서버가 뜨면 `http://localhost:4173` 에서 확인할 수 있습니다.

### 사전 준비물
- Node.js 18+ (내장 `fetch` 사용)
- [GitHub CLI(`gh`)](https://cli.github.com/) 설치 및 `INVENI-agentteam` organization 조회 권한으로 로그인
- Git (실행 버튼 기능이 레포지토리를 clone할 때 사용)

## 환경변수

### Telegram 알림
이 프로젝트가 아니라 `telegram-mcp` 서버가 쓰는 `.env`를 그대로 읽습니다 (`C:/Users/USER/Desktop/skill/telegram-mcp/.env`).

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### Supabase (커뮤니티 기능)
프로젝트 루트의 `.env`에 설정합니다.

```
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
```

값이 없으면 커뮤니티/Telegram 기능은 비활성화되고 대시보드 상단에 안내 배너가 표시될 뿐, 나머지 기능은 정상 동작합니다.

## 파일 구조

| 파일 | 설명 |
| --- | --- |
| `dashboard-server.js` | 대시보드 서버 본체 (Node.js, 외부 프레임워크 없이 `node:http`로 구현) |
| `ORGANIZATION.md` | INVENI 조직도 데이터 (본부/부서/직급/이름/GitHub 아이디) |
| `CLAUDE.md` | 프로젝트 작업 시 참고하는 행동 지침, 조직도는 `ORGANIZATION.md` 참조 |
| `DESIGN.md` | 대시보드 디자인 시스템 정의 |
| `index.js` | 별도의 GitHub MCP 서버 (이 대시보드와 무관하게 Claude Code MCP 연동용) |

## 기술 스택
- Node.js (`node:http`, `node:child_process` 등 내장 모듈만 사용, 외부 npm 의존성 없음)
- GitHub REST API (`gh` CLI 경유)
- Supabase (Postgres + REST API)
- Telegram Bot API
- shields.io (배지 이미지)
