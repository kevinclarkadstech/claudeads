import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/worker/lib/crypto";

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encryptSecret("secret-token", key);
    const b = await encryptSecret("secret-token", key);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, key)).toBe("secret-token");
  });

  it("rejects the wrong key", async () => {
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await expect(decryptSecret(await encryptSecret("x", key), other)).rejects.toThrow();
  });
});
