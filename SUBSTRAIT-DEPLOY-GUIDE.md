# Substrait 链接 / 部署教程（给下一个项目复用）

> 适用：用 `substrait.sh` 这套 CLI 把静态前端 + 可选 Python 后端部署到 Substrait 平台的项目。
> 本文是「踩坑笔记」，不是官方文档。重点讲**最容易出错的链接/URL 迁移**，以及部署铁律。
> 最后更新：2026-11-06，平台 CLI 版本 `plugin v2026.11.05+`。

---

## 0. 一句话心智模型

- Substrait 平台 = 一个 **SSO 登录门（ingress）** + **CI/CD（cicd/）+ 一个 CLI 脚手架 `substrait.sh`**。
- 你本地只需要：`substrait.sh` 这个文件 + 一个 git 仓库。部署 = commit/push 后跑 `bash ./substrait.sh deploy`。
- 平台自动给你：① 一个 App URL（形如 `https://<slug>--dev.<org>.apps.substrait.build`）；② 可选的 OceanBase 数据库（声明即用）；③ SSO 实名（请求头注入）。

---

## 1. 第一次链接（login / link）

`link` 走 OAuth，会打开浏览器让你用公司 SSO 登录。成功后 CLI 把凭证写到这里：

```
~/.substrait/config.json              # 全局登录态（portal_url / token / profile / org / email）
~/.substrait/profiles/<host>.json     # 与上面内容几乎相同，按 profile 名索引
```

`config.json` 结构（**不要手写 token，link 会自动写**；此处只示意字段）：

```json
{
  "portal_url": "https://api.<org>.substrait.build",
  "token": "sbt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "profile": "api.<org>.substrait.build",
  "org": "<org>",
  "email": "you@<org>.co"
}
```

- `token` 是 `sbt_` 开头的**个人令牌**，按 org 作用域。换主机（见第 3 节）通常仍有效。
- `profile` 字段 = 去 `.json` 后缀的 profile 文件名。CLI 用它在 `profiles/` 里找对应文件。

**命令**：

```bash
cd <你的项目根>
bash ./substrait.sh link            # 交互式 OAuth，按提示在浏览器完成
bash ./substrait.sh update          # 拉取最新 CLI（见第 5 节）
```

> Windows / Git Bash 注意：命令必须是 `bash ./substrait.sh <cmd>`，**`bash substrait.sh <cmd>` 会报 `command not found` (exit 127)**。原因是新版脚本用 `"$0"` 自重执行，缺 `./` 在 IDE 管道下必崩。

---

## 2. 部署（deploy）

```bash
git add -A && git commit -m "..." && git push
bash ./substrait.sh deploy          # 必须等它跑到 ✅ Live 才结束（脚本会轮询 readiness）
```

- `deploy` 会先 `fetch_tools` 拉最新平台脚本，再构建后端（Docker）、跑数据库迁移、发布前端、等到 live 才返回。
- 前端是静态文件，后端是 `backend/` 经 `Dockerfile.backend`（FROM python:3.12-slim）构建。
- **push 不会自动发布**，必须显式 `deploy`。

### 2.1 上线后怎么验证（curl 只能验「门」，验不了「人」）

平台 SSO 会拦截未登录请求：

| 请求 | 未登录 curl 结果 | 含义 |
|---|---|---|
| 前端页 `/`、`/index.html` | `302` → SSO 登录 | 正常（页面受保护） |
| `/api/*` | `401 {}` | 正常（API 受保护） |

- 内部 readiness 探针打到 `/health` 拿到 `200 {"status":"ok"}` 后，app 才变 `✅ Live`。所以 401/302 是**期望行为**，不代表坏。
- 真正「谁登录看过」只能由**已登录的浏览器**触发（见第 4 节埋点）。curl 验不到，需人工登录确认。

### 2.2 常见非致命告警

