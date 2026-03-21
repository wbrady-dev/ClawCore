import { Command } from "commander";
import { query } from "../../query/pipeline.js";

export const searchCommand = new Command("search")
  .description("Simple search (no reranking, faster)")
  .argument("<terms>", "Search terms")
  .option("-c, --collection <name>", "Collection to search", "default")
  .option("-k, --top-k <number>", "Number of results", "10")
  .option("--json", "Output as JSON")
  .action(
    async (
      terms: string,
      opts: { collection: string; topK: string; json: boolean },
    ) => {
      try {
        const result = await query(terms, {
          collection: opts.collection,
          topK: parseInt(opts.topK, 10),
          useReranker: false,
          useBm25: false,
          expand: false,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.context) {
            console.log(result.context);
          } else {
            console.log("No results found.");
          }
          console.log("");
          console.log(
            `--- ${result.queryInfo.candidatesEvaluated} candidates | ${result.queryInfo.chunksReturned} chunks | ${result.queryInfo.elapsedMs}ms ---`,
          );
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    },
  );
