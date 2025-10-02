import { writeFileSync } from "node:fs";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import {
  esClient,
  ingestDocuments,
  createIndex,
  INDEX_NAME,
} from "./ingest.js";

const llm = new ChatOpenAI({ model: "gpt-4o-mini" });
const AVAILABLE_FILTERS = require("./availableFilters.json");

// Define state for VC workflow
const VCState = Annotation.Root({
  input: Annotation<string>(), // User's natural language query
  searchStrategy: Annotation<string>(), // Search strategy decision: "structured" or "semantic"
  structuredQuery: Annotation<string>(), // LLM-generated Elasticsearch query
  results: Annotation<any[]>(), // Search results
  final: Annotation<string>(), // Final formatted response
});

// Node 1: Decide search strategy using LLM
async function decideSearchStrategy(state: typeof VCState.State) {
  // Zod schema for search strategy decision
  const SearchDecisionSchema = z.object({
    search_type: z
      .enum(["structured", "semantic"])
      .describe("Type of search to perform"),
    reasoning: z
      .string()
      .describe("Brief explanation of why this search type was chosen"),
  });

  const decisionLLM = llm.withStructuredOutput(SearchDecisionSchema);

  const prompt = `Query: "${state.input}"
    Available filters: ${JSON.stringify(AVAILABLE_FILTERS, null, 2)}

    Choose:
    - "structured" if query mentions specific filters (funding stage, location, industry, amounts)
    - "semantic" if query is conceptual or exploratory
  `;

  try {
    const result = await decisionLLM.invoke(prompt);
    console.log(
      `🤔 Search strategy: ${result.search_type} - ${result.reasoning}`
    );

    return {
      searchStrategy: result.search_type,
    };
  } catch (error: any) {
    console.error("❌ Error in decideSearchStrategy:", error.message);
    // Default to structured search on error
    return {
      searchStrategy: "structured",
    };
  }
}

// Node 2: Convert natural language to structured Elasticsearch filters
async function generateElasticsearchQuery(state: typeof VCState.State) {
  // const mappings = await esClient.indices.getMapping({ index: INDEX_NAME });

  // Zod schema for extracted filter values
  const FilterValuesSchema = z.object({
    industry: z
      .array(z.string())
      .optional()
      .describe("Industry values mentioned in query"),
    location: z
      .array(z.string())
      .optional()
      .describe("Location values mentioned in query"),
    funding_stage: z
      .array(z.string())
      .optional()
      .describe("Funding stage values mentioned in query"),
    funding_amount_gte: z
      .number()
      .optional()
      .describe("Minimum funding amount in USD"),
    funding_amount_lte: z
      .number()
      .optional()
      .describe("Maximum funding amount in USD"),
    lead_investor: z
      .array(z.string())
      .optional()
      .describe("Lead investor values mentioned in query"),
  });

  // LLM extracts values to fill template
  const extractorLLM = llm.withStructuredOutput(FilterValuesSchema);

  const extractPrompt = `Extract filter values from: "${state.input}"
    Available options: ${JSON.stringify(AVAILABLE_FILTERS, null, 2)}

    Extract only values mentioned in the query. Leave fields empty if not mentioned.
  `;

  try {
    const values = await extractorLLM.invoke(extractPrompt);

    // Template with ternary validation
    const elasticsearchQuery = {
      bool: {
        filter: [
          ...(values.industry && values.industry.length > 0
            ? [{ terms: { industry: values.industry } }]
            : []),
          ...(values.location && values.location.length > 0
            ? [{ terms: { location: values.location } }]
            : []),
          ...(values.funding_stage && values.funding_stage.length > 0
            ? [{ terms: { funding_stage: values.funding_stage } }]
            : []),
          ...(values.funding_amount_gte || values.funding_amount_lte
            ? [
                {
                  range: {
                    funding_amount: {
                      ...(values.funding_amount_gte && {
                        gte: values.funding_amount_gte,
                      }),
                      ...(values.funding_amount_lte && {
                        lte: values.funding_amount_lte,
                      }),
                    },
                  },
                },
              ]
            : []),
          ...(values.lead_investor && values.lead_investor.length > 0
            ? [{ terms: { lead_investor: values.lead_investor } }]
            : []),
        ],
      },
    };

    return {
      structuredQuery: JSON.stringify({
        elasticsearch_query: elasticsearchQuery,
      }),
    };
  } catch (error: any) {
    console.error("❌ Error in queryProcessor:", error.message);
    return {
      structuredQuery: JSON.stringify({ semantic_query: state.input }),
    };
  }
}

