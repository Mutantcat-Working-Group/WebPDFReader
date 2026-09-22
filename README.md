<div align="center">
<img src="https://s2.loli.net/2025/10/21/hDSloxRBaIwkdpN.png" style="width:100px;" width="100"/>
<h2>Mutantcat Web PDF Reader</h2>
</div>

### 一、产品概述

- 一个纯前端的网页 PDF 阅读器，为需要在网页里嵌 PDF 的场景（比如 iframe 引用）做显示增强。
- 浏览器大多能直接打开 PDF，遇到不能的直接用这个补上。
- 动态加载、按需加载策略，有效缓解大文件卡顿与浏览器崩溃。
- 文件完全在用户端解析，不上传服务器，Pages、Vercel 等静态托管即可跑。

核心价值：一个 URL 参数把任意 PDF 变成网页里顺滑、可翻页、可缩放的阅读器。

### 二、功能说明

- 阅读控制：大小缩放、翻页跳转、页码显示。
- iframe 友好：阻止操作冒泡到 iframe 容器外，宽高自适应填满容器，操作栏可隐藏且自适应手机端。
- 加载策略：动态加载防大文件卡顿；滚动到哪页先加载哪页，不必等前面的页。
- 双模态解析：流式与非流式两种模式，兼容更多浏览器环境（含手机夸克、手机自带浏览器）。
- 零依赖部署：纯静态文件，克隆下来丢任何静态服务器即可用。

### 三、安装与下载

在线使用（官方公益地址）：

- https://pdfreader.mutantcat.org
- https://pdfreader.jqshengtian.top
- https://pdfreader.mutantcat.dpdns.org
- https://pdfreader.mutantcat.ip-ddns.com
- https://mutantcat-working-group.github.io/WebPDFReader

也从 [Releases](https://github.com/Mutantcat-Working-Group/WebPDFReader/releases) 下载 `webpdfreader-1.0.20260920.tar.gz` 自行部署，另附 `checksums.txt` 供校验。版本号使用纯日期递增（如 `1.0.20260920`），推送同族标签（`v` 前缀可选）后，GitHub Actions 会自动打包并发布 Release。

### 四、快速上手

1. 直接访问任一官方地址，粘贴 PDF 链接即可阅读。
2. 通过 URL 指定远程文件（注意文件服务的跨域策略）：

```text
https://pdfreader.mutantcat.org/?url=https://www.jqshengtian.top/raw/A4/空白格.pdf
```

3. 嵌进自己站点时用 iframe 引用上述地址，容器多大页面就多大。
4. 手机上打开同样可用，操作栏自动收成手机布局。

### 五、其他说明

- 过旧的浏览器（如 Safari 15.4 及更早）可能出现 `Promise.withResolvers is not a function` 问题，建议升级浏览器。
- 如遇 bug 可及时提交 issue，欢迎 Fork 自己的版本，欢迎 Star 或贡献本项目。

本项目基于 Apache-2.0 协议开源。
