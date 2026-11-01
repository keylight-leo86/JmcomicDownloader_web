# JMComic Web Downloader

[![在线使用](https://img.shields.io/badge/在线使用-点击打开-2ea44f?style=for-the-badge)](https://keylight-leo86.github.io/JmcomicDownloader_web/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **直接打开即可使用，无需下载或安装：**
> **<https://keylight-leo86.github.io/JmcomicDownloader_web/>**

在浏览器本地运行的 JMComic 下载器。打开网页、输入车号即可下载并生成 PDF，无需安装任何程序。

所有请求都由用户浏览器直接发往 JM 服务器，下载、图片还原和 PDF 生成都在本机完成。本项目是纯静态网页，没有后端，不收集、不转发任何数据。

> 本项目是 [JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python) 的非官方 JavaScript 移植，与 JMComic、18comic 及上游作者无任何关联。

## 功能

- 支持车号、`JM车号`、`/album/`、`/photo/`、`/comic/detail?id=` 链接，可批量输入。
- 本子模式下载全部章节，每话生成一个 PDF；也可下载单个章节。
- 自动获取最新 API 域名，多个 API / 图片域名自动切换，图片失败自动重试。
- 可选“保存到指定文件夹”（Chrome / Edge），已存在的 PDF 自动跳过，适合断点续下。
- 支持随时停止，失败的车号会放回输入框便于重试。
- 设置保存在浏览器本地（localStorage）。

## 使用

1. 打开 <https://keylight-leo86.github.io/JmcomicDownloader_web/>（电脑、手机均可）。
2. 粘贴车号或链接，可每行一个批量输入，选择“本子”或“单个章节”。
3. 点击“开始下载”（或按 Ctrl+Enter），完成后浏览器会自动保存 PDF。
4. 如需把文件统一存到某个文件夹，展开“设置”，将保存方式改为“保存到指定文件夹”并选择目录。

要求：

- 新版 Chrome、Edge 或 Firefox；“保存到指定文件夹”仅 Chrome / Edge 电脑版支持。
- 所在网络需要能访问 `github.io` 以及 JM 的 API 与图片域名，否则请先开启系统代理。
- 批量下载时，浏览器可能询问“是否允许下载多个文件”，请选择允许。

### 关于画质

JM 的图片大多是 WebP 格式并经过切块打乱，必须在浏览器里还原后重新编码，默认使用 JPEG 95%。需要无损可在设置里选 PNG，但文件会大很多。只有未打乱的 JPEG/PNG 会原样写入 PDF。

### 已知限制

- 一个章节的全部图片在内存中处理，数百页的章节会占用较多内存。
- 由于跨域限制无法获取 scramble_id，固定使用 220980。对 2018 年以后的本子没有影响，极早期的本子可能还原错误。
- 依赖 JM 服务器允许跨域请求；若对方策略变化，网页可能失效。

## 自行部署（可选）

普通用户直接使用上面的在线地址即可。如果想部署自己的副本：

1. Fork 本仓库，或新建仓库并把本项目全部文件推送到 `main` 分支。
2. 打开仓库 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
3. 推送后 `.github/workflows/pages.yml` 会先运行测试，再把 `site/` 发布到 Pages。
4. 在 **Actions** 页面查看进度，完成后访问 `https://<用户名>.github.io/<仓库名>/`。

`site/` 是唯一被发布的目录，测试、文档和配置不会公开到网页上。也可以把 `site/` 直接上传到任意静态托管（Cloudflare Pages、EdgeOne Makers 等）。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm test
```

```bash
npm start
```

然后访问 `http://localhost:8765`。也可以用 `python -m http.server 8765 --directory site`。

## 项目结构

```text
├─ site/                    # 发布到 Pages 的全部内容
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/core.js            # 纯逻辑：输入解析、加解密、拼图算法、命名
│  ├─ js/api.js             # JM API 客户端
│  ├─ js/app.js             # 页面交互与下载流程
│  └─ vendor/               # crypto-js 4.2.0、pdf-lib 1.17.1
├─ tests/                   # Node 内置测试，覆盖 core.js
├─ licenses/                # 第三方许可证
└─ .github/workflows/       # 测试并部署到 GitHub Pages
```

## 隐私与安全

- 页面启用了内容安全策略（CSP），只加载本站脚本，不引入任何第三方统计或 CDN。
- 请求不携带 Referer，不使用 Cookie，不需要登录。
- 不要在 Issue 中上传账号、Cookie、下载文件或成人内容截图。

## 免责声明

见 [DISCLAIMER.md](DISCLAIMER.md)。请仅下载你有权访问和保存的内容，并遵守所在地法律、网站条款和版权要求。

## 许可证

MIT License，保留上游原始版权声明，见 [LICENSE](LICENSE)、[NOTICE](NOTICE)。第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
