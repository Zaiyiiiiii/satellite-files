# Satellite Files

一个类似 [copyparty](https://github.com/9001/copyparty) 的文件服务器，编译为 **WASIp3 HTTP 组件**（`wasi:http/service@0.3.0` + `wasi:filesystem@0.3.0`），由 wasmtime 运行。界面简洁、现代，自带亮色/暗色主题。只提供 HTTP + Web UI，不包含 WebDAV、FTP、SMB 这类额外协议。

## 功能

- **浏览**：列表/网格两种视图，按名称、大小、修改时间排序，面包屑导航，图片缩略图
- **上传**：拖拽文件或整个文件夹（拖到某个文件夹行上就传进那个文件夹），按文件显示进度和速度，3 路并发；同名文件可选择替换、保留两者或跳过；上传以流式写入临时文件，完成后才重命名到位，失败的上传不会留下残缺文件
- **文件管理**：新建文件夹、重命名（F2）、移动（文件夹选择器，或把条目拖到文件夹/面包屑上）、删除，支持批量选择（Shift 连选、Ctrl/⌘+A 全选）
- **预览**：图片灯箱（方向键/滑动切换）、视频、PDF、文本/代码、Markdown 渲染
- **音乐播放器**：底部悬浮播放条，自动播放下一首，接入系统媒体键（Media Session）
- **下载**：单文件直接下载（支持 Range，可拖动进度、断点续传）；文件夹或多选时打包成 `.tar` 流式下载
- **搜索**：在当前文件夹下递归按文件名搜索（按 `/` 聚焦搜索框）
- **账号与权限**：可选的账号密码登录（HMAC 签名的 Cookie），按路径分别设置 `r` / `w` / `m` / `d` 权限；支持只能上传、看不到内容的"投递箱"文件夹
- **多卷**：每个 `--dir` 预打开目录都是一个卷，挂载到它的 guest 路径下

## 构建与运行

需要 Rust ≥ 1.98（`wasm32-wasip2` target，仓库内的 `rust-toolchain.toml` 会自动选用）和 wasmtime ≥ 49：

```sh
rustup target add wasm32-wasip2
cargo install wasmtime-cli --version 49.0.1 --locked   # 或下载预编译版本

./serve.sh ./data 127.0.0.1:8080
```

也可以手动运行：

```sh
cargo build --release
wasmtime serve -Scli -Sp3 -Wcomponent-model-async \
  --addr 0.0.0.0:8080 \
  --dir ./data::/ \
  --dir ~/Music::/music \
  target/wasm32-wasip2/release/satellite_files.wasm
```

`-Scli` 让 `wasmtime serve` 除了 HTTP 之外也提供文件系统、环境变量等 WASI 接口。

## 配置

所有配置都通过环境变量传入（`wasmtime serve --env KEY=VALUE`，`serve.sh` 会自动转发）：

| 变量 | 说明 |
| --- | --- |
| `SF_TITLE` | 站点名称，默认 `Satellite` |
| `SF_ACCOUNTS` | 账号列表：`alice:密码1,bob:密码2` |
| `SF_ACCESS` | 访问规则（见下文） |
| `SF_SECRET` | Cookie 签名密钥。不设置时由账号列表派生，修改任意密码后所有会话都会失效 |
| `SF_MAX_UPLOAD` | 单文件上传上限（MiB），`0` 表示不限制 |

### 访问规则

`SF_ACCESS` 由 `;` 分隔的规则组成，每条规则的格式是 `路径:对象=权限,对象=权限`。对某个路径生效的是**最长前缀匹配**的那条规则。

- 对象：`*`（所有人，包括匿名访客）、`@acct`（任何已登录用户）或具体用户名
- 权限：`r` 浏览/下载，`w` 上传/新建文件夹，`m` 移动/重命名，`d` 删除（覆盖已有文件也需要 `d`），`a` = 全部

默认值：

- 没有配置账号：`/:*=rwmd`（和 copyparty 一样，所有人可读写）
- 配置了账号：`/:*=r,@acct=rwmd`

示例：

```sh
SF_ACCOUNTS='alice:s3cret,bob:hunter2' \
SF_ACCESS='/:*=r,@acct=rw,alice=rwmd; /private:alice=rwmd; /inbox:*=w,alice=rwmd' \
./serve.sh ./data 0.0.0.0:8080
```

在这个例子中，`/inbox` 是一个投递箱：任何人都可以上传，但只有 alice 能看到里面的内容。

## HTTP 接口

Web UI 使用的是一组很小的 HTTP 接口，也可以直接用 `curl` 调用。修改类请求必须带上 `X-Requested-With` 头（用于防御 CSRF）。

| 请求 | 作用 |
| --- | --- |
| `GET /path/` | Web UI |
| `GET /path/?ls` | 以 JSON 返回目录列表 |
| `GET /path/?find=关键词` | 递归搜索文件名 |
| `GET /path/?tar[&files=a/b]` | 以 tar 下载整个文件夹或其中的部分条目 |
| `GET /file[?dl]` | 获取文件（支持 Range；`?dl` 表示作为附件下载） |
| `PUT /path/file[?overwrite]` | 上传文件（会自动创建缺失的父目录） |
| `POST /path/name?mkdir` | 新建文件夹 |
| `POST /path/item?mv=/new/path` | 移动/重命名 |
| `DELETE /path/item` | 删除（文件夹会连同内容一起删除） |
| `POST /.sf/login` / `POST /.sf/logout` / `GET /.sf/me` | 会话相关 |

```sh
curl -H 'X-Requested-With: curl' -T photo.jpg http://localhost:8080/uploads/photo.jpg
```

## 安全说明

- 路径会被严格校验（拒绝 `..`、控制字符、反斜杠），而 WASI 的预打开目录本身也会把访问限制在沙箱内
- 用户上传的 HTML/SVG/JS 文件以纯文本形式返回，并附带 `Content-Security-Policy: sandbox`，不会在本站的源下执行
- 密码以明文保存在环境变量里，公网部署时请放在 HTTPS 反向代理后面
