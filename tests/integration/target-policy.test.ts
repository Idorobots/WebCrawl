// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertSafeTarget, isPrivateAddress } from "../../src/server/target-policy";

describe("remote target policy", () => {
  it.each(["127.0.0.1", "10.2.3.4", "192.168.1.2", "::1", "fd00::1"])(
    "blocks private address %s",
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );

  it("rejects local names and private DNS answers", async () => {
    await expect(assertSafeTarget(new URL("http://localhost"))).rejects.toThrow("Local/internal");
    await expect(assertSafeTarget(new URL("https://example.com"), async () => [
      { address: "10.0.0.2", family: 4 },
    ])).rejects.toThrow("private/internal");
  });

  it("accepts public HTTP targets", async () => {
    await expect(assertSafeTarget(new URL("https://example.com"), async () => [
      { address: "93.184.216.34", family: 4 },
    ])).resolves.toBeUndefined();
  });
});
