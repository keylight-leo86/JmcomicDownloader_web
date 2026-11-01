// 与 DOM 无关的纯逻辑，浏览器和 Node 测试共用。
// 算法移植自上游 jmcomic（JmCryptoTool / JmImageTool / JmcomicText）。
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.JmCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const APP_TOKEN_SECRET = "185Hcomic3PAPP7R";
  const APP_DATA_SECRET = "185Hcomic3PAPP7R";
  const API_DOMAIN_SERVER_SECRET = "diosfjckwpqpdfjkvnqQjsik";
  const APP_VERSION = "2.0.28";

  // 移动端 API 的 /chapter_view_template 不允许跨域，固定使用上游的默认值
  const SCRAMBLE_ID = 220980;
  const SCRAMBLE_268850 = 268850;
  const SCRAMBLE_421926 = 421926;

  const DEFAULT_API_DOMAINS = [
    "www.cdnhjk.net",
    "www.cdngwc.cc",
    "www.cdngwc.net",
    "www.cdngwc.club",
  ];

  const DOMAIN_SERVER_URLS = [
    "https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
    "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
    "https://rup4a04-c03.tos-cn-beijing.bytepluses.com.cn/newsvr-2025.txt",
  ];

  const IMAGE_DOMAINS = [
    "cdn-msp.jmapiproxy1.cc",
    "cdn-msp.jmapiproxy2.cc",
    "cdn-msp2.jmapiproxy2.cc",
    "cdn-msp3.jmapiproxy2.cc",
    "cdn-msp.jmapinodeudzn.net",
    "cdn-msp3.jmapinodeudzn.net",
  ];

  function normalizeId(value) {
    return String(value).replace(/^0+(?=\d)/, "");
  }

  // 支持 123、JM123、/album/123、/photo/123、/comic/detail?id=123
  // 返回 { ids, invalid }，ids 去重且保持输入顺序
  function parseIds(text) {
    const ids = [];
    const invalid = [];
    const tokens = String(text || "").split(/[\s,，;；、]+/).filter(Boolean);
    for (const token of tokens) {
      const match =
        token.match(/(?:album|photo)\/(\d{1,12})(?!\d)/i) ||
        token.match(/[?&](?:id|album_id|photo_id|comic_id)=(\d{1,12})(?!\d)/i) ||
        token.match(/^(?:jm)?(\d{1,12})$/i);
      if (!match) {
        invalid.push(token);
        continue;
      }
      const id = normalizeId(match[1]);
      if (!ids.includes(id)) ids.push(id);
    }
    return { ids: ids, invalid: invalid };
  }

  function tokenAndParam(ts, md5hex, secret) {
    return {
      token: md5hex(String(ts) + (secret || APP_TOKEN_SECRET)),
      tokenparam: ts + "," + APP_VERSION,
    };
  }

  // base64 -> AES-ECB(key = md5(ts + secret)) -> PKCS7 去填充 -> UTF-8 字符串
  function decodeRespData(CryptoJS, data, ts, secret) {
    const key = CryptoJS.enc.Utf8.parse(CryptoJS.MD5(String(ts) + secret).toString());
    const plain = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(data) },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    return plain.toString(CryptoJS.enc.Utf8);
  }

  // 图片分割数，与上游 JmImageTool.get_num 一致
  function getSegmentNum(aid, filenameWithoutSuffix, md5hex) {
    aid = Number(aid);
    if (aid < SCRAMBLE_ID) return 0;
    if (aid < SCRAMBLE_268850) return 10;
    const x = aid < SCRAMBLE_421926 ? 10 : 8;
    const hash = md5hex(String(aid) + filenameWithoutSuffix);
    return (hash.charCodeAt(hash.length - 1) % x) * 2 + 2;
  }

  // 还原打乱图片时每一条的源 y、目标 y 和高度，与上游 decode_and_save 一致
  function descramblePlan(height, num) {
    if (num <= 0) return [{ ySrc: 0, yDst: 0, h: height }];
    const plan = [];
    const over = height % num;
    for (let i = 0; i < num; i += 1) {
      let move = Math.floor(height / num);
      const ySrc = height - move * (i + 1) - over;
      let yDst = move * i;
      if (i === 0) move += over;
      else yDst += over;
      plan.push({ ySrc: ySrc, yDst: yDst, h: move });
    }
    return plan;
  }

  function splitFilename(filename) {
    const dot = filename.lastIndexOf(".");
    return dot > 0
      ? { name: filename.slice(0, dot), ext: filename.slice(dot + 1).toLowerCase() }
      : { name: filename, ext: "" };
  }

  // Windows 和各浏览器都能接受的文件名
  function safeFileName(name, maxLength) {
    const cleaned = String(name == null ? "" : name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "");
    return Array.from(cleaned).slice(0, maxLength || 120).join("") || "未命名";
  }

  // 按 series 的 sort 排序；单章节本子返回自身作为唯一章节
  function chapterList(album) {
    const series = Array.isArray(album.series) ? album.series.slice() : [];
    if (!series.length) return [{ id: String(album.id), sort: 1, name: "" }];
    return series
      .map((c) => ({ id: String(c.id), sort: Number(c.sort) || 1, name: c.name || "" }))
      .sort((a, b) => a.sort - b.sort);
  }

  // 与 GUI 版一致：单章节为“本子名”，多章节为“本子名 - 第N话 章节名”
  function pdfBaseName(albumName, chapter, chapterCount) {
    if (chapterCount <= 1) return safeFileName(albumName);
    const suffix = " - 第" + chapter.sort + "话" + (chapter.name ? " " + chapter.name : "");
    return safeFileName(Array.from(String(albumName)).slice(0, 100).join("") + suffix);
  }

  return {
    APP_TOKEN_SECRET: APP_TOKEN_SECRET,
    APP_DATA_SECRET: APP_DATA_SECRET,
    API_DOMAIN_SERVER_SECRET: API_DOMAIN_SERVER_SECRET,
    APP_VERSION: APP_VERSION,
    SCRAMBLE_ID: SCRAMBLE_ID,
    DEFAULT_API_DOMAINS: DEFAULT_API_DOMAINS,
    DOMAIN_SERVER_URLS: DOMAIN_SERVER_URLS,
    IMAGE_DOMAINS: IMAGE_DOMAINS,
    parseIds: parseIds,
    tokenAndParam: tokenAndParam,
    decodeRespData: decodeRespData,
    getSegmentNum: getSegmentNum,
    descramblePlan: descramblePlan,
    splitFilename: splitFilename,
    safeFileName: safeFileName,
    chapterList: chapterList,
    pdfBaseName: pdfBaseName,
  };
});
