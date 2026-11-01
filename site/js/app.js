// 页面逻辑：解析输入 -> 获取本子/章节 -> 下载并还原图片 -> 生成 PDF -> 保存
(function () {
  "use strict";

  const Core = window.JmCore;
  const $ = (id) => document.getElementById(id);
  const SETTINGS_KEY = "jmweb.settings.v1";
  const IMAGE_RETRIES = 3;

  const ui = {
    input: $("input"),
    quality: $("quality"),
    concurrency: $("concurrency"),
    saveMode: $("saveMode"),
    pickFolder: $("pickFolder"),
    folderName: $("folderName"),
    start: $("start"),
    stop: $("stop"),
    clearLog: $("clearLog"),
    taskProgress: $("taskProgress"),
    taskText: $("taskText"),
    pageProgress: $("pageProgress"),
    pageText: $("pageText"),
    log: $("log"),
    folderRow: $("folderRow"),
    folderSupport: $("folderSupport"),
  };

  let dirHandle = null;
  let controller = null;

  function log(message, level) {
    const line = document.createElement("div");
    line.className = level ? "log-" + level : "";
    line.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  // ---------- 设置 ----------

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (saved.mode) {
        const radio = document.querySelector("input[name=mode][value=" + saved.mode + "]");
        if (radio) radio.checked = true;
      }
      if (saved.quality) ui.quality.value = saved.quality;
      if (saved.concurrency) ui.concurrency.value = saved.concurrency;
      if (saved.saveMode && supportsFolder()) ui.saveMode.value = saved.saveMode;
    } catch (err) {
      // 设置损坏时使用默认值
    }
  }

  function saveSettings() {
    const settings = {
      mode: document.querySelector("input[name=mode]:checked").value,
      quality: ui.quality.value,
      concurrency: ui.concurrency.value,
      saveMode: ui.saveMode.value,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      // 隐私模式等情况下无法保存，忽略
    }
  }

  function supportsFolder() {
    return typeof window.showDirectoryPicker === "function";
  }

  function updateSaveModeUi() {
    ui.folderRow.hidden = ui.saveMode.value !== "folder";
  }

  // ---------- 图片处理 ----------

  function descramble(bitmap, num) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    for (const strip of Core.descramblePlan(bitmap.height, num)) {
      ctx.drawImage(bitmap, 0, strip.ySrc, bitmap.width, strip.h, 0, strip.yDst, bitmap.width, strip.h);
    }
    return canvas;
  }

  // 返回可直接写入 PDF 的 { type: "jpg" | "png", bytes }
  async function loadPage(client, photoId, filename, quality) {
    const blob = await client.fetchImage(photoId, filename);
    const file = Core.splitFilename(filename);
    const num = Core.getSegmentNum(photoId, file.name, JmApi.md5hex);

    // 未打乱的 JPEG / PNG 原样写入，不重新编码
    if (num === 0 && (file.ext === "jpg" || file.ext === "jpeg")) {
      return { type: "jpg", bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
    if (num === 0 && file.ext === "png") {
      return { type: "png", bytes: new Uint8Array(await blob.arrayBuffer()) };
    }

    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = descramble(bitmap, num);
      const lossless = quality >= 1;
      const out = await canvas.convertToBlob(
        lossless ? { type: "image/png" } : { type: "image/jpeg", quality: quality }
      );
      return { type: lossless ? "png" : "jpg", bytes: new Uint8Array(await out.arrayBuffer()) };
    } finally {
      bitmap.close();
    }
  }

  async function loadPageWithRetry(client, photoId, filename, quality, signal) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await loadPage(client, photoId, filename, quality);
      } catch (err) {
        if (err.name === "AbortError" || attempt >= IMAGE_RETRIES) throw err;
        log(filename + " 第 " + attempt + " 次失败，重试中：" + err.message, "warn");
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        if (signal.aborted) throw new DOMException("已停止", "AbortError");
      }
    }
  }

  // 有限并发执行，保持结果顺序；任一任务失败时停止派发新任务
  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    let failed = false;
    async function run() {
      while (!failed && next < items.length) {
        const index = next;
        next += 1;
        try {
          results[index] = await worker(items[index], index);
        } catch (err) {
          failed = true;
          throw err;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  async function buildPdf(pages, title) {
    const pdf = await PDFLib.PDFDocument.create();
    pdf.setTitle(title);
    pdf.setProducer("JMComic Web Downloader");
    for (const page of pages) {
      const image = page.type === "jpg" ? await pdf.embedJpg(page.bytes) : await pdf.embedPng(page.bytes);
      const pdfPage = pdf.addPage([image.width, image.height]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
    return pdf.save();
  }

  // ---------- 保存 ----------

  async function fileExists(filename) {
    if (!dirHandle) return false;
    try {
      const handle = await dirHandle.getFileHandle(filename);
      return (await handle.getFile()).size > 0;
    } catch (err) {
      return false;
    }
  }

  async function saveFile(bytes, filename) {
    if (dirHandle) {
      const handle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- 下载流程 ----------

  function setPageProgress(done, total) {
    ui.pageProgress.max = Math.max(total, 1);
    ui.pageProgress.value = done;
    ui.pageText.textContent = done + " / " + total;
  }

  async function downloadChapter(client, photoId, baseName, options) {
    const filename = baseName + ".pdf";
    if (await fileExists(filename)) {
      log("已存在，跳过：" + filename);
      return;
    }

    const chapter = await client.getChapter(photoId);
    const images = chapter.images;
    if (!images.length) throw new Error("章节 " + photoId + " 没有图片");
    log("章节 " + photoId + "：共 " + images.length + " 页");

    let done = 0;
    setPageProgress(0, images.length);
    const pages = await mapLimit(images, options.concurrency, async (name) => {
      const page = await loadPageWithRetry(client, photoId, name, options.quality, options.signal);
      done += 1;
      setPageProgress(done, images.length);
      return page;
    });

    log("正在生成 PDF：" + filename);
    const bytes = await buildPdf(pages, baseName);
    await saveFile(bytes, filename);
    log("已保存：" + filename + "（" + (bytes.length / 1048576).toFixed(1) + " MB）", "ok");
  }

  async function downloadAlbum(client, albumId, options) {
    const album = await client.getAlbum(albumId);
    const chapters = Core.chapterList(album);
    log("本子 " + albumId + "：" + album.name + "（" + chapters.length + " 话）");
    for (const chapter of chapters) {
      await downloadChapter(client, chapter.id, Core.pdfBaseName(album.name, chapter, chapters.length), options);
    }
  }

  function setRunning(running) {
    ui.start.disabled = running;
    ui.stop.disabled = !running;
    ui.input.disabled = running;
    ui.pickFolder.disabled = running;
    ui.saveMode.disabled = running;
  }

  async function start() {
    const parsed = Core.parseIds(ui.input.value);
    for (const token of parsed.invalid) log("无法识别，已跳过：" + token, "warn");
    if (!parsed.ids.length) {
      log("请输入至少一个车号或链接", "warn");
      return;
    }
    if (ui.saveMode.value === "folder" && !dirHandle) {
      const picked = await pickFolder();
      if (!picked) return;
    }
    if (ui.saveMode.value !== "folder") dirHandle = null;
    saveSettings();

    controller = new AbortController();
    const options = {
      mode: document.querySelector("input[name=mode]:checked").value,
      quality: Number(ui.quality.value),
      concurrency: Math.max(1, Math.min(20, Math.floor(Number(ui.concurrency.value)) || 6)),
      signal: controller.signal,
    };
    const client = new JmApi.JmApiClient({ log: log, signal: controller.signal });
    const failed = [];

    setRunning(true);
    setPageProgress(0, 0);
    ui.taskProgress.max = parsed.ids.length;
    try {
      for (let i = 0; i < parsed.ids.length; i += 1) {
        const id = parsed.ids[i];
        ui.taskProgress.value = i;
        ui.taskText.textContent = i + " / " + parsed.ids.length;
        try {
          if (options.mode === "album") {
            await downloadAlbum(client, id, options);
          } else {
            const chapter = await client.getChapter(id);
            await downloadChapter(client, id, Core.safeFileName(chapter.name || id), options);
          }
        } catch (err) {
          if (err.name === "AbortError") throw err;
          failed.push(id);
          log("失败：" + id + "（" + err.message + "）", "error");
        }
      }
      ui.taskProgress.value = parsed.ids.length;
      ui.taskText.textContent = parsed.ids.length + " / " + parsed.ids.length;
      if (failed.length) {
        log("完成，失败 " + failed.length + " 个，已将失败的车号放回输入框，可直接重试", "warn");
        ui.input.value = failed.join("\n");
      } else {
        log("全部完成", "ok");
      }
    } catch (err) {
      log(err.name === "AbortError" ? "已停止" : "出错：" + err.message, err.name === "AbortError" ? "warn" : "error");
    } finally {
      controller = null;
      setRunning(false);
    }
  }

  async function pickFolder() {
    try {
      dirHandle = await window.showDirectoryPicker({ id: "jmweb-save", mode: "readwrite" });
      ui.folderName.textContent = dirHandle.name;
      return true;
    } catch (err) {
      if (err.name !== "AbortError") log("无法选择文件夹：" + err.message, "error");
      return false;
    }
  }

  // ---------- 初始化 ----------

  if (!supportsFolder()) {
    ui.saveMode.querySelector("option[value=folder]").disabled = true;
    ui.folderSupport.hidden = false;
  }
  loadSettings();
  updateSaveModeUi();

  ui.saveMode.addEventListener("change", updateSaveModeUi);
  ui.pickFolder.addEventListener("click", pickFolder);
  ui.start.addEventListener("click", start);
  ui.stop.addEventListener("click", () => controller && controller.abort());
  ui.clearLog.addEventListener("click", () => { ui.log.textContent = ""; });
  ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !ui.start.disabled) start();
  });
  window.addEventListener("beforeunload", (event) => {
    if (controller) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    log("当前浏览器不支持 OffscreenCanvas，请使用新版 Chrome、Edge 或 Firefox", "error");
    ui.start.disabled = true;
  }
})();
