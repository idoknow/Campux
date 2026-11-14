import { describe, expect, test } from "bun:test";
import { AI_LLM_ATTEMPTS_MAX, type AiProviderEndpoint, type StoredAiApiKey } from "./ai-settings";
import { buildTenantLlmChain } from "./llm-chain";

function endpoint(overrides: Partial<AiProviderEndpoint> = {}): AiProviderEndpoint {
  return {
    id: "default",
    label: "",
    provider: "openai_compatible",
    baseUrl: "https://api.example.com/v1",
    model: "model-a",
    fallbackModels: [],
    keyIds: [],
    ...overrides,
  };
}

function key(id: string): StoredAiApiKey {
  return { id, label: "", value: `sk-${id}` };
}

describe("llm degradation chain", () => {
  test("stays closed outside LLM mode", () => {
    const chain = buildTenantLlmChain({ mode: "local", providers: [endpoint()] }, [key("default")]);
    expect(chain.ready).toBe(false);
    expect(chain.attempts).toEqual([]);
    expect(chain.reason).toBe("AI 未切换到 LLM 模式");
  });

  test("stays closed without any key", () => {
    const chain = buildTenantLlmChain({ mode: "llm", providers: [endpoint()] }, []);
    expect(chain.ready).toBe(false);
    expect(chain.reason).toBe("尚未配置 API 密钥");
  });

  test("tries every fallback model before switching channel", () => {
    const chain = buildTenantLlmChain(
      {
        mode: "llm",
        providers: [
          endpoint({ id: "a", baseUrl: "https://a.example.com/v1", model: "main", fallbackModels: ["backup"], keyIds: ["k1"] }),
          endpoint({ id: "b", baseUrl: "https://b.example.com/v1", model: "second", keyIds: ["k2"] }),
        ],
      },
      [key("k1"), key("k2")],
    );
    expect(chain.ready).toBe(true);
    expect(chain.attempts.map((attempt) => `${attempt.baseUrl}|${attempt.model}|${attempt.keyId}`)).toEqual([
      "https://a.example.com/v1|main|k1",
      "https://a.example.com/v1|backup|k1",
      "https://b.example.com/v1|second|k2",
    ]);
  });

  test("rotates keys inside a channel that has no key restriction", () => {
    const chain = buildTenantLlmChain({ mode: "llm", providers: [endpoint({ model: "main" })] }, [key("one"), key("two")]);
    expect(chain.attempts.map((attempt) => attempt.keyId)).toEqual(["one", "two"]);
  });

  test("skips channels whose configured keys disappeared", () => {
    const chain = buildTenantLlmChain(
      { mode: "llm", providers: [endpoint({ keyIds: ["gone"] })] },
      [key("one")],
    );
    expect(chain.ready).toBe(false);
    expect(chain.reason).toBe("没有可用的服务商通道");
  });

  test("caps the attempts so a broken channel cannot loop forever", () => {
    const models = Array.from({ length: 6 }, (_, index) => `fallback-${index}`);
    const chain = buildTenantLlmChain(
      {
        mode: "llm",
        providers: [endpoint({ model: "main", fallbackModels: models, keyIds: ["k1", "k2"] })],
      },
      [key("k1"), key("k2")],
    );
    expect(chain.attempts.length).toBe(Math.min(AI_LLM_ATTEMPTS_MAX, 7 * 2));
  });
});
