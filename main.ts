import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";

import { Client } from "@elastic/elasticsearch";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ElasticVectorSearch } from "@langchain/community/vectorstores/elasticsearch";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const StartupMetadataSchema = z.object({
  company_name: z.string(),
  industry: z.string(),
  location: z.string(),
  founded_year: z.number(),
  funding_stage: z.string(),
  last_funding_date: z.string(),
  funding_amount: z.number(),
  lead_investor: z.string(),
  other_investors: z.array(z.string()),
  monthly_revenue: z.number(),
  employee_count: z.number(),
  business_model: z.string(),
});

const StartupDocumentSchema = z.object({
  pageContent: z.string(),
  metadata: StartupMetadataSchema,
});

type StartupDocumentType = z.infer<typeof StartupDocumentSchema>;

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
});

const VECTOR_INDEX: string = "startups-index";
const ELASTICSEARCH_ENDPOINT: string = process.env.ELASTICSEARCH_ENDPOINT ?? "";
const ELASTICSEARCH_API_KEY: string = process.env.ELASTICSEARCH_API_KEY ?? "";

const esClient = new Client({
  node: ELASTICSEARCH_ENDPOINT,
  auth: {
    apiKey: ELASTICSEARCH_API_KEY,
  },
});

const vectorStore = new ElasticVectorSearch(embeddings, {
  client: esClient,
  indexName: VECTOR_INDEX,
});

const llm = new ChatOpenAI({ model: "gpt-4o-mini" });

async function loadDataset(path: string): Promise<StartupDocumentType[]> {
  const raw = await fs.readFile(path, "utf-8");
  const data = JSON.parse(raw);

  return data.map((d: StartupDocumentType) => {
    return {
      pageContent: d.pageContent,
      metadata: d.metadata,
    };
  });
}

async function ingestData() {
  const vectorExists = await esClient.indices.exists({ index: VECTOR_INDEX });

  if (!vectorExists) {
    console.log("CREATING VECTOR INDEX...");

    // Vector index mapping for startup data
    await esClient.indices.create({
      index: VECTOR_INDEX,
      mappings: {
        properties: {
          text: { type: "text" },
          embedding: {
            type: "dense_vector",
            dims: 1536,
            index: true,
            similarity: "cosine",
          },
          metadata: {
            type: "object",
            properties: {
              company_name: { type: "keyword" },
              industry: { type: "keyword" },
              location: { type: "keyword" },
              founded_year: { type: "integer" },
              funding_stage: { type: "keyword" },
              last_funding_date: { type: "date" },
              funding_amount: { type: "long" },
              lead_investor: { type: "keyword" },
              other_investors: { type: "keyword" },
              monthly_revenue: { type: "long" },
              employee_count: { type: "integer" },
              business_model: { type: "keyword" },
            },
          },
        },
      },
    });
  }

  const indexExists = await esClient.indices.exists({ index: VECTOR_INDEX });

  if (indexExists) {
    const indexCount = await esClient.count({ index: VECTOR_INDEX });
    const documentCount = indexCount.count;

    // Only ingest if index is empty
    if (documentCount > 0) return;

    console.log("INGESTING DATASET...");
    const datasetPath = "./dataset.json";
    const initialDocs = await loadDataset(datasetPath).catch(() => []);

    await vectorStore.addDocuments(initialDocs as any);
  }
}

// Load available filters from a JSON file
const AVAILABLE_FILTERS = require("./availableFilters.json");

const FiltersSchema = z.object({
  industry: z.array(z.string()).optional(),
  location: z.array(z.string()).optional(),
  funding_stage: z.array(z.string()).optional(),
  business_model: z.array(z.string()).optional(),
  funding_amount_gte: z.number().optional(),
  employee_count_gte: z.number().optional(),
  founded_year_gte: z.number().optional(),
});

function buildElasticsearchQuery(filters: z.infer<typeof FiltersSchema>): any {
  const esFilters = Object.entries(FiltersSchema.parse(filters))
    .filter(
      ([_, value]) => value && (Array.isArray(value) ? value.length > 0 : true)
    )
    .map(([key, value]) => {
      const field = `metadata.${key.replace("_gte", "")}`;
      return key.endsWith("_gte")
        ? { range: { [field]: { gte: value } } }
        : { terms: { [field]: value } };
    });

  return esFilters.length > 0 ? { bool: { filter: esFilters } } : null;
}

