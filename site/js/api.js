// JM 移动端 API 客户端（浏览器版），依赖全局 CryptoJS 与 JmCore
(function (global) {
  "use strict";

  const Core = global.JmCore;
  const md5hex = (text) => CryptoJS.MD5(text).toString();

  // 带超时、并能被外部 AbortSignal 中止的 fetch
  async function fetchWithTimeout(url, options, timeoutMs, signal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, Object.assign({ referrerPolicy: "no-referrer" }, options, { signal: controller.signal }));
    } catch (err) {
      if (signal && signal.aborted) throw new DOMException("已停止", "AbortError");
      if (err.name === "AbortError") throw new Error("请求超时");
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  class JmApiClient {
    constructor(options) {
      this.log = options.log || (() => {});
      this.signal = options.signal;
      this.domains = Core.DEFAULT_API_DOMAINS.slice();
      this.domainsUpdated = false;
    }

    // 从域名服务器获取最新 API 域名，失败时继续使用内置列表
    async updateDomains() {
      if (this.domainsUpdated) return;
      this.domainsUpdated = true;
      for (const url of Core.DOMAIN_SERVER_URLS) {
        try {
          const resp = await fetchWithTimeout(url, {}, 10000, this.signal);
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const text = (await resp.text()).replace(/^[^\x00-\x7f]+/, "").trim();
          const servers = JSON.parse(Core.decodeRespData(CryptoJS, text, "", Core.API_DOMAIN_SERVER_SECRET)).Server;
          if (Array.isArray(servers) && servers.length) {
            this.domains = Array.from(new Set(servers.concat(this.domains)));
            this.log("API 域名：" + servers.join(", "));
            return;
          }
        } catch (err) {
          if (err.name === "AbortError") throw err;
          this.log("域名服务器不可用（" + err.message + "），继续使用内置域名");
        }
      }
    }

    // 依次尝试各个 API 域名，返回解密后的 data 对象
    async reqApi(path) {
      await this.updateDomains();
      let lastError = null;
      for (const domain of this.domains) {
        const ts = Math.floor(Date.now() / 1000);
        const auth = Core.tokenAndParam(ts, md5hex);
        try {
          const resp = await fetchWithTimeout(
            "https://" + domain + path,
            { headers: { token: auth.token, tokenparam: auth.tokenparam } },
            20000,
            this.signal
          );
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const json = await resp.json();
          if (json.code !== 200 || typeof json.data !== "string") {
            throw new Error(json.errorMsg || "接口返回异常");
          }
          // 可用的域名移到最前，后续请求优先使用
          this.domains = [domain].concat(this.domains.filter((d) => d !== domain));
          return JSON.parse(Core.decodeRespData(CryptoJS, json.data, ts, Core.APP_DATA_SECRET));
        } catch (err) {
          if (err.name === "AbortError") throw err;
          lastError = err;
          this.log("API 域名 " + domain + " 失败：" + err.message);
        }
      }
      throw new Error("所有 API 域名均请求失败（" + (lastError && lastError.message) + "），请检查网络或代理");
    }

    async getAlbum(albumId) {
      const data = await this.reqApi("/album?id=" + encodeURIComponent(albumId));
      if (!data || data.name == null) throw new Error("本子不存在或无法访问：" + albumId);
      return data;
    }

    async getChapter(photoId) {
      const data = await this.reqApi("/chapter?id=" + encodeURIComponent(photoId));
      if (!data || !Array.isArray(data.images)) throw new Error("章节不存在或无法访问：" + photoId);
      return data;
    }

    // 依次尝试各个图片域名
    async fetchImage(photoId, filename) {
      let lastError = null;
      for (const domain of Core.IMAGE_DOMAINS) {
        try {
          const url = "https://" + domain + "/media/photos/" + encodeURIComponent(photoId) + "/" + encodeURIComponent(filename);
          const resp = await fetchWithTimeout(url, {}, 60000, this.signal);
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const blob = await resp.blob();
          if (!blob.size) throw new Error("空文件");
          return blob;
        } catch (err) {
          if (err.name === "AbortError") throw err;
          lastError = err;
        }
      }
      throw new Error("图片 " + filename + " 下载失败：" + (lastError && lastError.message));
    }
  }

  global.JmApi = { JmApiClient: JmApiClient, md5hex: md5hex };
})(window);
