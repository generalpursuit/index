import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth } from "../../procedures";
import { categoriesContract } from "./contract";
import { suggestCategory } from "./service";

const api = implement(categoriesContract).$context<Context>().use(requireAuth);
export const categoriesRouter = api.router({
  suggest: api.suggest.handler(({ input }) => suggestCategory(input.url)),
});