// Node 3: Perform semantic search using text similarity
async function performSemanticSearch(state: typeof VCState.State) {
  console.log("🔍 Performing semantic search...");

  try {
    const results = await esClient.search({
      index: INDEX_NAME,
      query: {
        semantic: {
          field: "semantic_field",
          query: state.input,
        },
      },
      size: 5, // Limit results for semantic search
    });

    console.log(
      `📊 Found ${results.hits.hits.length} results via semantic search`
    );

    return {
      results: results.hits.hits.map((hit: any) => hit._source),
    };
  } catch (error) {
    console.error("Search error:", error);
    return {
      results: [],
    };
  }
}

// Node 4: Execute structured search with filters
async function retrieveElasticsearchData(state: typeof VCState.State) {
  const parsedQuery = JSON.parse(state.structuredQuery);

  console.log(
    "🔍 Elasticsearch query:",
    JSON.stringify(parsedQuery.elasticsearch_query, null, 2)
  );

  try {
    const results = await esClient.search({
      index: INDEX_NAME,
      query: parsedQuery.elasticsearch_query,
    });

    return {
      results: results.hits.hits.map((hit: any) => hit._source),
    };
  } catch (error) {
    console.error("Search error:", error);
    return {
      results: [],
    };
  }
}

// Node 5: Visualize results
async function visualizeResults(state: typeof VCState.State) {
  const results = state.results || [];

  let formattedResults = `🎯 Found ${results.length} startup${
    results.length > 1 ? "s" : ""
  } matching your criteria:\n\n`;

  results.forEach((startup: any, index: number) => {
    formattedResults += `${index + 1}. **${startup.company_name}**\n`;
    formattedResults += `   📍 ${startup.location} | 🏢 ${startup.industry} | 💼 ${startup.business_model}\n`;
    formattedResults += `   💰 ${startup.funding_stage} - $${(
      startup.funding_amount / 1000000
    ).toFixed(1)}M\n`;
    formattedResults += `   👥 ${startup.employee_count} employees | 📈 $${(
      startup.monthly_revenue / 1000
    ).toFixed(0)}K MRR\n`;
    formattedResults += `   🏦 Lead: ${startup.lead_investor}\n`;
    formattedResults += `   📝 ${startup.description}\n\n`;
  });

  return {
    final: formattedResults,
  };
}

async function saveGraphImage(app: any): Promise<void> {
  try {
    const drawableGraph = app.getGraph();
    const image = await drawableGraph.drawMermaidPng();
    const arrayBuffer = await image.arrayBuffer();

    const filePath = "./workflow_graph.png";
    writeFileSync(filePath, new Uint8Array(arrayBuffer));
    console.log(`📊 Workflow graph saved as: ${filePath}`);
  } catch (error: any) {
    console.log("⚠️  Could not save graph image:", error.message);
  }
}

async function main() {
  await createIndex();
  await ingestDocuments();

  // Create the workflow graph with shared state
  const workflow = new StateGraph(VCState)
    // Register nodes - these are the processing functions
    .addNode("decideStrategy", decideSearchStrategy)
    .addNode("generateQuery", generateElasticsearchQuery)
    .addNode("semanticSearch", performSemanticSearch)
    .addNode("retrieveData", retrieveElasticsearchData)
    .addNode("visualizeResults", visualizeResults)
    // Define execution flow - edges determine the order of execution
    .addEdge("__start__", "decideStrategy") // Start with strategy decision
    .addConditionalEdges(
      "decideStrategy",
      (state) => state.searchStrategy, // Decision function
      {
        structured: "generateQuery", // If structured
        semantic: "semanticSearch", // If semantic
      }
    )
    .addEdge("generateQuery", "retrieveData") // Structured search -> retrieve data
    .addEdge("semanticSearch", "visualizeResults") // Semantic search -> visualize directly
    .addEdge("retrieveData", "visualizeResults") // Retrieved data -> visualize results
    .addEdge("visualizeResults", "__end__"); // End workflow

  const app = workflow.compile();

  await saveGraphImage(app);

  const query =
    "Find me Series A logistics and fintech startups in San Francisco or New York with funding between $5M to $25M from top investors like Sequoia Capital";

  const semanticQuery =
    "Show me innovative companies that are disrupting traditional industries like Tesla did for automotive";

  const result = await app.invoke({ input: semanticQuery });
  console.log(result.final);
}

main().catch(console.error);
