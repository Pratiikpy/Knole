import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { reflect } from "./reflect";

export const reflectFn = createServerFn({ method: "POST" })
  .validator(z.object({ entry: z.string().min(1).max(20000) }))
  .handler(async ({ data }) => {
    const reflection = await reflect(data.entry);
    return { reflection };
  });
