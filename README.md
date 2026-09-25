# Satellite Files

Satellite Files 是一个类似 [copyparty](https://github.com/9001/copyparty) 的文件服务器，面向**个人自部署**，界面简洁、现代。
整个服务编译成一个 **WASIp3 组件**，导出 `wasi:http/handler@0.3.0`，文件读写走 `wasi:filesystem@0.3.0`，
可以直接用 `wasmtime serve` 运行，也可以打包成 `.satellite` 部署到 planet。

只提供 HTTP 和 Web 界面，不包含 WebDAV、FTP、SMB 这类额外协议。

## 功能

**浏览**
- 列表/网格两种视图，按名称、大小、修改时间排序，面包屑导航，图片缩略图
- 在当前文件夹下递归按文件名搜索（按 `/` 聚焦搜索框）
- 自动适配深色模式，也可以手动切换；手机上同样可用

**上传**
- 拖拽文件或整个文件夹上传；拖到某个文件夹行上就上传进那个文件夹
- 按文件显示进度和速度，3 路并发
- 同名文件可选择替换、保留两者或跳过
- 流式写入临时文件，完成后才重命名到位，中断的上传不会留下残缺文件

**文件管理**
- 新建文件夹、重命名（F2）、移动（文件夹选择器，或把条目拖到文件夹/面包屑上）、删除
- 批量选择（Shift 连选、Ctrl/⌘+A 全选）

**预览与播放**
- 图片灯箱（方向键/滑动切换）、视频、PDF、文本/代码、Markdown 渲染
- 底部音乐播放条：自动播放下一首，接入系统媒体键（Media Session）

**下载**
- 单个文件直接下载，支持 Range（可拖动进度、断点续传）
- 文件夹或多选时流式打包成 `.tar` 下载

**账号与权限**
- 可选的账号密码登录，会话是 HMAC 签名的 Cookie
- 按路径分别设置 `r` / `w` / `m` / `d` 权限
- 支持只能上传、看不到内容的"投递箱"文件夹

## 快速开始

需要：
- [rustup](https://rustup.rs)：会自动安装 nightly 工具链和 `rust-src`
- [wasmtime](https://wasmtime.dev)：开发时使用 49.0.1
- [xmake](https://xmake.io)：构建、运行和测试，Linux、macOS、Windows 都能用

默认构建的是纯 WASIp3 组件（`wasm32-wasip3`）。

```sh
xmake                    # 构建
xmake package            # 打包成 dist/files.satellite，部署到 planet
xmake run                # 在 http://127.0.0.1:8080 启动，对外提供 ./data
xmake e2e                # 端到端测试

xmake f --addr=0.0.0.0:8080 --data=/srv/files --title="My Files" --accounts=alice:secret
xmake f --access="/:*=r,@acct=rwmd;/inbox:*=w,alice=rwmd"
xmake f --wasi=p2        # 切换到 wasm32-wasip2 构建（stable Rust）
```

`SATELLITE_SECRET`、`SATELLITE_MAX_UPLOAD`、`SATELLITE_DEBUG` 如果在当前环境里设置了，`xmake run` 会原样传给组件。

其他 xmake 任务：

```sh
xmake sysroot --llvm=<LLVM≥23> --llvm-src=<llvm-project> --wasi-libc=<wasi-libc>   # 从源码重建 WASIp3 C 运行时
```

`xmake run` 实际执行的命令等价于：

```sh
# 构建前先把 vendor/wasip3-sysroot 装进 nightly 工具链（xmake 自动完成）
cargo +nightly build -Zbuild-std=std,panic_abort --target wasm32-wasip3 --release
wasmtime serve -Scli -Sp3 -Wcomponent-model-threading=y \
  --addr 127.0.0.1:8080 \
  --env SATELLITE_TITLE="My Files" --env SATELLITE_ACCOUNTS=alice:secret \
  --dir ./data::/ \
  target/wasm32-wasip3/release/satellite.wasm
```

每个 `--dir 宿主目录::组件内路径` 都是一个卷：挂在 `/` 的是根卷，挂在其他路径（例如 `--dir ~/Music::/music`）的会作为文件夹出现在对应位置。

### 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `SATELLITE_TITLE` | `Satellite` | 页面上显示的站点名称 |
| `SATELLITE_ACCOUNTS` | 未设置 | 账号列表：`alice:密码1,bob:密码2` |
| `SATELLITE_ACCESS` | 见下文 | 按路径的访问规则 |
| `SATELLITE_SECRET` | 由账号列表派生 | 会话 Cookie 的签名密钥。不设置时修改任意密码都会让所有会话失效 |
| `SATELLITE_MAX_UPLOAD` | `0`（不限制） | 单个文件的上传上限（MiB） |
| `SATELLITE_DEBUG` | 未设置 | 设置后会把每个请求打印到 stderr |

环境变量通过 `wasmtime serve --env KEY=VALUE` 传入。

#### 访问规则

`SATELLITE_ACCESS` 由 `;` 分隔的规则组成，每条规则的格式是 `路径:对象=权限,对象=权限`。对某个路径生效的是**最长前缀匹配**的那条规则。

- 对象：`*`（所有人，包括匿名访客）、`@acct`（任何已登录用户）或具体用户名
- 权限：`r` 浏览/下载，`w` 上传/新建文件夹，`m` 移动/重命名，`d` 删除（覆盖已有文件也需要 `d`），`a` = 全部

默认值：
- 没有配置账号：`/:*=rwmd`（和 copyparty 一样，所有人可读写）
- 配置了账号：`/:*=r,@acct=rwmd`

例如 `/:*=r,@acct=rw,alice=rwmd;/inbox:*=w,alice=rwmd;/private:alice=rwmd`：
所有人可以浏览，登录用户可以上传，只有 alice 能移动和删除；`/inbox` 是投递箱，任何人都能往里上传，但只有 alice 能看到内容；`/private` 只有 alice 能访问。

### 部署到 planet

`xmake package` 生成 `dist/files.satellite`（只支持 WASIp3 构建），放进 planet 即可。清单见 `manifest.yaml`：

- 服务 `server`，wasmtime handler，常驻实例（`http-resident`）
- `http`：Web 界面和上传/下载接口共用的端口
- `data`：私有目录。planet 会把 app 的持久化目录挂到 `/`，组件把它作为根卷对外提供
- `SATELLITE_TITLE`、`SATELLITE_ACCOUNTS`、`SATELLITE_ACCESS`、`SATELLITE_SECRET`、`SATELLITE_MAX_UPLOAD`：同上表，不设置时用默认值（planet 把配置项按 `id` 注入成同名环境变量）
- 协作线程 ABI 需要 planet 的 wasmtime host 打开 component-model threading（相当于 `-Wcomponent-model-threading=y`）

构建时组件的栈设为 8MB（`build.rs`）：WASIp3 下并发任务的栈是从堆上分配、紧挨静态数据区的，默认 1MB 溢出时不会 trap，而是写坏内存。

> **安全提示**：没有配置账号时，任何能访问服务的人都可以读写和删除文件。默认只监听 `127.0.0.1`；
> 如果需要从其他机器访问，请先设置 `SATELLITE_ACCOUNTS`。密码以明文保存在配置里，公网部署时请放在 HTTPS 反向代理后面。

## 测试

```sh
xmake e2e             # 加 --keep 可以保留测试数据目录
```

`xmake e2e`（`xmake/modules/satellite/e2e.lua`）会用临时数据目录启动服务，然后用真实的 `curl` 和 `tar` 验证以下场景：
- Web 界面与静态资源（含 ETag 协商缓存）
- 匿名访问、登录、错误密码、伪造的会话 Cookie，以及修改类请求必须带 `X-Requested-With`
- 上传到新建的多级目录、下载内容逐字节一致、Range / 后缀 Range / 416、HEAD
- 不会静默覆盖同名文件，覆盖需要 `d` 权限，上传大小限制，中文文件名，不残留临时文件
- 新建文件夹、移动、重命名，禁止把文件夹移进自身或覆盖已有条目
- 递归搜索、整个文件夹或部分条目的 tar 下载并解包校验
- 投递箱：匿名可以上传，但看不到内容也下载不了
- 路径穿越与非法文件名、上传的 HTML 以纯文本加 `CSP: sandbox` 返回
- 24 个并发请求（覆盖 wasm32-wasip3 下 wit-bindgen 任务上下文的问题，见 `Cargo.toml`）
- 删除文件夹、禁止删除根目录、退出登录

## HTTP 接口

Web 界面使用的是一组很小的 HTTP 接口，也可以直接用 `curl` 调用。修改类请求必须带 `X-Requested-With` 头（用于防御 CSRF）。

| 请求 | 作用 |
| --- | --- |
| `GET /path/` | Web 界面 |
| `GET /path/?ls` | 以 JSON 返回目录列表和当前用户的权限 |
| `GET /path/?find=关键词` | 递归搜索文件名 |
| `GET /path/?tar[&files=a/b]` | 以 tar 下载整个文件夹，或其中用 `/` 分隔列出的条目 |
| `GET /file[?dl]` | 获取文件（支持 Range；`?dl` 表示作为附件下载） |
| `PUT /path/file[?overwrite]` | 上传文件（会自动创建缺失的父目录） |
| `POST /path/name?mkdir` | 新建文件夹 |
| `POST /path/item?mv=/new/path` | 移动/重命名 |
| `DELETE /path/item` | 删除（文件夹会连同内容一起删除） |
| `POST /.sf/login` / `POST /.sf/logout` / `GET /.sf/me` | 会话相关 |

```sh
curl -H 'X-Requested-With: curl' -T photo.jpg http://127.0.0.1:8080/uploads/photo.jpg
```

## 实现说明

### 目录结构

```text
src/
├── lib.rs       组件入口与路由：浏览、下载、搜索、tar、上传、新建、移动、删除
├── fs.rs        基于 WASI 预打开目录的虚拟文件系统（多卷挂载、递归删除）
├── http.rs      响应构造，以及 stream<u8> 之间带长度限制的管道
├── config.rs    环境变量配置、访问规则、会话签名
├── paths.rs     URL 解码与路径校验
├── tar.rs       流式 tar（ustar + pax，支持长文件名和中文）
└── mime.rs      Content-Type 与可安全内联显示的类型
web/             前端：原生 HTML/CSS/JS，无构建步骤，编译时嵌入组件
xmake/modules/satellite/   构建、运行时安装、e2e 测试、sysroot 重建
vendor/wasip3-sysroot/     预编译的 WASIp3 C 运行时（见 vendor/README.md）
```

### 全程流式

下载、上传和 tar 打包都不会把文件整个读进内存：
- 下载：`descriptor.read-via-stream` 读出的 `stream<u8>` 经过带长度上限的管道（用于 Range）写进响应体
- 上传：请求体的 `stream<u8>` 经过计数管道（用于大小限制和完整性校验）交给 `descriptor.write-via-stream`，写入同目录下的 `.<name>.<random>.sfpart`，成功后才 `rename-at` 到目标文件名
- tar：遍历目录后逐个文件写头部、管道复制内容、补齐 512 字节对齐

### 安全

- 路径会被严格校验（拒绝 `..`、控制字符、反斜杠），WASI 的预打开目录本身也会把访问限制在沙箱内
- 用户上传的 HTML/SVG/JS 以纯文本返回，所有文件响应都带 `Content-Security-Policy: sandbox`（PDF 除外，浏览器内置的 PDF 查看器无法在沙箱文档里运行）和 `nosniff`
- 会话 Cookie 为 `HttpOnly; SameSite=Lax`，签名用 HMAC-SHA256，比较时使用常量时间
