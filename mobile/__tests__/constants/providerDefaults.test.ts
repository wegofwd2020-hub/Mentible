// Two distinct defaults (see docs/proposals/2026-08-25-groq-*):
//  - GENERATION default = groq (free, managed, keyless — what writes books).
//  - BYOK key-form default = anthropic (the provider a user most likely keys in).
import { DEFAULT_PROVIDER_ID } from "@/constants/providers";
import { DEFAULT_GENERATION_PARAMS } from "@/types/generationParams";

it("defaults generation to groq (free testing-phase default)", () => {
  expect(DEFAULT_GENERATION_PARAMS.provider).toBe("groq");
});

it("defaults the BYOK key form to anthropic (most-likely-keyed provider)", () => {
  expect(DEFAULT_PROVIDER_ID).toBe("anthropic");
});
