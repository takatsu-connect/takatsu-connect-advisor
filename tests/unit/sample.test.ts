describe("Jest setup sanity check", () => {
  it("runs a passing test", () => {
    expect(1 + 1).toBe(2);
  });

  it("supports async/await", async () => {
    const value = await Promise.resolve(42);
    expect(value).toBe(42);
  });
});
