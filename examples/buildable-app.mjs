import { createAgenitiApp, defineAction, s } from "../src/index.js";

const add = defineAction({
  name: "add_numbers",
  description: "Add two numbers.",
  input: s.object({
    a: s.number(),
    b: s.number(),
  }),
  output: s.object({
    sum: s.number(),
  }),
  run({ a, b }) {
    return { sum: a + b };
  },
});

export const app = createAgenitiApp({
  name: "math",
  actions: [add],
});
