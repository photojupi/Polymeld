import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SlashMenu, displayWidth } from "../src/repl/slash-menu.js";

const MENU = [
  { name: "/resume   — 중단된 파이프라인 재개", value: "/resume" },
  { name: "/status   — 현재 세션 상태", value: "/status" },
  { name: "/context  — 파이프라인 컨텍스트 조회", value: "/context" },
  { name: "/help     — 도움말", value: "/help" },
  { name: "/exit     — 종료", value: "/exit" },
];

describe("displayWidth", () => {
  it("ASCII 문자는 1칸", () => {
    assert.equal(displayWidth("abc"), 3);
  });

  it("한글은 2칸", () => {
    assert.equal(displayWidth("한글"), 4);
  });

  it("혼합 문자열", () => {
    // "ab한글cd" = 2(a,b) + 4(한,글) + 2(c,d) = 8
    assert.equal(displayWidth("ab한글cd"), 8);
  });

  it("빈 문자열은 0", () => {
    assert.equal(displayWidth(""), 0);
  });

  it("일본어 히라가나는 2칸", () => {
    assert.equal(displayWidth("あい"), 4);
  });
});

describe("SlashMenu", () => {
  describe("_getFiltered", () => {
    it("빈 필터는 모든 항목 반환", () => {
      const menu = new SlashMenu(MENU);
      menu.filter = "";
      assert.equal(menu._getFiltered().length, 5);
    });

    it("value 기준으로 필터링", () => {
      const menu = new SlashMenu(MENU);
      menu.filter = "st";
      const filtered = menu._getFiltered();
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].value, "/status");
    });

    it("name 기준으로 필터링 (대소문자 무시)", () => {
      const menu = new SlashMenu(MENU);
      menu.filter = "재개";
      const filtered = menu._getFiltered();
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].value, "/resume");
    });

    it("매치 없으면 빈 배열", () => {
      const menu = new SlashMenu(MENU);
      menu.filter = "zzz";
      assert.equal(menu._getFiltered().length, 0);
    });
  });

  describe("_moveSelection", () => {
    it("아래로 이동", () => {
      const menu = new SlashMenu(MENU);
      menu._render = () => {};
      menu._clearRendered = () => {};

      assert.equal(menu.selectedIndex, 0);
      menu._moveSelection(1);
      assert.equal(menu.selectedIndex, 1);
      menu._moveSelection(1);
      assert.equal(menu.selectedIndex, 2);
    });

    it("범위를 벗어나지 않음 (clamp)", () => {
      const menu = new SlashMenu(MENU);
      menu._render = () => {};
      menu._clearRendered = () => {};

      menu._moveSelection(-1); // 이미 0인데 위로
      assert.equal(menu.selectedIndex, 0);

      menu.selectedIndex = 4; // 마지막
      menu._moveSelection(1); // 아래로
      assert.equal(menu.selectedIndex, 4);
    });

    it("빈 필터 결과에서는 이동하지 않음", () => {
      const menu = new SlashMenu(MENU);
      menu._render = () => {};
      menu._clearRendered = () => {};
      menu.filter = "zzz"; // no matches

      menu._moveSelection(1);
      assert.equal(menu.selectedIndex, 0);
    });
  });
});
