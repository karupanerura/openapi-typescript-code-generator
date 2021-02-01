import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json");

const pattern = `Generated by ${pkg.name} v${pkg.version}`;
const replacedText = `Generated by ${pkg.name}`;

describe("Generate Code Snapshot Test", () => {
  test("api.test.domain", () => {
    const generateCode = fs.readFileSync(path.join(__dirname, "../code/api.test.domain.ts"), { encoding: "utf-8" });
    const text = generateCode.replace(pattern, replacedText);
    expect(text).toMatchSnapshot();
  });
  test("infer.domain", () => {
    const generateCode = fs.readFileSync(path.join(__dirname, "../code/infer.domain.ts"), { encoding: "utf-8" });
    const text = generateCode.replace(pattern, replacedText);
    expect(text).toMatchSnapshot();
  });
});
