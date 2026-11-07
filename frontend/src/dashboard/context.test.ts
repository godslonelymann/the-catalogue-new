import { describe, expect, it } from "vitest";
import { initialsFromEmail } from "./context";

describe("initialsFromEmail", () => {
  it.each([
    ["anurag.works09@gmail.com", "AW"],
    ["sam@example.com", "SA"],
    ["x@example.com", "X"],
    ["first_last+tag@example.com", "FL"],
    ["42@example.com", "42"],
  ])("%s → %s", (email, initials) => {
    expect(initialsFromEmail(email)).toBe(initials);
  });
});
