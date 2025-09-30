import { writeFileSync } from "node:fs";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  esClient,
  ingestDocuments,
  createIndex,
  INDEX_NAME,
} from "./ingest.js";

const llm = new ChatOpenAI({ model: "gpt-4o-mini" });

// Define state for VC workflow
const VCState = Annotation.Root({
  input: Annotation<string>(), // User's natural language query
  structuredQuery: Annotation<string>(), // LLM-generated Elasticsearch query
  results: Annotation<any[]>(), // Search results
  final: Annotation<string>(), // Final formatted response
});

// Node 1: Convert natural language to structured Elasticsearch filters
async function queryProcessor(state: typeof VCState.State) {
  const mappings = await esClient.indices.getMapping({ index: INDEX_NAME });
  const indexProperties = mappings[INDEX_NAME]?.mappings?.properties || {};

  // structured output for Elasticsearch query generation
  const structuredLLM = llm.withStructuredOutput({
    type: "object",
    properties: {
      elasticsearch_query: {
        type: "object",
        properties: {
          bool: {
            type: "object",
            properties: {
              filter: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    terms: {
                      type: "object",
                      additionalProperties: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                    range: {
                      type: "object",
                      additionalProperties: {
                        type: "object",
                        properties: {
                          gte: { type: "number" },
                          lte: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    required: ["elasticsearch_query"],
  });

  // Load available filters from a JSON file
  const AVAILABLE_FILTERS = require("./availableFilters.json");

  const prompt = `Convert to Elasticsearch query: "${state.input}"

    Available filter options: ${JSON.stringify(AVAILABLE_FILTERS, null, 2)}

    Index field mappings: ${JSON.stringify(indexProperties, null, 2)}

    Rules:
    - Use exact field names from mappings
    - Use "terms" for keyword fields, "range" for numeric/date fields
  `;

  try {
    const result = await structuredLLM.invoke(prompt); // Parse and validate the LLM output to an Elasticsearch query

    return {
      structuredQuery: JSON.stringify(result),
    };
  } catch (error: any) {
    console.error("❌ Error in queryProcessor:", error.message);
    return {
      structuredQuery: JSON.stringify({ semantic_query: state.input }),
    };
  }
}

// Node 2: Execute search with tools
async function searchProcessor(state: typeof VCState.State) {
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

// Node 3: Format results
async function resultFormatter(state: typeof VCState.State) {
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
    .addNode("queryProcessor", queryProcessor)
    .addNode("searchProcessor", searchProcessor)
    .addNode("resultFormatter", resultFormatter)

    // Define execution flow - edges determine the order of execution
    .addEdge("__start__", "queryProcessor") // Start with query processing
    .addEdge("queryProcessor", "searchProcessor") // Then execute search
    .addEdge("searchProcessor", "resultFormatter") // Finally format results
    .addEdge("resultFormatter", "__end__"); // End workflow

  const app = workflow.compile();

  await saveGraphImage(app);
  const query =
    "Find me Series A logistics and fintech startups in San Francisco or New York with funding between $5M to $25M from top investors like Sequoia Capital";

  console.log(`\n🔍 Query: "${query}"`);

  const result = await app.invoke({ input: query });
  console.log(result.final);
}

main().catch(console.error);
