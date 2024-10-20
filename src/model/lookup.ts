import {
  KeyType,
  removeDiacritics,
  removeGreekVariants,
  toBetaCode
} from "greek-conversion";
import { Database } from "../Database.ts";
import type {
  ApiLookupParams,
  ApiLookupResponse,
  DatabaseEntry,
  Entry,
  MorpheusData,
  Optional,
  PartialExcept,
  QueryableFields
} from "../definitions.ts";
import { lookupMorpheus, setUniqueEntries } from "../helpers.ts";
import { Settings } from "../Settings.ts";

const explicitStart = "^";
const explicitEnd = "$";
const singleWildcard = "?";
const wildcard = "*";

function emptyResponse(): any {
  return {
    data: {
      version: Settings.getSettings().dbVersion,
      count: 0,
      countAll: 0,
      lemmata: {},
      entries: []
    }
  };
}

function formatQueryStr(
  str: string,
  isExactMatch: boolean,
  isCaseSensitive: boolean
): string {
  if (!isExactMatch) {
    if (str.endsWith(explicitEnd)) {
      if (str.startsWith(wildcard)) str = str.slice(0, -1);
      else str = wildcard + str.slice(0, -1);
    } else {
      if (!str.endsWith(wildcard)) str = str + wildcard;
    }
  }

  return isCaseSensitive ? str : str.toLowerCase();
}

/**
 * A. [one char] Only allow greek letters (digamma included).
 * B. (1) Allow a maximum of 50 characters.
 *    (2) Only allow greek letters (digamma included), spaces
 *        and metacharacters `$`, `?`, `*` and `"`;
 *    (3) Allow a maximum of three identical characters in a row.
 */
function validateInput(str: string): boolean {
  if (!str) return false;
  if (str.length === 1) return /[^α-ωϝ]/i.test(str) === false;
  return (
    str.length < 50 &&
    /[^α-ωϝ\s$?*"]/i.test(str) === false &&
    /(.)\1{3,}/.test(str) === false
  );
}

export async function getEntries<K extends keyof QueryableFields>({
  q,
  fields,
  morphology,
  caseSensitive,
  limit
}: ApiLookupParams<K>): Promise<ApiLookupResponse<K>> {
  const db = await Database.getConnection();
  const settings = Settings.getSettings();
  const fieldsStr: string = fields.join(", ");

  const isExactMatch: boolean =
    (q.startsWith("^") && q.endsWith("$")) ||
    (q.startsWith('"') && q.endsWith('"'));

  if (isExactMatch) {
    q = q.slice(1, -1);
  } else if (q.startsWith(explicitStart) || q.startsWith('"')) {
    q = q.slice(1);
  }

  // Make the query string searchable.
  const searchStr: string = removeGreekVariants(
    removeDiacritics(q.trim(), KeyType.GREEK)
  );

  if (!validateInput(searchStr)) return emptyResponse();

  const comparisonOperator: string = isExactMatch ? "=" : "GLOB";

  const searchableField: string = caseSensitive
    ? "searchable"
    : "searchableCaseInsensitive";

  const searchableAtonicField: string = caseSensitive
    ? "searchableAtonic"
    : "searchableAtonicCaseInsensitive";

  const isMorpheusNeeded: boolean =
    !/\s/g.test(searchStr) && // Morpheus ignores whitespace
    !searchStr.toLowerCase().includes("ϝ") && // Morpheus ignores letter digamma
    !searchStr.endsWith('"') &&
    !searchStr.endsWith(explicitEnd) &&
    !searchStr.includes(singleWildcard) &&
    !searchStr.includes(wildcard);

  let morpheusData: MorpheusData = {};
  let morpheusSQLStatements: string = "";
  if (isMorpheusNeeded) {
    const betaCode = toBetaCode(searchStr, KeyType.GREEK, {
      removeDiacritics: true
    });

    morpheusData = await lookupMorpheus(
      caseSensitive ? betaCode : betaCode.toLocaleLowerCase()
    );

    // `morpheusData` keys are unique lemmata.
    morpheusSQLStatements = Object.keys(morpheusData).reduce(
      (acc, lemma) =>
        acc + `OR ${searchableField} = "${removeGreekVariants(lemma)}" `,
      ""
    );
  }

  // Field `word` is mandatory in order to retrieve unique entries
  // and build the `children` property.
  const sql = `
    SELECT ${
      !fieldsStr.includes("word") ? `word, ${fieldsStr}` : fieldsStr
    }, ${searchableAtonicField}, (
      SELECT COUNT(orderedID)
      FROM bailly
      WHERE ${searchableAtonicField} ${comparisonOperator} $query
      ${morpheusSQLStatements}
    ) as countAll
    FROM bailly
    WHERE ${searchableAtonicField} ${comparisonOperator} $query
    ${morpheusSQLStatements}
    ORDER BY orderedID
    LIMIT $limit 
  `;

  const params = {
    query: formatQueryStr(searchStr, isExactMatch, caseSensitive),
    limit: (() => {
      if (limit && limit <= settings.queryMaxRows) return limit;
      else return settings.queryMaxRows;
    })()
  };

  const data = <PartialExcept<DatabaseEntry, "word">[]>(
    db.query(sql).all(params)
  );

  if (process.env.NODE_ENV === "development") {
    console.log({
      searchStr: searchStr,
      morpheusData: Object.keys(morpheusData),
      params: params
    });
    console.log(sql);
  }

  if (!data.length) return emptyResponse();

  const uniqueEntries = setUniqueEntries(data, {
    caseSensitive
  });

  return {
    data: {
      version: settings.dbVersion,
      count: data.length,
      countAll: data[0].countAll ?? -1,
      morphology: morphology ? morpheusData : undefined,
      entries: uniqueEntries.map((item) => {
        const isExact: boolean = (() => {
          return caseSensitive
            ? searchStr === item.searchableAtonic
            : searchStr.toLowerCase() === item.searchableAtonicCaseInsensitive;
        })();

        const isMorpheus: boolean = (() => {
          if (!isMorpheusNeeded) return false;

          return caseSensitive
            ? !item.searchableAtonic?.startsWith(searchStr)
            : !item.searchableAtonicCaseInsensitive?.startsWith(
                searchStr.toLowerCase()
              );
        })();

        const removeExtraFields = (
          item: Partial<Entry> &
            Optional<
              DatabaseEntry,
              | "countAll"
              | "searchableAtonic"
              | "searchableAtonicCaseInsensitive"
            >
        ): void => {
          // Property `word` has been picked in order to group entries.
          if (!fieldsStr.includes("word")) delete item.word;

          delete item.countAll;

          caseSensitive
            ? delete item.searchableAtonic
            : delete item.searchableAtonicCaseInsensitive;
        };

        removeExtraFields(item);
        item.children?.forEach((child) => removeExtraFields(child));

        return {
          ...item,
          isMorpheus: isMorpheus,
          isExact: isMorpheus || isExact
        } as Entry<K>;
      })
    }
  };
}
