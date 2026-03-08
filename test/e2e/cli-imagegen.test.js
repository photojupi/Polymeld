import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { initI18n } from "./_helpers.js";

before(async () => {
  await initI18n("ko");
});

const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;

// ─── Tier 4: 이미지 생성 (API 전용) ──────────────────

describe("Gemini 이미지 생성 (API)", { skip: !hasGoogleApiKey }, () => {
  it("간단한 이미지 프롬프트에 inlineData 포함 응답", { timeout: 120000 }, async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

    const response = await client.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: "Generate a 32x32 solid red square image",
      config: { responseModalities: ["TEXT", "IMAGE"] },
    });

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const hasImage = parts.some((p) => p.inlineData);
    assert.ok(hasImage, "이미지 데이터(inlineData)가 응답에 없음");
  });
});
