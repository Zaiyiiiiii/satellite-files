# Changelog

## v0.1.0

第一个版本。Files 是一个类似 copyparty 的文件服务器，编译成纯 WASIp3 组件（`wasm32-wasip3`，只使用 `@0.3.0` 的 WASI 接口），可以用 `wasmtime serve` 直接运行，也可以作为 `.satellite` 包部署到 planet。

**功能**
- 浏览：列表/网格视图、排序、面包屑、图片缩略图、递归搜索
- 上传：拖拽文件或文件夹、逐个文件显示进度和速度、同名冲突时可选择替换/保留两者/跳过；流式写入临时文件，完成后才落盘
- 文件管理：新建文件夹、重命名、移动（选择器或拖拽）、删除、批量选择
- 预览：图片、视频、PDF、文本/代码、Markdown；底部音乐播放条
- 下载：支持 Range 断点续传；文件夹或多选时流式打包为 `.tar`
- 账号与权限：可选的账号登录（HMAC 签名 Cookie），按路径设置 `r`/`w`/`m`/`d` 权限，支持只能上传的投递箱文件夹
- 界面默认中文，可切换英文；自动适配深色模式和手机屏幕

**运行**
- 组件从 `/mnt/data` 读取对外提供的文件：`wasmtime serve -Scli -Sp3 -Wcomponent-model-threading=y --dir <目录>::/mnt/data files.wasm`
- 配置通过 `FILES_TITLE`、`FILES_ACCOUNTS`、`FILES_ACCESS`、`FILES_SECRET`、`FILES_MAX_UPLOAD`、`FILES_DEBUG` 环境变量传入
- 需要 wasmtime 49 或更新版本

**附件**
- `files.satellite`：planet 部署包（`manifest.yaml` + `payload/server/files.wasm`）
- `files.wasm`：WASIp3 组件，可直接用 `wasmtime serve` 运行
- `SHA256SUMS`：以上文件的校验和