- `openapi.json 滞后`：后端加了路由但 `openapi.json` 没更新 → 手动更新 `openapi.json` 再 deploy 一次即可消除。
- `Semgrep: findings detected`：通常是**非阻塞**项。`bash ./substrait.sh security status` 看 `blocking_total=0` 即可放心。
- 千万别把「地图 403 / 渲染失败」归因成缓存 / SSO / CDN。**真因几乎都是下载脚本只看字节数**，OSM 等外部源返回 HTTP 200 + 合法错误图被当成离线瓦片。生产禁用外部瓦片直连，用自绘矢量底图。

---

## 3. ⚠️ 平台换主机（URL 迁移）—— 最容易踩的坑

当平台通知「API 地址迁移」（例如我们这次：`api.substrait.build` → `api.ninjavan.substrait.build`），
**只改代码里的 URL 没用**——CLI 的目标主机来自 `~/.substrait` 里保存的 `portal_url`，不是你项目里的任何文件。

新版 CLI（`v2026.11.05+`）的行为：
- 它**从已保存的登录态读 `portal_url`**，绝不回退到 `$SUBSTRAIT_PORTAL_URL` 默认值。
- 所以必须把保存的 `portal_url` 改掉，否则 `deploy` 仍打老主机。

### 正确做法（三步，已验证）

1. **先验证 token 在新主机仍有效**（只读 GET，不改动任何东西）：

   ```bash
   TK=$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$HOME/.substrait/config.json")
   curl -s -o /dev/null -w "http=%{http_code}\n" \
        -H "Authorization: Bearer $TK" "https://api.<NEW_ORG>.substrait.build/api/projects"
   # 期望 200；/api/projects 会回你的项目列表（确认 token + org 有效）
   ```

2. **改两处 `portal_url`，并同步 `profile` 字段**（建议顺手把 profile 文件名也换成新主机，避免混淆）：

   - `$HOME/.substrait/config.json`：`portal_url` → 新主机；`profile` → `api.<NEW_ORG>.substrait.build`
   - 新建 `$HOME/.substrait/profiles/api.<NEW_ORG>.substrait.build.json`，内容与 config 一致（`portal_url`/`token`/`profile`/`org`/`email`）
   - 删掉旧的 `profiles/api.<OLD_ORG>.substrait.build.json`（内容已复制，删前可留 `.bak` 备份）

   > 关键细节：`profile` 字段是「按名字找文件」的索引。若只改 `portal_url` 不改 `profile`，CLI 仍去找旧文件名 → 找不到。两处必须一起改。

3. **重新 deploy** 让应用 ingress 指向新主机：`bash ./substrait.sh deploy`。

> 不要尝试 `logout` + 重新 `link` 走交互 OAuth 来迁主机——本机 CLI 无法替你开浏览器过 SSO。
> 直接改已保存的 `portal_url` + 复用现有 token 是最快且已验证可行的路径（同 org 令牌跨主机有效）。

### 3.1 区分三个地址面（2026-11-06 平台夜间迁移实例）

平台一次迁移往往同时动「三类地址」，但**只有 API 主机需要你改 config**，其余两个不用动你的项目：

| 地址面 | 例子（旧 → 新） | 谁用 | 你要改吗 |
|---|---|---|---|
| **API 主机** | `api.substrait.build` → `api.ninjavan.substrait.build` | CLI deploy / readiness 探针 | ✅ 改 `~/.substrait` 的 `portal_url`（见上） |
| **Web 控制台（Portal）** | `app.substrait.build` → `app.ninjavan.substrait.build` | 人工开浏览器管理部署 | ❌ 只是你打开网页的地址，项目/CLI 不用改 |
| **Claude 登录入口** | `/substrait:login` 改走 `ninjavan.substrait.build` | 从 Claude 里重新 link | ❌ 自动生效，重新 login 即可 |

> **最重要的 reassurance**：平台明确「已部署的应用不受影响，live app 继续在原链接工作」。
> 所以**换了主机不必 redeploy 你的 app**——除非你主动改了 `portal_url` 想让 ingress 落到新主机（那才需要再 `deploy` 一次）。
> 我们这次（2026-11-06）提前把 API 主机迁到了 `api.ninjavan.substrait.build`，与夜间迁移方向一致，app 一直正常。

---

## 4. 后端 + 数据库 + 实名（需要后端时才看）

