// 离线单元测试：node --test
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const CryptoJS = require("../site/vendor/crypto-js.min.js");
const Core = require("../site/js/core.js");

const md5hex = (text) => crypto.createHash("md5").update(text, "utf8").digest("hex");

test("parseIds 识别各种输入格式并去重", () => {
  const input = [
    "1455254",
    "JM1455254",
    "jm350234",
    "https://18comic.vip/album/123456/some-title",
    "https://18comic.vip/photo/654321",
    "https://devapp.18comic.cc/comic/detail?id=777",
    "0099",
    "不是车号",
  ].join("\n");
  const result = Core.parseIds(input);
  assert.deepEqual(result.ids, ["1455254", "350234", "123456", "654321", "777", "99"]);
  assert.deepEqual(result.invalid, ["不是车号"]);
});

test("parseIds 支持中英文分隔符", () => {
  assert.deepEqual(Core.parseIds("1，2;3；4、5 6").ids, ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(Core.parseIds("").ids, []);
});

test("tokenAndParam 与上游算法一致", () => {
  const auth = Core.tokenAndParam(1700566805, md5hex);
  assert.equal(auth.token, md5hex("1700566805185Hcomic3PAPP7R"));
  assert.equal(auth.tokenparam, "1700566805,2.0.28");
});

test("decodeRespData 能解密 AES-ECB 数据", () => {
  const ts = 1700566805;
  const plain = JSON.stringify({ name: "测试本子", id: 1 });
  const key = CryptoJS.enc.Utf8.parse(md5hex(ts + Core.APP_DATA_SECRET));
  const cipher = CryptoJS.AES.encrypt(plain, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 });
  const decoded = Core.decodeRespData(CryptoJS, cipher.ciphertext.toString(CryptoJS.enc.Base64), ts, Core.APP_DATA_SECRET);
  assert.equal(decoded, plain);
});

test("getSegmentNum 与上游 get_num 一致", () => {
  // 与 Python 版对照过：1455254 / 00001 -> 4
  assert.equal(Core.getSegmentNum("1455254", "00001", md5hex), 4);
  assert.equal(Core.getSegmentNum(220979, "00001", md5hex), 0);
  assert.equal(Core.getSegmentNum(220980, "00001", md5hex), 10);
  assert.equal(Core.getSegmentNum(268849, "00001", md5hex), 10);
  for (const aid of [268850, 300000, 421925, 421926, 1455254]) {
    for (let page = 1; page <= 20; page += 1) {
      const num = Core.getSegmentNum(aid, String(page).padStart(5, "0"), md5hex);
      const max = aid < 421926 ? 20 : 16;
      assert.ok(num >= 2 && num <= max && num % 2 === 0, aid + "/" + page + " -> " + num);
    }
  }
});

test("descramblePlan 的条带完整覆盖源图和目标图", () => {
  for (const [height, num] of [[1811, 4], [1811, 10], [1000, 8], [7, 4], [2000, 16]]) {
    const plan = Core.descramblePlan(height, num);
    assert.equal(plan.length, num);
    for (const key of ["ySrc", "yDst"]) {
      const rows = new Array(height).fill(0);
      for (const strip of plan) {
        for (let y = strip[key]; y < strip[key] + strip.h; y += 1) rows[y] += 1;
      }
      assert.ok(rows.every((count) => count === 1), key + " " + height + "/" + num);
    }
  }
  assert.deepEqual(Core.descramblePlan(100, 0), [{ ySrc: 0, yDst: 0, h: 100 }]);
});

test("descramblePlan 与上游 decode_and_save 的切分一致", () => {
  // h=1811, num=4: move=452, over=3
  assert.deepEqual(Core.descramblePlan(1811, 4), [
    { ySrc: 1356, yDst: 0, h: 455 },
    { ySrc: 904, yDst: 455, h: 452 },
    { ySrc: 452, yDst: 907, h: 452 },
    { ySrc: 0, yDst: 1359, h: 452 },
  ]);
});

test("safeFileName 去掉非法字符并限制长度", () => {
  assert.equal(Core.safeFileName('a/b\\c:d*e?f"g<h>i|j'), "a_b_c_d_e_f_g_h_i_j");
  assert.equal(Core.safeFileName("  名字.  "), "名字");
  assert.equal(Core.safeFileName(""), "未命名");
  assert.equal(Array.from(Core.safeFileName("字".repeat(300))).length, 120);
});

test("chapterList 和 pdfBaseName 与 GUI 版命名一致", () => {
  const single = { id: 1455254, name: "单章节", series: [] };
  const singleChapters = Core.chapterList(single);
  assert.deepEqual(singleChapters, [{ id: "1455254", sort: 1, name: "" }]);
  assert.equal(Core.pdfBaseName(single.name, singleChapters[0], 1), "单章节");

  const multi = {
    id: 350234,
    name: "多章节",
    series: [
      { id: "350235", name: "下", sort: "2" },
      { id: "350234", name: "", sort: "1" },
    ],
  };
  const chapters = Core.chapterList(multi);
  assert.deepEqual(chapters.map((c) => c.id), ["350234", "350235"]);
  assert.equal(Core.pdfBaseName(multi.name, chapters[0], 2), "多章节 - 第1话");
  assert.equal(Core.pdfBaseName(multi.name, chapters[1], 2), "多章节 - 第2话 下");
});

test("splitFilename", () => {
  assert.deepEqual(Core.splitFilename("00001.webp"), { name: "00001", ext: "webp" });
  assert.deepEqual(Core.splitFilename("00002.JPG"), { name: "00002", ext: "jpg" });
  assert.deepEqual(Core.splitFilename("noext"), { name: "noext", ext: "" });
});
