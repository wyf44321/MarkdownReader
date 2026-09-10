# Markdown 阅读器

通用的本地 Markdown 网页阅读器：扫描书籍根目录，把带 `config_mdr.jsonc` 的文件夹显示为书架上的一本书。

## 启动

需要 Node.js 14+。

- macOS：双击 `start.command`
- Linux：`./start.sh`
- Windows：双击 `start.bat`
- 或：`cd Src && npm install && npm start`

首次启动若没有 `config.jsonc`，启动脚本会从 `config.example.jsonc` 复制一份。默认端口 `3000`（被占用则自动加一）。也可用 `node Src/server.js --port=3000 --open`。

## 配置阅读器

复制 `config.example.jsonc` 为 `config.jsonc`（本机文件，不入库），只需要填 **书籍根目录**。可以是一个路径，也可以是多个：

```jsonc
{
  // 每个目录只扫描一层子目录
  "booksRoot": ["./Books", "../OtherBooks"]
}
```

`config.jsonc` / `config_mdr.jsonc` 使用 JSONC（`//` 与 `/* */` 注释）。相对路径相对本仓库根目录解析。编辑器按 `.jsonc` 后缀识别，书籍目录里不必再配 `.vscode`。

若某个目录里只有旧的 `config.json` / `config_mdr.json`，运行时仍会读取；带注释时请改用 `.jsonc`。

## 增加一本书

1. 在某一个 `booksRoot` 下建一个子目录（例如 `Books/LearningUE/`）。
2. 把 [`config_mdr.example.jsonc`](config_mdr.example.jsonc) 拷进去，改名为 `config_mdr.jsonc`。
3. 按文件里的中文注释填写：书名、封面、正文路径、meta、排除列表、侧栏 Features。

只有存在 `config_mdr.jsonc`（或旧的 `config_mdr.json`）的子目录才会出现在首页。每个 `booksRoot` 都只扫一层，不会递归找配置。

`path` 相对 `config_mdr.jsonc` 所在目录，可写一个或一组根。若配置文件就在书根，写 `"."`；若只是一个「书卡」目录，写指向真正 Markdown 根的相对路径，例如 `"../../../LearningUE"`。多个根会合并进同一本书的侧栏，同名路径以数组里靠前的为准。

## 阅读说明

- 首页自上而下：书籍搜索 → 阅读历史 → 全部书籍（一行最多 5 本）。
- 点某本书进入阅读。若有上次记录，会询问是否回到上次位置。
- 书籍根目录有 `README.md`（大小写不敏感）时，默认打开它，侧栏第一行是「首页」。
- 目录行点击只展开/折叠。若该目录有 README，右侧按钮才打开说明文档；README 本身不出现在文件列表里。
- `UseTitleAsFileName` / `UseTitleAsSectionName` 打开后，侧栏主标题用一级标题，文件名/目录名作为副标题（与 LearningUE 一致）。

修改书籍目录下的 Markdown 后，刷新页面即可看到更新（服务端会监视文件变化并失效缓存）。