### 4.1 声明数据库（OceanBase）

在 `substrait.yaml` 写：

```yaml
database: oceanbase
```

平台会**自动建共享 HA 集群**并注入环境变量 `DATABASE_URL`。注意：**引擎首次部署后数据库不可更改**（选型要一次定对）。

### 4.2 迁移（Flyway）

放 `backend/resources/db/migration/V1__init.sql`、`V2__...sql`：
- 平台自动发现并执行。
- 用 **MySQL 方言**：`BIGINT AUTO_INCREMENT`、`%s` 占位符；**禁** `SERIAL` / `RETURNING`。
- 建表用 `CREATE TABLE IF NOT EXISTS`，重跑安全。
- **禁**一次性 `ALTER` 同时加列 + 外键；**禁**自引用外键 `ON DELETE CASCADE`。
- **禁** f-string 拼 SQL，必须参数化。

### 4.3 连接范式（store.py）

- 懒解析 `DATABASE_URL`（percent-decode 用户名密码），`pymysql` 连接。
- `DATABASE_URL` 缺失 / 不可达时**静默降级**到 `backend/data/*.json` 文件存储（本地也能跑）。
- 日志只走 stdout，驱动 lazy import 不阻塞本地运行。
- 新增依赖写 `backend/requirements.txt` 并 pin 版本（如 `pymysql>=1.1`），Docker 用 `--only-binary=:all:` 装。

### 4.4 SSO 实名（零前端代码）

平台 SSO 层把登录邮箱注入请求头 **`x-forwarded-email`**。后端直接读它当 `actor`，**前端无需任何客户端代码**。
前端埋点用 `navigator.sendBeacon` / `fetch(keepalive)` **fire-and-forget，绝不阻塞渲染**。

---

## 5. CLI 维护命令

```bash
bash ./substrait.sh update     # 拉最新 CLI 脚手架（AGENTS.md / substrait.sh / SETUP.md / README.md / docs/）。
                               # 注意：update 只刷 CLI 与文档，不动 backend/、cicd/、substrait.yaml。
bash ./substrait.sh check      # 只读检查（不部署）
bash ./substrait.sh security status   # 看 Semgrep blocking_total
bash ./substrait.sh logs       # 看部署/运行日志
bash ./substrait.sh env        # 环境变量相关
bash ./substrait.sh library    # 资料库相关
bash ./substrait.sh logout     # 清除登录态（迁主机一般不用）
```

> `update` 可能改 `substrait.sh` 自身（例如 URL 解析逻辑）。更新后旧写法若失效，按本文第 1/3 节重新对齐。

---

## 6. .gitignore 坑（必看，否则部署缺文件）

仓库根 `.gitignore` 常带：

```
*.py          # 只放行 backend/main.py
*.sql         # 忽略所有 SQL
```

后果：你新建的 `backend/store.py`、迁移 `V1__*.sql` 会被**悄悄忽略**，部署时后端缺文件。
修复（在 `.gitignore` 末尾加白名单）：

```
!backend/store.py
!backend/resources/db/migration/**
backend/data/        # 运行时生成的 JSON，忽略
```

用 `git check-ignore backend/store.py` 验证（返回非 0 = 未被忽略 = 会被跟踪）。
根目录的构建脚本（`build_*.py` 等）也常被 `*.py` 忽略，按需逐个 `!` 放行。

---

## 7. 部署检查清单（每次发版前过一遍）

- [ ] `git status` 确认新后端文件（`.py` / `.sql`）**没有被 gitignore 吞掉**
- [ ] 后端改完 `py_compile backend/*.py` 通过
- [ ] 前端改完用 HTMLParser / 本地校验（标签闭合、无残留旧文案）
- [ ] 若加了 API 路由，同步更新 `openapi.json`
- [ ] `git commit && git push`
- [ ] `bash ./substrait.sh deploy` 跑到 `✅ Live`
- [ ] 登录后人工确认：页面能开、埋点能记（访问日志页能看到自己）
- [ ] 若平台有主机迁移：先按第 3 节改 `~/.substrait` 再 deploy
