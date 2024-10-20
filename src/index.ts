import { AdditionalChar, KeyType, toTransliteration } from "greek-conversion";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt, type JwtVariables } from "hono/jwt";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { Database } from "./Database.ts";
import {
  setNumericParam,
  setNumericRangeParam,
  setSelectedFields
} from "./helpers.ts";
import { getEntryBatch } from "./model/devutils.ts";
import { getEntry } from "./model/entry.ts";
import { getEntries } from "./model/lookup.ts";
import { getRandomEntry } from "./model/randomEntry.ts";
import { Settings } from "./Settings.ts";

type Variables = JwtVariables;

await Database.getConnection();

const settings = Settings.getSettings();

export const app = new Hono<{ Variables: Variables }>();

app.use(cors());
app.use(logger());
app.use(secureHeaders());

app.use("/devutils/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: settings.jwtSecret
  });
  return jwtMiddleware(c, next);
});

app.get("/", (c) => {
  return c.json("OK");
});

app.get("/devutils/entry/batch", async (c) => {
  const fields = setSelectedFields(c.req.query("fields"));
  const limit = setNumericParam(c.req.query("limit"));
  const offset = setNumericParam(c.req.query("offset"));

  const entries = await getEntryBatch({ fields, limit, offset });
  return c.json(entries);
});

app.get("/entry/random", async (c) => {
  const fields = setSelectedFields(c.req.query("fields"));
  const lengthRange = setNumericRangeParam(c.req.query("lengthRange"));

  const entry = await getRandomEntry({ fields, lengthRange });
  return c.json(entry);
});

app.get("/entry/:uri", async (c) => {
  const uri = decodeURIComponent(c.req.param("uri")).trim();
  const fields = setSelectedFields(c.req.query("fields"));
  const siblings = c.req.query("siblings") !== undefined;

  // Handle malformed URIs smoothly.
  // @fixme: using option `removeDiacritics` removes dashes and
  //         this prevents access to contract verbs for example.
  const formattedUri = toTransliteration(uri, KeyType.TRANSLITERATION, {
    additionalChars: AdditionalChar.DIGAMMA,
    //removeDiacritics: true,
    transliterationStyle: {
      gammaNasal_n: true,
      useCxOverMacron: true
    }
  });

  const entry = await getEntry({ q: formattedUri, fields, siblings });
  return c.json(entry);
});

app.get("/lookup/:q", async (c) => {
  const q = decodeURIComponent(c.req.param("q")).trim();
  const fields = setSelectedFields(c.req.query("fields"));
  const morphology = c.req.query("morphology") !== undefined;
  const caseSensitive = c.req.query("caseSensitive") !== undefined;
  const limit = setNumericParam(c.req.query("limit"));

  const entries = await getEntries({
    q,
    fields,
    morphology,
    caseSensitive,
    limit
  });
  return c.json(entries);
});

export default {
  fetch: app.fetch,
  port: settings.port
};