async function searchStartups(semanticQuery: string, esQuery?: any) {
  console.log(`🔍 Searching with semantic query: "${semanticQuery}"`);
  if (esQuery) {
    console.log(
      `🔍 With Elasticsearch filters:`,
      JSON.stringify(esQuery, null, 2)
    );
  }

  try {
    const results = await vectorStore.similaritySearch(semanticQuery, 10);

    return results.map((doc: any) => ({
      pageContent: doc.pageContent,
      metadata: doc.metadata,
    }));
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
}

// Define state for VC workflow
const VCState = Annotation.Root({
  input: Annotation<string>(), // User's natural language query
  structuredQuery: Annotation<string>(), // LLM-generated structured query
  results: Annotation<any[]>(), // Search results
  final: Annotation<string>(), // Final formatted response
});

// Node 1: Convert natural language to structured Elasticsearch filters
async function queryProcessor(state: typeof VCState.State) {
  // structured output for direct Elasticsearch query generation
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

  const prompt = `Generate Elasticsearch query from: "${state.input}"

    Available options: ${JSON.stringify(AVAILABLE_FILTERS, null, 2)}

    Time context (today = Sept 29, 2025):
    - "last year" → founded_year >= 2024
    - "past 2 years" → founded_year >= 2023  
    - "recent" → founded_year >= 2022

    Generate structured elasticsearch_query and semantic_query based on the user input.
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
  console.log("🔍 Semantic query:", parsedQuery.semantic_query);

  // Use the generated Elasticsearch query
  const searchResults = await searchStartups(
    parsedQuery.semantic_query || state.input,
    parsedQuery.elasticsearch_query
  );

  return {
    results: searchResults,
  };
}

// Node 3: Format results
async function resultFormatter(state: typeof VCState.State) {
  const results = state.results || [];

  let formattedResults = `🎯 Found ${results.length} startup${
    results.length > 1 ? "s" : ""
  } matching your criteria:\n\n`;

  results.forEach((startup: any, index: number) => {
    const meta = startup.metadata;
    formattedResults += `${index + 1}. **${meta.company_name}**\n`;
    formattedResults += `   📍 ${meta.location} | 🏢 ${meta.industry} | 💼 ${meta.business_model}\n`;
    formattedResults += `   💰 ${meta.funding_stage} - $${(
      meta.funding_amount / 1000000
    ).toFixed(1)}M\n`;
    formattedResults += `   👥 ${meta.employee_count} employees | 📈 $${(
      meta.monthly_revenue / 1000
    ).toFixed(0)}K MRR\n`;
    formattedResults += `   🏦 Lead: ${meta.lead_investor}\n`;
    formattedResults += `   📝 ${startup.pageContent}\n\n`;
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
  const workflow = new StateGraph(VCState)
    .addNode("queryProcessor", queryProcessor)
    .addNode("searchProcessor", searchProcessor)
    .addNode("resultFormatter", resultFormatter)
    .addEdge("__start__", "queryProcessor")
    .addEdge("queryProcessor", "searchProcessor")
    .addEdge("searchProcessor", "resultFormatter")
    .addEdge("resultFormatter", "__end__");

  await ingestData();

  const app = workflow.compile();

  await saveGraphImage(app);
  const query =
    "Find me Series A or Series B logistics and fintech startups in San Francisco or New York that have raised between $5M to $25M from top tier investors like Sequoia Capital, Kleiner Perkins, or Tiger Global Management, founded in the last 3 years, with monthly revenue above $400K and between 40-120 employees, focusing on B2B or B2B2C business models with AI-powered solutions, supply chain optimization, or financial technology innovations";

  console.log("🚀 VC Startup Search System Ready!\n");

  console.log(`\n🔍 Query: "${query}"`);

  const result = await app.invoke({ input: query });
  console.log(result.final);
}

// Execute the main function
main().catch(console.error);
