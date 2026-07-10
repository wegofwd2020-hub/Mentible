// The flag is read at module load, so each case needs a fresh module registry.
function loadFlag(env: string | undefined, platformOS: string): boolean {
  let value = false;
  jest.isolateModules(() => {
    if (env === undefined) delete process.env["EXPO_PUBLIC_NATIVE_READER"];
    else process.env["EXPO_PUBLIC_NATIVE_READER"] = env;
    jest.doMock("react-native", () => ({ Platform: { OS: platformOS } }));
    value = require("@/constants/readerFlag").USE_NATIVE_WEB_READER;
  });
  return value;
}

describe("USE_NATIVE_WEB_READER", () => {
  afterEach(() => {
    delete process.env["EXPO_PUBLIC_NATIVE_READER"];
    jest.resetModules();
  });

  it("is off by default on web (spec D1 — flag stays off until the flip)", () => {
    expect(loadFlag(undefined, "web")).toBe(false);
  });

  it("is on when EXPO_PUBLIC_NATIVE_READER=1 on web", () => {
    expect(loadFlag("1", "web")).toBe(true);
  });

  it("is off on native even when the env var is set (spec D3 — web-only)", () => {
    expect(loadFlag("1", "ios")).toBe(false);
    expect(loadFlag("1", "android")).toBe(false);
  });

  it("treats any value other than \"1\" as off", () => {
    expect(loadFlag("true", "web")).toBe(false);
    expect(loadFlag("0", "web")).toBe(false);
  });
});
